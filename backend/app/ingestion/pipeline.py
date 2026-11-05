from uuid import UUID
from langchain_core.documents import Document as LangChainDocument
from app.core.logger import get_logger
from app.db.models import DocumentChunk, DocumentStatus
from app.db.repositories.chunk_repo import DocumentChunkRepository
from app.db.repositories.document_repo import DocumentRepository
from app.db.repositories.ingestion_task_repo import IngestionTaskRepository
from app.db.session import AsyncSessionLocal
from app.ingestion import embedder, parser, splitter
from app.retrieval.tokenizer import segment
from app.storage.file_service import get_file_service
import asyncio
from pathlib import Path
from app.ingestion.thumbnail import generate_thumbnail

logger = get_logger(__name__)


async def _set_status(document_id: UUID, status: DocumentStatus, *,error_message: str | None = None,) -> None:
    """状态变更独立事务：避免长事务、保证前端轮询能立即看到中间态。"""
    # 核心设计点：为什么不直接复用外层传进来的 session？
    # 因为文档解析、切分、向量化是非常耗时的长任务（可能几分钟）。
    # 如果整个长任务包含在一个大事务里，数据库会长时间锁住记录，
    # 且前端查询进度时，在 commit 之前只能看到旧状态。
    # 这里的做法是：每次状态变更，都开一个全新的、短暂的数据库会话（Session）。

    # 创建独立的数据库会话上下文，退出 with 块时自动释放连接
    async with AsyncSessionLocal() as session:
        # 实例化文档仓储类
        repo = DocumentRepository(session)

        # 调用仓储层的方法更新内存中的状态（此时 SQLAlchemy 会标记为脏数据）
        await repo.update_status(document_id, status, error_message=error_message)

        # 立刻提交事务！
        # 这会立刻向数据库发送 UPDATE 语句并 commit。
        # 提交后，前端（如果正在轮询查进度）立刻就能查到最新的 status。
        await session.commit()


# 定义内部异步函数，用于生成并附加文档的缩略图。
# 传入参数：文档 ID、原始文件名、原始文件字节流。
async def _attach_thumbnail(document_id: UUID, filename: str, content: bytes) -> None:
    # 防御性判断：如果文件后缀不是 PDF，直接跳过。
    # 因为对于 DOCX/PPTX 等格式，生成缩略图的成本过高或暂不支持，交由前端展示默认图标。
    if Path(filename).suffix.lower() != ".pdf":
        return

    # 开启异常捕获块。缩略图生成属于“锦上添花”的非核心功能，
    # 绝对不能因为缩略图生成失败（如 PDF 损坏、超时、内存不足）而导致整个文档入库流程崩溃。
    try:
        # 【核心逻辑】由于 generate_thumbnail 是同步且极度消耗 CPU 的操作（Docling 解析 PDF 并渲染图片），
        # 1. 使用 asyncio.to_thread 将其丢到后台线程池执行，避免阻塞主事件循环。
        # 2. 使用 asyncio.wait_for 设置了 90 秒的超时限制。防止遇到极其复杂或异常的 PDF 时，线程被永久卡死。
        thumbnail = await asyncio.wait_for(
            asyncio.to_thread(generate_thumbnail, filename, content),
            timeout=90,
        )
    # 捕获超时异常（TimeoutError）或其他任何生成过程中的异常。
    except Exception as exc:
        # 记录警告日志，记录文档 ID 和具体的错误原因，方便后续排查。
        logger.warning(
            "thumbnail generation skipped: document_id=%s err=%s",
            document_id,
            exc,
        )
        # 发生异常直接返回，放弃生成缩略图，继续执行后续主流程。
        return

    # 如果生成函数没有抛出异常，但返回了 None（可能是非 PDF 或者内部静默失败了）。
    if not thumbnail:
        # 直接返回。
        return

    # 开启第二个异常捕获块。此时缩略图已经生成好了，接下来要上传云存储并写入数据库。
    try:
        # 1. 调用文件服务，将内存中的 WebP 缩略图字节流上传到云存储（如腾讯云 COS）。
        # 返回一个 object_key（文件的云端存储路径）。
        key = await get_file_service().upload_thumbnail(document_id, thumbnail)

        # 2. 开启一个全新的、独立的数据库事务（短事务）。
        # 使用 async with 保证连接用完后自动归还。
        async with AsyncSessionLocal() as session:
            # 实例化文档仓储层。
            repo = DocumentRepository(session)

            # 3. 将刚刚上传得到的缩略图 key，更新到数据库对应文档的字段中。
            # 注意：返回的 updated 是一个布尔值，代表是否成功更新。
            # 为什么会失败？因为在生成缩略图耗时（比如几十秒）的过程中，用户可能刚好把这个文档删除了。
            updated = await repo.set_thumbnail_key(document_id, key)

            # 4. 并发冲突处理：如果数据库更新失败（说明文档已被删除）。
            if not updated:
                # 【极其关键的清理逻辑】既然数据库里已经没有这条记录了，
                # 那么刚才上传到云端的缩略图文件就成了“孤儿文件”（垃圾数据）。
                # 必须立刻调用云存储接口将其删除，防止浪费存储空间和产生费用。
                await get_file_service().delete(key)
                # 处理完毕，直接返回。
                return

            # 5. 如果更新成功，提交事务，将缩略图 key 真正写入数据库。
            await session.commit()

    # 捕获上传或写库过程中的异常（如网络抖动、数据库连接断开等）。
    except Exception as exc:
        # 同样记录警告日志。缩略图附加失败不影响主文档的上传和解析。
        logger.warning(
            "thumbnail upload skipped: document_id=%s err=%s",
            document_id,
            exc,
        )

