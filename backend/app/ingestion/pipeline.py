from uuid import UUID

from app.core.logger import get_logger
from app.db.models import DocumentChunk, DocumentStatus
from app.db.repositories.chunk_repo import DocumentChunkRepository
from app.db.repositories.document_repo import DocumentRepository
from app.db.session import AsyncSessionLocal
from app.ingestion import embedder, parser, splitter
from app.storage.file_service import get_file_service

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