async def ingest_document(document_id: UUID) -> None:
    """执行完整入库流程。"""
    logger.info("ingest start: document_id=%s", document_id)

    # 1. 第一段 session：只读出 cos_object_key 和文件名
    # 2. 切到 PARSING 状态，从 COS 下载原文，交给 Docling 解析
    # 3. 切到 INDEXING 状态，做切分 + 批量 embedding。注意 aembed_documents 是 LangChain 的异步批量接口，内部会按 chunk_size=10 自动分批
    # 4. 第二段 session：批量插入 chunks 并 commit
    # 5. 切到 READY 状态并清空 error_message
    # 6. 顶层 try / except：任意阶段抛异常都统一置为 FAILED，错误信息截断到 500 字符避免堆栈过长污染数据库

    try:
        # 1. 获取文档基础信息（使用一个短暂的数据库会话）
        async with AsyncSessionLocal() as session:
            doc_repo = DocumentRepository(session)
            document = await doc_repo.get_by_id(document_id)

            # 防御性判断：如果文档不存在，记录警告并直接退出，避免后续报错
            if document is None:
                logger.warning("document not found, skip ingest: %s", document_id)
                return

            # 提前取出后续需要用到的属性。
            # 因为在 with 块结束后，session 会关闭，如果后面再访问 document 对象，可能会引发懒加载报错。
            object_key = document.cos_object_key
            filename = document.name

        # 2. 状态更新为 PARSING（解析中）
        # 调用的是独立的 _set_status 函数，它会立刻 commit，保证前端轮询能看到进度
        await _set_status(document_id, DocumentStatus.PARSING)

        # 3. 从云存储（COS）下载文件内容
        content = await get_file_service().download(object_key)

        # 4. 调用解析器（如 Docling），把原始文件流解析成结构化的文本（Markdown）
        documents = await parser.parse(filename, content)

        # 5. 状态更新为 INDEXING（向量化中）
        await _set_status(document_id, DocumentStatus.INDEXING)

        # 6. 将长文本切分成小块（Chunks）
        chunks = splitter.split(documents)
        if not chunks:
            # 如果切分后为空，抛出异常，会触发外层的 except 块，把状态改为 FAILED
            raise ValueError("切分后没有任何 chunk，请检查文档内容")

        # 7. 调用 Embedding 模型（如阿里云 DashScope），将文本块转化为向量
        # aembed_documents 是 LangChain 提供的异步批量向量化方法
        embeddings = await embedder.get_embeddings().aembed_documents(
            [c.page_content for c in chunks]
        )

        # （接上文：在完成向量化之后）
        # 开启一个短事务，专门用于批量插入数据
        async with AsyncSessionLocal() as session:
            chunk_repo = DocumentChunkRepository(session)

            # 批量插入文档块。
            # 使用列表推导式构建 DocumentChunk 对象列表。
            await chunk_repo.bulk_add(
                [
                    DocumentChunk(
                        document_id=document_id,
                        content=c.page_content,  # 文本内容
                        content_tokens=segment(c.page_content),  # jieba 预分词，供全文检索
                        embedding=vec,  # 对应的向量 (list[float])
                        # 从 LangChain 的 metadata 字典中安全地提取页码（如果没有则返回 None）
                        page_no=c.metadata.get("page_no"),
                        section_path=c.metadata.get("section_path"),  # 提取章节路径
                        chunk_index=c.metadata["chunk_index"],  # 必填项，直接取值
                        chunk_hash=c.metadata["chunk_hash"],  # 必填项，用于增量索引比对
                        # 将完整的 metadata 存入 JSONB 字段，保留所有原始信息以备不时之需
                        extra_metadata=c.metadata,
                    )
                    # strict=True 是 Python 3.10+ 的安全特性：
                    # 如果 chunks 和 embeddings 的长度不一致，会立刻抛出 ValueError。
                    # 防止因为模型漏返回向量导致数据错位（将 A 的文本配上 B 的向量）。
                    for c, vec in zip(chunks, embeddings, strict=True)
                ]
            )
            # 提交事务，将所有 Chunks 真正写入数据库
            await session.commit()

        # 所有步骤成功！将文档状态更新为 READY（可检索），并清空错误信息
        # 注意：这里调用 _set_status 会开启一个新的短事务，立刻 commit，前端能瞬间看到状态变更。
        # PDF 生成缩略图
        await _attach_thumbnail(document_id, filename, content)
        await _set_status(document_id, DocumentStatus.READY, error_message=None)
        logger.info("ingest done: document_id=%s, chunks=%d", document_id, len(chunks))

    except Exception as exc:
        # ===== 异常兜底处理 =====
        # 只要上述任何一个环节（下载、解析、切分、向量化、入库）报错，都会跳到这里。

        # 记录完整的异常堆栈日志，方便后台排查
        logger.exception("ingest failed: document_id=%s", document_id)

        # 失败信息直接展示给用户，截断避免超长堆栈污染：
        # 1. 尝试获取异常的具体信息 `str(exc).strip()`
        # 2. 如果异常信息为空，则退而求其次，取异常的类名（如 'ValueError'）
        message = str(exc).strip() or exc.__class__.__name__

        # 更新状态为 FAILED。
        # 传入截断后的错误信息 `[:500]`，防止超出数据库字段长度限制或前端展示溢出。
        await _set_status(document_id, DocumentStatus.FAILED, error_message=message[:500])




# =====================================================================
# 方法作用：更新任务状态为“执行中（RUNNING）”。
# 因为是在 Celery 后台任务中调用的，脱离了 FastAPI 的请求上下文，
# 所以必须开启独立的数据库 Session，并手动 commit。
# =====================================================================
async def _mark_task(task_id: UUID, *, running: bool = False) -> None:
    # 开启独立数据库会话
    async with AsyncSessionLocal() as session:
        # 实例化任务仓储层
        repo = IngestionTaskRepository(session)
        # 如果传入了 running=True，则执行标记为“运行中”的逻辑
        if running:
            await repo.mark_running(task_id)
        # 提交事务，将状态更新落盘
        await session.commit()


# =====================================================================
# 方法作用：更新任务状态为“失败（FAILED）”，并记录错误信息。
# =====================================================================
async def _mark_task_failed(task_id: UUID, error_message: str) -> None:
    async with AsyncSessionLocal() as session:
        repo = IngestionTaskRepository(session)
        # 调用仓储层方法标记失败，并截断保留 500 字符的错误信息
        await repo.mark_failed(task_id, error_message)
        # 提交事务
        await session.commit()


# =====================================================================
# 方法作用：更新任务状态为“成功（SUCCESS）”。
# =====================================================================
async def _mark_task_success(task_id: UUID) -> None:
    async with AsyncSessionLocal() as session:
        repo = IngestionTaskRepository(session)
        # 调用仓储层方法标记成功，并记录完成时间
        await repo.mark_success(task_id)
        # 提交事务
        await session.commit()


# =====================================================================
# 方法作用：将长文本列表分批（Batch）进行向量化（Embedding），并在每批完成后更新任务进度。
# 这样前端轮询时，能看到进度条平滑地增长，而不是等所有文本都处理完才从 0 跳到 100。
# =====================================================================
async def _embed_with_progress(texts: list[str], task_id: UUID) -> list[list[float]]:
    """按 EMBEDDING_BATCH_SIZE 分批 embedding，逐批写入任务进度。

    LangChain `OpenAIEmbeddings.aembed_documents` 内部也会分批，但回调粒度藏在
    SDK 里；这里手动分批是为了让 `progress_done` 跟着每个批次走，前端轮询有连续反馈。
    """
    # 延迟导入配置，避免循环依赖
    from app.core.config import settings

    # 防御性判断：如果传入的文本列表为空，直接返回空列表，避免发起无意义的 API 请求
    if not texts:
        return []

    # 获取配置好的 Embedding 模型客户端（可能是 OpenAI，也可能是本地部署的模型）
    embeddings_client = embedder.get_embeddings()

    # 从配置读取批次大小。使用 max(1, ...) 兜底，防止配置写错成 0 或负数导致死循环
    batch_size = max(1, settings.embedding_batch_size)

    # 初始化一个结果列表，用于收集所有批次的向量结果
    results: list[list[float]] = []

    # 核心循环：使用 range 的步长（step）来实现分批切片
    # 例如：batch_size 为 10，start 依次为 0, 10, 20...
    for start in range(0, len(texts), batch_size):
        # 切片获取当前批次的文本片段
        batch = texts[start: start + batch_size]

        # 调用大模型/Embedding 接口，将当前批次的文本转化为向量列表
        vectors = await embeddings_client.aembed_documents(batch)

        # 把当前批次算出的向量追加到总结果列表中
        results.extend(vectors)

        # 【关键步骤】调用外部的进度更新函数，把当前批次的数量累加到数据库里的 progress_done 字段上
        await _increment_task_progress(task_id, len(batch))

    # 所有批次处理完毕，返回完整的向量列表
    return results


# =====================================================================
# 方法作用：文档首次入库（Ingest）的核心流水线。
# 负责：下载文件 -> 解析 -> 切分 -> 分批生成向量（更新进度） -> 向量落库 -> 更新最终状态。
# =====================================================================
async def _run_ingest(document_id: UUID, task_id: UUID) -> None:
    """首次入库：全量解析 -> 切分 -> embedding -> 写库。"""

    # 1. 记录开始日志，并把 Celery 任务状态标记为“运行中”
    logger.info("ingest start: document_id=%s task_id=%s", document_id, task_id)
    await _mark_task(task_id, running=True)

    try:
        # ================= 阶段 1：获取文档信息 =================
        # 开启一个独立的数据库会话
        async with AsyncSessionLocal() as session:
            # 查询对应的文档记录
            document = await DocumentRepository(session).get_by_id(document_id)

            # 防御性判断：如果文档不存在（可能刚被用户删了），直接标记任务失败并退出
            if document is None:
                logger.warning("document not found, skip ingest: %s", document_id)
                await _mark_task_failed(task_id, "文档不存在")
                return

            # 提取文件在对象存储（如阿里云 OSS / MinIO）中的路径和文件名
            object_key = document.cos_object_key
            filename = document.name

        # ================= 阶段 2：下载与解析 =================
        # 更新文档状态为“正在解析（PARSING）”，前端可以据此展示加载动画
        await _set_status(document_id, DocumentStatus.PARSING)
        # 从对象存储下载文件原始二进制数据
        content = await get_file_service().download(object_key)
        # 调用解析器，把 PDF/Word 转为纯文本
        parsed = await parser.parse(filename, content)

        # ================= 阶段 3：文本切分 =================
        # 更新文档状态为“正在建立索引（INDEXING）”
        await _set_status(document_id, DocumentStatus.INDEXING)
        # 把长篇大论的纯文本，切分成一段段适合大模型处理的 chunks
        chunks = splitter.split(parsed)

        # 如果切分后一个字都没有，说明文档损坏或是空文件，抛出异常
        if not chunks:
            raise ValueError("切分后没有任何 chunk，请检查文档内容")

        # ================= 阶段 4：向量化（Embedding） =================
        # 把总共需要处理的 chunk 数量告诉数据库，用于计算进度百分比
        await _set_task_total(task_id, len(chunks))
        # 调用你之前看过的分批向量化函数（内部会按批次更新进度条）
        embeddings = await _embed_with_progress(
            [c.page_content for c in chunks], task_id
        )

        # ================= 阶段 5：向量落库 =================
        # 再次开启独立会话，准备批量插入数据
        async with AsyncSessionLocal() as session:
            chunk_repo = DocumentChunkRepository(session)
            # 批量插入：将文本块和对应的向量一一对应，转换成数据库实体
            await chunk_repo.bulk_add(
                # strict=True 确保 chunks 和 embeddings 的数量绝对一致，防止数据错位
                [_make_chunk(document_id, c, vec) for c, vec in zip(chunks, embeddings, strict=True)]
            )
            # 提交事务，将数据落盘
            await session.commit()

        # ================= 阶段 6：完成收尾 =================
        # 将文档状态更新为“就绪（READY）”，并清空历史错误信息
        await _set_status(document_id, DocumentStatus.READY, error_message=None)
        # 将 Celery 任务状态标记为成功
        await _mark_task_success(task_id)
        logger.info("ingest done: document_id=%s chunks=%d", document_id, len(chunks))

    # ================= 异常兜底处理 =================
    except Exception as exc:
        # 记录详细报错堆栈
        logger.exception("ingest failed: document_id=%s", document_id)
        # 提取错误信息：如果是空字符串则用异常类名（如 ValueError）兜底
        message = str(exc).strip() or exc.__class__.__name__
        # 将文档标记为失败，并记录截断后的错误信息（前 500 字符）
        await _set_status(document_id, DocumentStatus.FAILED, error_message=message[:500])
        # 将 Celery 任务也标记为失败
        await _mark_task_failed(task_id, message)


# =====================================================================
# 函数作用：组装数据实体。
# 负责将 LangChain 切分出来的“文本块对象”以及“算好的向量”，
# 转换成数据库 ORM 模型（DocumentChunk），准备批量落库。
# =====================================================================
def _make_chunk(document_id: UUID, chunk: LangChainDocument, embedding: list[float]) -> DocumentChunk:
    # 实例化数据库实体对象并返回
    return DocumentChunk(
        # 1. 关联所属的文档 ID
        document_id=document_id,
        # 2. 提取文本正文内容
        content=chunk.page_content,
        # 3. 存入对应的高维向量
        embedding=embedding,

        # 4. 【安全提取】页码。可能存在也可能不存在，所以用 .get()，缺失则返回 None
        page_no=chunk.metadata.get("page_no"),
        # 5. 【安全提取】章节路径（如 "第一章/1.1节"），同样用 .get() 安全获取
        section_path=chunk.metadata.get("section_path"),

        # 6. 【强制提取】块索引。这是切分器必须生成的字段，如果缺失说明系统有 Bug，直接使用 [] 让其报错
        chunk_index=chunk.metadata["chunk_index"],
        # 7. 【强制提取】块的哈希值。用于后续增量更新（reindex）比对内容是否变化
        chunk_hash=chunk.metadata["chunk_hash"],

        # 8. 冗余快照：把整个原始 metadata 字典存下来（存为 JSONB），方便以后调试或展示完整信息
        extra_metadata=chunk.metadata,
    )

# =====================================================================
# 方法作用：文档增量重建（Reindex）的核心流水线。
# 负责：下载解析 -> 切分 -> 比对 Hash -> 按需走增量或全量重建 -> 版本号 +1。
# =====================================================================
async def _run_reindex(document_id: UUID, task_id: UUID) -> None:
    """增量重建：按 chunk_hash 对齐，仅对变化部分重新 embedding。

    与 _run_ingest 的区别：
    - 命中的 chunk 不重新计算 embedding，仅更新 chunk_index / metadata
    - 新增 chunk 才走 embedding，progress_total 也只统计新增数量
    - 全删全插作为 hash 冲突场景的兜底
    """
    # 1. 记录开始日志并标记任务为运行中
    logger.info("reindex start: document_id=%s task_id=%s", document_id, task_id)
    await _mark_task(task_id, running=True)

    try:
        # ================= 阶段 1：获取文档并下载 =================
        async with AsyncSessionLocal() as session:
            document = await DocumentRepository(session).get_by_id(document_id)
            if document is None:
                logger.warning("document not found, skip reindex: %s", document_id)
                await _mark_task_failed(task_id, "文档不存在")
                return
            object_key = document.cos_object_key
            filename = document.name

        await _set_status(document_id, DocumentStatus.PARSING)
        content = await get_file_service().download(object_key)
        parsed = await parser.parse(filename, content)

        # ================= 阶段 2：重新切分文本 =================
        await _set_status(document_id, DocumentStatus.INDEXING)
        new_chunks = splitter.split(parsed)
        if not new_chunks:
            raise ValueError("切分后没有任何 chunk，请检查文档内容")

        # ================= 阶段 3：拉取旧数据做 Hash 比对 =================
        # 拉旧 chunks 做 hash 对齐
        async with AsyncSessionLocal() as session:
            old_chunks = await DocumentChunkRepository(session).list_all_by_document(
                document_id
            )

        # ================= 阶段 4：判断走增量还是全量 =================
        if _has_duplicate_hash(new_chunks):
            # 同文档内 chunk_hash 重复（多见于极短文档或重复段落），
            # 增量对齐逻辑会歧义；退化为「全删全插」是最稳的兜底
            logger.warning(
                "reindex fallback to full rebuild due to duplicate chunk_hash: %s",
                document_id,
            )
            # 走全量重建逻辑
            await _run_full_rebuild(document_id, task_id, new_chunks)
        else:
            # 如果没有重复 hash，说明可以安全地按 Hash 进行精准增量对比
            await _run_incremental(document_id, task_id, old_chunks, new_chunks)

        # ================= 阶段 5：更新版本号 =================
        # 内容已成功重建：版本号 +1
        async with AsyncSessionLocal() as session:
            doc_repo = DocumentRepository(session)
            doc = await doc_repo.get_by_id(document_id)
            if doc is not None:
                doc.version += 1
            await session.commit()

        # ================= 阶段 6：完成收尾 =================
        await _set_status(document_id, DocumentStatus.READY, error_message=None)
        await _mark_task_success(task_id)

    # ================= 异常兜底处理 =================
    except Exception as exc:
        logger.exception("reindex failed: document_id=%s", document_id)
        message = str(exc).strip() or exc.__class__.__name__
        await _set_status(document_id, DocumentStatus.FAILED, error_message=message[:500])
        await _mark_task_failed(task_id, message)


# =====================================================================
# 函数作用：检查切分出来的文本块列表中，是否存在重复的 Hash 值。
# 用于规避增量更新的逻辑漏洞（比如一句话被切分成了两块一模一样的）。
# =====================================================================
def _has_duplicate_hash(chunks: list[LangChainDocument]) -> bool:
    # 使用 Set 记录已经出现过的 Hash 值，利用 Set 的 O(1) 查找特性极大提升比对速度
    seen: set[str] = set()
    for c in chunks:
        # 强制获取每个 chunk 的 hash 值（如果切分器没生成，这里会报 KeyError 提醒开发者）
        h = c.metadata["chunk_hash"]
        # 如果这个 Hash 已经在集合里了，说明出现了重复
        if h in seen:
            return True
        # 没重复，就加进集合里继续往后比
        seen.add(h)
    # 遍历完都没重复，返回 False
    return False


# =====================================================================
# 方法作用：文档增量重建（Incremental Reindex）的精确比对与执行逻辑。
# 核心思想：不全部删掉重来，而是通过比对 Hash 值，只删除废弃的、更新位置变动的、新增并计算未存在的。
# 这能极大节省大模型 Embedding 的 API 费用和时间。
# =====================================================================
async def   _run_incremental(
        document_id: UUID,
        task_id: UUID,
        old_chunks: list[DocumentChunk],  # 数据库里查出来的旧数据
        new_chunks: list[LangChainDocument],  # 刚刚切分出来的新数据
) -> None:
    """
    增量重建（Incremental Reindex）分类规则详解：

   核心思想：用最小的代价完成文档内容的同步。判断依据是 chunk_hash（文本块的哈希指纹）。
   只要文本内容一个字都没变，它的 Hash 就绝对一样；改了一个标点，Hash 就会天翻地覆。

   规则一：old 中存在，但 new 已经没有的 hash -> DELETE (彻底删除)

  规则二：new 中已存在的 hash -> 只更新 chunk_index / metadata (不重新 embedding)
  - 场景：用户没改内容，但文档结构变了。比如开头加了新页，导致后面的段落整体往后挪了一位（页码/序号变了）。
  - 动作：没必要再去花钱求大模型算 Embedding。只需更新数据库里的 page_no（页码）、chunk_index（顺序号）等元数据即可。这是省钱的绝对核心。

  规则三：new 中不存在于 old 的 hash -> INSERT (需要 embedding)
  - 场景：用户写了全新内容，或者修改了原有段落。
  - 动作：数据库里没有它的向量，必须调用 Embedding 模型算出高维向量，然后作为新的一行插入数据库。
   """
    # ================= 阶段 1：将旧数据转成字典，方便极速查找 =================
    # old_by_hash 字典的格式：{ "a1b2c3d4...": DocumentChunk对象, ... }
    # 用字典是为了让后续查找的时间复杂度从 O(N) 降到 O(1)
    old_by_hash = {c.chunk_hash: c for c in old_chunks}

    # 提取所有新文本块的 hash 值，存入集合（Set），同样是为了极速比对
    new_hashes = {c.metadata["chunk_hash"] for c in new_chunks}

    # ================= 阶段 2：找出需要彻底删除的旧数据 =================
    # 遍历旧数据，如果它的 hash 在新数据里找不到，说明这段内容在最新文档里被删除了
    # 1. 先准备一个空列表，用来装所有需要删除的文档块 ID
    to_delete_ids: list[UUID] = []

    # 2. 遍历数据库里查出来的所有旧文档块
    for c in old_chunks:
        # 3. 核心判断：看看这个旧块的指纹（hash），在最新的指纹集合里存不存在
        if c.chunk_hash not in new_hashes:
            # 4. 如果不在，说明这段话在新版文档里被删掉了，把它的 ID 记下来
            to_delete_ids.append(c.id)

    # ================= 阶段 3：对最新切分的数据进行分类 =================
    to_vector: list[LangChainDocument] = []  # 需要全新计算向量的新数据
    to_update: list[tuple[DocumentChunk, LangChainDocument]] = []  # 只需更新元数据的数据

    for nc in new_chunks:
        h = nc.metadata["chunk_hash"]
        # 去旧数据字典里找找，有没有一样的 hash
        existing = old_by_hash.get(h)

        if existing is None:
            # 找不到，说明这是文档更新后新增的内容，需要走向量计算
            to_vector.append(nc)
        else:
            # 找到了，说明内容没变（比如只是把这一段挪到了上面），不需要重新算向量，只更新序号
            # 注意这里存的是一个元组 (旧对象, 新对象)，方便后面比对属性
            to_update.append((existing, nc))

    # ================= 阶段 4：只对新增数据计算向量 =================
    # 进度条的总数只设为新增的数量
    await _set_task_total(task_id, len(to_vector))
    # 调用分批向量化函数（传空列表也不会报错，函数内部有兜底）
    new_embeddings = await _embed_with_progress(
        [c.page_content for c in to_vector], task_id
    )

    # ================= 阶段 5：数据库落库操作 =================
    async with AsyncSessionLocal() as session:
        chunk_repo = DocumentChunkRepository(session)

        # 1. 执行删除操作
        await chunk_repo.delete_by_ids(to_delete_ids)

        # 2. 更新命中的 chunk 的位置 / 段落元数据
        # 更新命中 chunk 的位置 / 段落元数据：内容（即 hash）未变所以不动 embedding
        for old, nc in to_update:
            old.chunk_index = nc.metadata["chunk_index"]
            old.page_no = nc.metadata.get("page_no")
            old.section_path = nc.metadata.get("section_path")
            old.extra_metadata = nc.metadata

        # 3. 批量插入新数据及其向量
        # 1. 先准备一个空的列表，用来装所有组装好的、准备插入数据库的实体对象
        chunks_to_insert = []

        # 2. 使用 zip 把文本块列表 (to_vector) 和向量列表 (new_embeddings) 一一配对，并遍历
        # 假设 to_vector 有 100 个文本，new_embeddings 有 100 个向量
        for c, vec in zip(to_vector, new_embeddings, strict=True):
            # c 是当前循环的文本块，vec 是它对应的向量

            # 3. 调用 _make_chunk 方法，把这两者加上 document_id，拼装成一个数据库 ORM 对象
            chunk_obj = _make_chunk(document_id, c, vec)

            # 4. 把拼装好的对象塞进大列表里
            chunks_to_insert.append(chunk_obj)

        # 5. 最终，把装满 100 个对象的列表，一次性丢给仓储层执行批量插入 (Bulk Insert)
        await chunk_repo.bulk_add(chunks_to_insert)
        # 4. 统一提交事务，保证删除、更新、插入要么全部成功，要么全部失败
        await session.commit()


# =====================================================================
# 方法作用：文档的全量重建（Full Rebuild）。
# 【业务场景】这是增量更新时的“兜底方案”。如果发现文档里有重复的 Hash（无法准确增量比对），
# 或者系统发生异常，就直接放弃增量，把旧的文本块全删了，重新算一遍所有向量并重新插入。
# =====================================================================
async def _run_full_rebuild(
        document_id: UUID,
        task_id: UUID,
        new_chunks: list[LangChainDocument],
) -> None:
    """hash 冲突场景的兜底：清空旧 chunks，全量 embedding 后写入。"""
    # 1. 设置进度条的总数（也就是最新切分出来的文本块总数）
    await _set_task_total(task_id, len(new_chunks))

    # 2. 对所有的文本块进行向量化。这会自动按批次跑，并且每跑完一批会去更新数据库里的 progress_done
    embeddings = await _embed_with_progress(
        [c.page_content for c in new_chunks], task_id
    )

    # 3. 开启独立数据库会话，准备执行“先删后插”的重建操作
    async with AsyncSessionLocal() as session:
        chunk_repo = DocumentChunkRepository(session)

        # 4. 【清空旧数据】把该文档在数据库里原先存的所有文本块数据全部删掉
        await chunk_repo.delete_by_document(document_id)

        # 5. 【批量插入新数据】将最新的文本块和刚算好的向量配对，组装成实体批量插入
        await chunk_repo.bulk_add(
            [
                _make_chunk(document_id, c, vec)
                # strict=True：防呆设计，确保文本块数量和向量数量严格一致，防止数据错位
                for c, vec in zip(new_chunks, embeddings, strict=True)
            ]
        )
        # 6. 提交事务，让删除和插入同时生效
        await session.commit()


# =====================================================================
# 方法作用：更新任务的总进度数值（用于计算百分比）。
# =====================================================================
async def _set_task_total(task_id: UUID, total: int) -> None:
    async with AsyncSessionLocal() as session:
        repo = IngestionTaskRepository(session)
        # 调用仓储层设置总进度
        await repo.set_progress_total(task_id, total)
        # 提交事务落盘
        await session.commit()


# =====================================================================
# 方法作用：增加任务的已完成进度数值。
# =====================================================================
async def _increment_task_progress(task_id: UUID, delta: int) -> None:
    async with AsyncSessionLocal() as session:
        repo = IngestionTaskRepository(session)
        # 调用仓储层，把已完成数（progress_done）加上本次处理的批次数量
        await repo.increment_progress(task_id, delta)
        # 提交事务落盘
        await session.commit()


# =====================================================================
# 函数作用：首次入库的“同步入口”。
# 因为 Celery Worker 是同步进程，而底层业务逻辑（_run_ingest）是异步的，
# 所以用 asyncio.run() 启动一个独立的事件循环来执行它。
# =====================================================================
def run_ingest_sync(document_id: UUID, task_id: UUID) -> None:
    # 运行异步的 _run_ingest 协程，直到它执行完毕
    asyncio.run(_run_ingest(document_id, task_id))


# =====================================================================
# 函数作用：增量重建的“同步入口”。
# 作用和上面完全一样，只是调用的底层业务逻辑变成了 _run_reindex。
# =====================================================================
def run_reindex_sync(document_id: UUID, task_id: UUID) -> None:
    # 运行异步的 _run_reindex 协程，直到它执行完毕
    asyncio.run(_run_reindex(document_id, task_id))