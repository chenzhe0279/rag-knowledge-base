import hashlib
from pathlib import PurePath
from typing import Sequence
from uuid import UUID

from app.api.schemas.documents import DocumentRead, IngestionTaskRead
from app.ingestion.tasks import ingest_document_task
from fastapi import BackgroundTasks, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from app.ingestion.tasks import reindex_document_task
from app.core.config import settings
from app.core.exceptions import NotFoundError, ValidationError
from app.core.logger import get_logger
from app.db.models import Document, DocumentChunk, DocumentStatus, IngestionTaskType, IngestionTask
from app.db.repositories.chunk_repo import (
    ChunkStats,
    DocumentChunkRepository,
)
from app.db.repositories.document_repo import DocumentRepository
from app.db.repositories.ingestion_task_repo import IngestionTaskRepository
from app.ingestion.pipeline import ingest_document
from app.services.role_service import _normalize_tags
from app.storage.file_service import FileService, get_file_service
import asyncio
from app.ingestion.thumbnail import generate_manual_thumbnail

# 受支持的 MIME 类型
# 字典结构：{ MIME类型 : 标准后缀 }，用于进行文件安全白名单校验
_ACCEPTED_MIME_TYPES: dict[str, str] = {
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "text/markdown": ".md",
    "text/x-markdown": ".md",
    "text/html": ".html",
    "application/xhtml+xml": ".html",
    # ===== 新增 PPTX 和 XLSX =====
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
}

# 后缀白名单
# 字典结构：{ 文件后缀 : MIME类型 }，作用同上
_ACCEPTED_SUFFIXES: dict[str, str] = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".html": "text/html",
    ".htm": "text/html",
    # ===== 新增 PPTX 和 XLSX =====
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}

# 删除允许的状态：终态 + uploading（uploading 时后台任务还没真正写 chunks）
_DELETABLE_STATUSES = frozenset(
    {DocumentStatus.READY, DocumentStatus.FAILED, DocumentStatus.UPLOADING}
)


THUMBNAIL_MAX_UPLOAD_MB = 10  # 缩略图上传上限
THUMBNAIL_MAX_UPLOAD_BYTES = THUMBNAIL_MAX_UPLOAD_MB * 1024 * 1024  # 转字节
_THUMBNAIL_SUFFIXES = {".pdf", ".jpg", ".jpeg", ".png", ".webp"}  # 允许后缀

MAX_DOCUMENT_NAME_LENGTH = 255  # 与前端一致
_INVALID_NAME_CHARS = frozenset('\\/:*?"<>|')  # Windows 非法字符

def _resolve_mime_and_suffix(file: UploadFile) -> tuple[str, str]:
    """根据 UploadFile 的 content_type 和扩展名共同判定。

    浏览器上传 .md 时常给 application/octet-stream，所以扩展名优先级更高。

    :return: 返回一个元组 (可信的MIME类型, 归一化后的文件后缀)
    """
    # 1. 提取文件后缀名
    # PurePath 用于提取文件名，如果 filename 为 None 则使用空字符串兜底，防止报错
    # .suffix 获取后缀（如 ".md"），.lower() 统一转成小写，防止大写后缀（如 .PDF）被漏判
    suffix = PurePath(file.filename or "").suffix.lower()

    # 2. 优先通过后缀名进行匹配
    if suffix in _ACCEPTED_SUFFIXES:
        # 后缀在白名单中，直接信任它的 MIME 类型（修复浏览器上传 .md 时类型不准的问题）
        return _ACCEPTED_SUFFIXES[suffix], suffix

    # 3. 如果后缀没匹配上，则尝试通过浏览器上报的 MIME 类型匹配
    mime = file.content_type or ""
    if mime in _ACCEPTED_MIME_TYPES:
        # MIME 在白名单中，返回 MIME 及其对应的标准后缀
        return mime, _ACCEPTED_MIME_TYPES[mime]

    # 4. 如果后缀和 MIME 都不在白名单中，抛出业务异常（拦截恶意文件或格式不兼容文件）
    raise ValidationError(
        f"不支持的文件类型：{file.filename}（{mime or '未知'}）。"
         "当前仅支持 PDF、DOCX、PPTX、XLSX、Markdown、HTML"
    )


logger = get_logger(__name__)


class DocumentService:
    """
    文档服务类（业务逻辑层）。
    负责编排各种操作：校验文件、计算哈希、去重、调用云存储上传等。
    """

    def __init__(self, session: AsyncSession, file_service: FileService | None = None) -> None:
        """
        初始化服务。
        :param session: 数据库异步会话，用于实例化各种 Repository。
        :param file_service: 可选的文件存储服务。如果不传，则默认调用 get_file_service() 获取全局实例。
        """
        self.session = session
        # 初始化文档仓储和文档块仓储，复用同一个 session 以保证事务一致性
        self.repo = DocumentRepository(session)
        self.chunk_repo = DocumentChunkRepository(session)
        self.task_repo = IngestionTaskRepository(session)
        # 依赖注入：如果外部传了就用外部的，否则用默认的
        self.file_service = file_service or get_file_service()

    async def upload(self, file: UploadFile, *, created_by: UUID | None = None, permission_tags: Sequence[str] | None = None,) -> Document:
        """
        处理文档上传的核心业务逻辑。
        """
        # 1. 解析并校验文件类型和后缀
        # _resolve_mime_and_suffix 会根据后缀和 MIME 判断是否支持，如果支持则返回标准值
        mime_type, suffix = _resolve_mime_and_suffix(file)

        # 2. 读取文件内容（二进制字节）
        content = await file.read()

        # 3. 计算允许的最大字节数（配置文件里是 MB，这里转换成字节：MB * 1024 * 1024）
        max_bytes = settings.upload_max_size_mb * 1024 * 1024

        # 4. 校验文件是否为空
        if len(content) == 0:
            raise ValidationError("上传文件为空")

        # 5. 校验文件是否超过大小限制
        if len(content) > max_bytes:
            raise ValidationError(f"文件超过 {settings.upload_max_size_mb} MB 上限")

        # 6. 计算文件的 SHA256 哈希值
        # 用于实现“秒传”/“文件去重”。只要内容一样，哈希值就一样。
        file_hash = hashlib.sha256(content).hexdigest()

        # 7. 查库，判断这个文件是不是之前已经传过了（命中幂等）
        existing = await self.repo.get_by_hash(file_hash)
        if existing is not None:
            # 命中幂等：直接复用现有记录，不重复入库、不重复传云存储
            logger.info("file_hash hit, reuse document: %s", existing.id)
            # 直接返回已存在的文档记录给前端
            return existing

        # 8. 如果没有命中幂等，说明是新文件
        # 将文件上传到腾讯云 COS 等对象存储中
        # 返回的 object_key 是文件在云端的唯一路径（例如 documents/hash.pdf）
        object_key = await self.file_service.upload(
            content=content,
            file_hash=file_hash,
            suffix=suffix,
            mime_type=mime_type,
        )
        # 1. 实例化 Document 数据库模型对象，准备持久化
        document = Document(
            # 如果用户上传的文件带有文件名则使用，否则用哈希值和后缀兜底生成一个
            name=file.filename or f"{file_hash}{suffix}",
            file_hash=file_hash,  # 文件的 SHA256 唯一指纹
            mime_type=mime_type,  # 文件的标准 MIME 类型
            size=len(content),  # 文件真实字节大小
            storage_provider="cos",  # 存储提供商设为腾讯云 COS
            cos_bucket=self.file_service.bucket,  # 所在的存储桶
            cos_object_key=object_key,  # 在云存储中的具体路径（Key）
            cos_region=self.file_service.region,  # 存储桶所在地域
            status=DocumentStatus.UPLOADING,  # 初始状态设为“上传中”
            permission_tags=_normalize_tags(permission_tags),
            created_by=created_by,
        )

        # 2. 将对象加入当前 SQLAlchemy 的 session 会话中（此时还在内存，没有落库）
        await self.repo.add(document)

        # 调用入库任务仓储层（Repository）的 create 方法，在数据库中创建一条新的任务记录。
        # 执行成功后，返回的 task 对象里已经包含了数据库自动生成的主键 ID、状态（PENDING）和创建时间。
        task = await self.task_repo.create(document.id, IngestionTaskType.INGEST)

        # 3. 提交事务，将这条记录真正写入数据库
        await self.session.commit()

        # 4. 刷新对象状态（极其关键！）
        # commit 后，数据库会自动生成 UUID 主键、创建时间等默认值。
        # refresh 会重新从数据库拉取这些最新值，同步到内存的 document 对象上，
        # 保证下面能正确获取到 document.id。
        await self.session.refresh(document)

        # 核心纪律：必须在数据库 session.commit() 之后，才能调用 Celery 的 delay 派发任务。
        # 因为 Celery Worker 是另一个独立的进程，它执行任务时会开启自己独立的数据库 Session。
        # 只有主线程 commit 成功了，Worker 那边才能查到刚刚插入的 document 和 task 记录，否则会报“查无此数据”。
        ingest_document_task.delay(str(document.id), str(task.id))

        # 6. 将生成的文档信息返回给前端（此时状态为 UPLOADING，前端可以凭 ID 轮询状态）
        return document

    # =====================================================================
    # 方法作用：更新指定文档的可见性权限标签（通常仅管理员可用）。
    # 核心逻辑：查出文档 -> 校验存在性 -> 清洗新标签 -> 赋值并提交入库。
    # =====================================================================
    async def update_permission_tags(self, document_id: UUID, tags: Sequence[str]) -> Document:
        """admin 修改文档可见性标签。"""

        # 1. 根据文档 ID 去数据库查询对应的文档对象
        doc = await self.repo.get_by_id(document_id)

        # 2. 防御性校验：如果数据库里没找到这个文档，直接抛出 404 业务异常
        if doc is None:
            raise NotFoundError("文档不存在")

        # 3. 【核心修改】将前端传来的标签列表传入 _normalize_tags 进行清洗（去重、去空格），并重新赋值给文档对象
        doc.permission_tags = _normalize_tags(tags)

        # 4. 提交数据库事务，将修改真正持久化落盘
        await self.session.commit()

        # 5. 刷新实体：因为刚刚修改了数据，重新读取一遍数据库，确保返回给前端的对象状态是最新的
        await self.session.refresh(doc)

        # 6. 返回更新后的文档对象
        return doc



    async def get(self, document_id: UUID, *, permission_tags: list[str] | None = None) -> Document:
        """
        根据文档 ID 获取单个文档。
        如果文档不存在，则抛出业务异常。
        """
        # 调用仓储层（Repository）去数据库查询
        doc = await self.repo.get_by_id(document_id, permission_tags=permission_tags)

        # 如果查不到，说明数据不存在或已被删除，抛出 404 业务异常
        if doc is None:
            raise NotFoundError("文档不存在")

        # 查到则正常返回 Document 对象
        return doc

    async def list_documents(self, page: int, page_size: int, *, status: DocumentStatus | None = None, permission_tags: list[str] | None = None) -> tuple[list[Document], int]:
        """
        分页获取文档列表。

        :param page: 页码
        :param page_size: 每页数量
        :param status: 可选的文档状态过滤条件（使用了 * 强制关键字传参）
        :return: 返回元组 (当前页的文档列表, 总记录数)
        """
        # 直接透传给仓储层的分页查询方法。
        # 服务层（Service）在这里主要负责编排，具体的分页 SQL 逻辑由仓储层处理。
        return await self.repo.list_paginated(page, page_size, status=status, permission_tags=permission_tags)

    async def delete(self, document_id: UUID) -> None:
        """删除文档。

        DB 是真相之源：先删 DB 行再删 COS object，COS 删除失败仅打 warning，
        避免出现"DB 还在 / 用户以为删了"的更糟状态。
        """
        # 1. 先查询数据库，确认该文档是否存在
        doc = await self.repo.get_by_id(document_id)
        if doc is None:
            raise NotFoundError("文档不存在")

        # 2. 状态安全校验
        # 只有处于特定状态（如 READY, FAILED, UPLOADING）时才允许删除。
        # 如果文档正在 PARSING 或 INDEXING 中，此时删除会导致后台任务找不到数据而崩溃，或者产生孤儿文件。
        if doc.status not in _DELETABLE_STATUSES:
            raise ValidationError("文档处理中，请等待完成或失败后再删除")

        # 3. 提前提取 COS 的对象路径（Key）
        # 因为下一步删完数据库后，这个 ORM 对象就失效了，所以必须先把 key 存到局部变量里。
        object_key = doc.cos_object_key

        # 4. 从数据库删除记录（此时只是标记为删除状态）
        await self.repo.delete(doc)

        # 5. 提交数据库事务（此时数据才真正从 DB 中消失）
        await self.session.commit()

        # 6. 删除云存储（COS）中的物理文件
        # 【设计考量】：因为 DB 已经 commit，如果 COS 删除失败，只会抛出异常/打日志，
        # 但 DB 记录已经删了。用户端看到的就是“删除成功”。
        # 这样做虽然会留下极少数“孤儿文件”（浪费一点存储空间），但保证了用户交互体验和主数据的强一致性。
        thumbnail_key = doc.thumbnail_object_key  # 先保存 key
        await self.file_service.delete(object_key)
        if thumbnail_key is not None:  # 有缩略图
            await self.file_service.delete(thumbnail_key)  # 删除缩略图

        # 7. 记录操作日志，方便追踪和审计
        logger.info("document deleted: id=%s", document_id)

    async def retry(self, document_id: UUID) -> Document:
        """从 failed 重新触发 ingest（文档解析入库流程）。"""

        # 1. 先查询数据库，确认文档是否存在
        doc = await self.repo.get_by_id(document_id)
        if doc is None:
            raise NotFoundError("文档不存在")

        # 2. 状态校验：只有“失败(FAILED)”状态的文档才允许重试
        # 防止用户对一个已经成功(READY)或正在处理中(PARSING/INDEXING)的文档重复提交任务，
        # 避免引发并发冲突或产生重复的 chunks 数据。
        if doc.status != DocumentStatus.FAILED:
            raise ValidationError("仅失败状态的文档支持重试")

        # 3. 防御性清场（极其关键的容错设计）
        # 理论上 failed 状态的文档不应该有 chunks，但如果在“写入 chunks”阶段因为网络中断或数据库超时导致部分成功，
        # 数据库里就会残留“半截”的脏数据。
        # 所以在重新开始前，必须把这些可能存在的残留 chunks 彻底删干净，确保重试是“从零开始”的。
        await self.chunk_repo.delete_by_document(document_id)

        # 4. 重置文档状态机与错误信息
        # 将状态改回 UPLOADING，清空之前的报错信息，相当于让文档“格式化”回到刚上传时的初始状态。
        doc.status = DocumentStatus.UPLOADING
        doc.error_message = None
        task = await self.task_repo.create(doc.id, IngestionTaskType.INGEST)
        # 5. 提交事务，将状态变更和清场操作真正落库
        await self.session.commit()

        # 6. 刷新对象状态，确保获取到最新的数据库数据（如更新时间等）
        await self.session.refresh(doc)

        # 调用 Celery 任务的 .delay() 方法，将任务异步派发（发送）到 Redis 消息队列中。
        # - ingest_document_task：是在 tasks.py 中通过 @celery_app.task 定义的 Celery 任务函数。
        # - str(doc.id) 和 str(task.id)：将 UUID 对象转换为字符串。
        #   原因：Celery 底层需要把参数序列化为 JSON 格式通过网络传输，而 JSON 原生不支持 UUID 类型，直接传对象会报错。
        #   （Worker 进程接收到字符串后，会再次用 UUID() 转换回对象）。
        # 执行这行代码后，请求会立刻继续往下走（不会阻塞等待），而真正的处理会在后台 Worker 中进行。
        ingest_document_task.delay(str(doc.id), str(task.id))

        # 8. 记录重试日志，返回最新的文档对象给前端展示
        logger.info("document retry scheduled: id=%s", document_id)
        return doc

    async def list_chunks(self, document_id: UUID, page: int, page_size: int, *, permission_tags: list[str] | None = None) -> tuple[list[DocumentChunk], int, ChunkStats | None]:
        """
        分页获取指定文档下的文本块列表，并附带该文档的 chunk 统计信息。

        :return: 返回一个元组 (当前页的 chunk 列表, 总条数, 统计信息对象或 None)
        """
        # 【核心前置校验】：先确保 document 存在。
        # 否则，如果前端传了一个不存在的 document_id，下面的查询会返回空列表 [] 和 0。
        # 前端无法区分到底是“该文档下没有 chunk”，还是“该文档根本不存在”。
        # 调用 self.get() 若找不到会直接抛出 NotFoundError，阻断后续查询。
        await self.get(document_id, permission_tags=permission_tags)

        # 1. 分页查询当前页的 chunks 列表及总数
        items, total = await self.chunk_repo.list_paginated_by_document(
            document_id, page, page_size
        )

        # 2. 查询该文档下所有 chunks 的聚合统计信息（最大/最小/平均长度等）
        stats = await self.chunk_repo.get_stats(document_id)

        # 3. 返回完整的业务数据
        return items, total, stats

    async def get_chunk(self, document_id: UUID, chunk_id: UUID, *, permission_tags: list[str] | None = None) -> DocumentChunk:
        """
        获取指定文档下的单个 chunk 详情。

        :param document_id: 文档 ID（用于权限归属校验）
        :param chunk_id: 文本块 ID
        """
        # 双重校验:先确保用户能看到document，再校验chunk归属
        await self.get(document_id, permission_tags=permission_tags)
        # 调用仓储层方法，使用 document_id + chunk_id 双条件查询。
        # 这样即使有人恶意猜测其他文档的 chunk_id，也会因为 document_id 不匹配而查不到（防止水平越权）。
        chunk = await self.chunk_repo.get_for_document(document_id, chunk_id)

        # 如果查不到，说明该 chunk 不存在，或者不属于这个 document
        if chunk is None:
            raise NotFoundError("Chunk 不存在")

        # 返回找到的文本块对象
        return chunk

    async def get_thumbnail(self, document_id: UUID) -> bytes:  # 读取缩略图
        document = await self.get(document_id)  # 文档不存在抛 404
        if document.thumbnail_object_key is None:  # 没有缩略图
            raise NotFoundError("缩略图不存在")  # 404
        return await self.file_service.download(document.thumbnail_object_key)

    # 定义异步方法，用于处理用户手动上传的缩略图（支持图片或 PDF 第一页）。
    # 传入参数：文档 ID 和用户上传的文件对象。
    async def upload_thumbnail(self, document_id: UUID, file: UploadFile) -> Document:
        # 1. 先根据 ID 查询文档，确认文档存在。
        # 如果不存在，底层的 get 方法会直接抛出 NotFoundError (404)。
        document = await self.get(document_id)

        # 2. 获取文件名。如果用户上传的文件没有文件名（极端情况），用 "thumbnail" 兜底。
        filename = file.filename or "thumbnail"

        # 3. 提取文件后缀并统一转为小写（如 .JPG 转为 .jpg）。
        suffix = PurePath(filename).suffix.lower()

        # 4. 校验后缀是否在白名单内（白名单包含 PDF 和常见图片格式）。
        if suffix not in _THUMBNAIL_SUFFIXES:
            # 如果不支持，抛出 400 参数校验异常。
            raise ValidationError(
                "缩略图仅支持 PDF、JPG、JPEG、PNG、WebP"
            )

        # 5. 异步读取上传文件的完整二进制内容到内存中。
        content = await file.read()

        # 6. 校验空文件。如果文件大小为 0，直接拒绝。
        if not content:
            raise ValidationError("缩略图文件为空")

        # 7. 校验文件大小。超过配置的限制（如 5MB）直接拒绝，防止恶意大文件攻击。
        if len(content) > THUMBNAIL_MAX_UPLOAD_BYTES:
            raise ValidationError(
                f"缩略图不能超过 {THUMBNAIL_MAX_UPLOAD_MB} MB"
            )

        # 8. 进入核心处理逻辑，使用 try 块包裹以捕获可能的异常。
        try:
            # 因为图片解码、PDF渲染是极度消耗CPU的同步操作，
            # 使用 asyncio.to_thread 丢入后台线程执行，避免阻塞事件循环。
            # 使用 asyncio.wait_for 设置 90 秒超时，防止处理死循环卡死服务器。
            webp = await asyncio.wait_for(
                asyncio.to_thread(
                    generate_manual_thumbnail,  # 底层处理函数
                    filename,  # 文件名
                    content,  # 文件内容
                ),
                timeout=90,
            )

        # 捕获底层处理函数主动抛出的 ValueError（如：图片像素过大、格式损坏等）。
        except ValueError as exc:
            # 将内部的 ValueError 转化为 FastAPI 的 ValidationError (400)，并原样抛出错误信息。
            raise ValidationError(str(exc)) from exc

        # 捕获其他所有未预期的异常（如内存溢出、Pillow底层报错等）。
        except Exception as exc:
            # 使用 logger.exception 记录完整的异常堆栈日志，方便后端排查。
            logger.exception(
                "manual thumbnail failed: document_id=%s",
                document_id,
            )
            # 向外抛出一个对用户友好的、不包含技术细节的错误提示。
            raise ValidationError("缩略图处理失败，请换一张图片或 PDF") from exc

        # 9. 防御性判断：如果处理函数没报错，但没返回图片数据（理论不该发生）。
        if not webp:
            raise ValidationError("缩略图生成失败")

        # 10. 将生成的 WebP 字节流上传到云存储（如 COS），返回云端的 object_key（存储路径）。
        key = await self.file_service.upload_thumbnail(document.id, webp)

        # 11. 将云存储的 key 赋值给当前文档实体的缩略图字段。
        document.thumbnail_object_key = key

        # 12. 提交数据库事务，将新的缩略图 key 永久保存到数据库。
        await self.session.commit()

        # 13. 刷新对象状态。确保获取到数据库自动生成的最新 update_time 等字段，返回给前端。
        await self.session.refresh(document)

        # 14. 返回更新后的完整文档对象。
        return document

    # 定义异步方法，用于重命名指定的文档。
    # 传入参数：文档 ID 和新的文件名。
    async def rename(self, document_id: UUID, new_name: str) -> Document:
        # 1. 先根据 ID 查询文档，确认文档是否存在。
        # 如果不存在，底层的 get 方法会抛出 NotFoundError (404)。
        document = await self.get(document_id)

        # 2. 清理用户输入：去掉字符串首尾的空格和不可见字符。
        cleaned = new_name.strip()

        # 3. 校验空名称：如果清理后为空字符串，拒绝修改。
        if not cleaned:
            raise ValidationError("文件名不能为空")

        # 4. 校验长度限制：防止文件名过长导致数据库字段溢出或操作系统报错。
        if len(cleaned) > MAX_DOCUMENT_NAME_LENGTH:
            raise ValidationError(
                f"文件名不能超过 {MAX_DOCUMENT_NAME_LENGTH} 个字符"
            )

        # 5. 校验特殊路径名：禁止使用 "." 或 ".."，防止路径遍历漏洞（Path Traversal）。
        if cleaned in {".", ".."}:
            raise ValidationError("文件名不能是 . 或 ..")

        # 6. 校验非法字符：禁止包含 Windows/Linux 文件系统中不兼容的字符（如 \ / : * ? " < > |）。
        if any(char in _INVALID_NAME_CHARS for char in cleaned):
            raise ValidationError('文件名不能包含 \\ / : * ? " < > |')

        # 7. 校验控制字符：如果包含 ASCII 码小于 32 的字符（如换行符、制表符、空字符），拒绝修改。
        if any(ord(char) < 32 for char in cleaned):
            raise ValidationError("文件名不能包含控制字符")

        # 8. 校验结尾字符：禁止以句点或空格结尾（Windows 系统不允许这种文件名，容易导致创建文件失败）。
        if cleaned.endswith((".", " ")):
            raise ValidationError("文件名不能以句点或空格结尾")

        # 9. 提取原始文件名和后缀，以及用户输入的新后缀。
        old_suffix = PurePath(document.name).suffix
        new_suffix = PurePath(cleaned).suffix

        # 10. 校验后缀一致性：禁止用户通过重命名修改文件扩展名（如把 .pdf 改成 .exe），防止系统解析错误或安全风险。
        if new_suffix != old_suffix:
            raise ValidationError("不允许修改文件扩展名")

        # 11. 幂等性处理：如果用户输入的新名字和旧名字完全一样，直接返回当前对象，避免无意义的数据库写入。
        if cleaned == document.name:
            return document

        # 12. 执行重命名：将文档实体的 name 属性更新为清理后的新名称。
        document.name = cleaned

        # 13. 提交数据库事务，将新名称持久化保存。
        await self.session.commit()

        # 14. 刷新对象状态：从数据库重新读取最新数据，同步 updated_at 等自动更新的字段。
        await self.session.refresh(document)

        # 15. 返回更新后的文档对象。
        return document


    # =====================================================================
    # 方法作用：用新文件替换旧文档，并触发“增量重建（Reindex）”任务。
    # 【业务规则】
    # 1. 状态校验：只允许在 READY(就绪) 或 FAILED(失败) 状态下重新索引，防止和正在跑的 ingest 抢资源。
    # 2. 类型校验：新文件 MIME 类型必须和原文件一致（PDF 不能换成 Markdown）。
    # 3. 前置覆盖：新文件会覆盖对象存储中的同一个 object_key。
    # 4. 版本号：version+1 由 Worker 在重建成功后才提交，防止失败时前端看到版本变了但内容没变。
    # =====================================================================
    async def reindex(self, document_id: UUID, file: UploadFile,) -> Document:
        """用新文件替换原文档并触发增量重建。"""

        # ================= 阶段 1：前置校验 =================
        # 查询数据库
        doc = await self.repo.get_by_id(document_id)
        if doc is None:
            raise NotFoundError("文档不存在")

        # 校验状态：如果在解析中或索引中，说明后台正在跑，不能允许重新触发
        if doc.status not in {DocumentStatus.READY, DocumentStatus.FAILED}:
            raise ValidationError("文档处理中，请等待完成或失败后再重新索引")

        # 解析新文件的 MIME 类型和后缀，并校验是否与原文档一致
        mime_type, suffix = _resolve_mime_and_suffix(file)
        if mime_type != doc.mime_type:
            raise ValidationError(
                f"新版本文件类型必须与原文档一致（当前为 {doc.mime_type}）"
            )

        # ================= 阶段 2：文件内容校验 =================
        # 读取文件内容并校验大小
        content = await file.read()
        max_bytes = settings.upload_max_size_mb * 1024 * 1024
        if len(content) == 0:
            raise ValidationError("上传文件为空")
        if len(content) > max_bytes:
            raise ValidationError(f"文件超过 {settings.upload_max_size_mb} MB 上限")

        # 【核心省钱机制】计算新文件的 Hash 值，如果和旧的一模一样，直接拒绝
        new_hash = hashlib.sha256(content).hexdigest()
        if new_hash == doc.file_hash:
            # 内容完全一致没有重建必要，避免浪费 embedding 配额
            raise ValidationError("文件内容与现有版本一致，无需重新索引")

        # ================= 阶段 3：上传新文件到对象存储 =================
        # 将新文件内容上传到 COS（它会自动覆盖同名的 object_key）
        new_object_key = await self.file_service.upload(
            content=content,
            file_hash=new_hash,
            suffix=suffix,
            mime_type=mime_type,
        )

        # ================= 阶段 4：更新数据库文档记录 =================
        # 将最新的文件属性（Hash、大小、存储路径）更新到文档对象上
        doc.file_hash = new_hash
        doc.size = len(content)
        doc.cos_object_key = new_object_key
        doc.cos_bucket = self.file_service.bucket
        doc.cos_region = self.file_service.region
        # 状态设为解析中，清空历史错误信息
        doc.status = DocumentStatus.PARSING
        doc.error_message = None
        # 如果前端传了新文件名，顺便更新（通常同名替换不需要）
        if file.filename:
            doc.name = file.filename

        # ================= 阶段 5：创建任务并派发 =================
        # 在数据库里创建一条类型为 REINDEX 的任务记录
        task = await self.task_repo.create(doc.id, IngestionTaskType.REINDEX)

        # 必须先 commit，后台 Worker 才能查到这些刚刚更新的数据
        await self.session.commit()
        await self.session.refresh(doc)

        # 将耗时任务丢给 Celery 异步执行
        reindex_document_task.delay(str(doc.id), str(task.id))
        logger.info("document reindex scheduled: id=%s", document_id)

        # 返回更新了状态的 doc 对象给前端
        return doc

    # =====================================================================
    # 方法作用：获取指定文档最近一次的处理任务（用于前端展示进度条或错误）。
    # =====================================================================
    async def get_latest_task(self, document_id: UUID) -> IngestionTask | None:
        return await self.task_repo.get_latest_by_document(document_id)


    # =====================================================================
    # 方法作用：批量获取多篇文档的最新任务（列表页专用，一次 SQL）。
    # =====================================================================
    async def get_latest_tasks(self, document_ids: list[UUID]) -> dict[UUID, IngestionTask]:
        return await self.task_repo.get_latest_by_documents(document_ids)



# =====================================================================
# 函数作用：把 Document 实体 + 它的最新任务，纯内存组装成 DocumentRead。
# 不查库，供单条和批量两种场景共用。
# =====================================================================
def _document_read_from(document: Document, latest: IngestionTask | None) -> DocumentRead:
    """纯组装：Document + latest_task -> DocumentRead（不访问数据库）。"""

    return DocumentRead.model_validate(
        {
            # 遍历 Document 表的所有列，自动同步字段；以后加列这里不用改
            **{c.name: getattr(document, c.name) for c in document.__table__.columns},

            # thumbnail_url 是 Python @property，不在表列里，必须显式补上，
            # 否则响应里永远是 null，前端只能显示 PDF/MD 占位图
            "thumbnail_url": document.thumbnail_url,

            # 最新任务：有就转换，没有（刚上传还没建任务）就返回 None
            "latest_task": IngestionTaskRead.model_validate(latest)
            if latest is not None
            else None,
        }
    )


# =====================================================================
# 函数作用：单条文档 -> DocumentRead（会查一次 latest_task）。
# 上传 / 详情 / 重试 / 重命名 / 改权限等单文档接口继续用它。
# =====================================================================
async def _to_document_read(document: Document, service: DocumentService) -> DocumentRead:
    latest = await service.get_latest_task(document.id)
    return _document_read_from(document, latest)


# =====================================================================
# 函数作用：列表页批量组装 DocumentRead。
# 【核心优化】所有 latest_task 合并成一次 SQL，消掉 N+1。
# =====================================================================
async def _to_document_reads(documents: list[Document], service: DocumentService) -> list[DocumentRead]:
    """批量组装：一次查完当前页所有 latest_task，再逐篇转换。"""
    # 1. 一次 SQL 取回当前页所有文档的最新任务
    latest_map = await service.get_latest_tasks([doc.id for doc in documents])

    # 2. 按原列表顺序逐篇组装，保证分页顺序不变；查不到的文档 latest_task 为 None
    return [
        _document_read_from(doc, latest_map.get(doc.id))
        for doc in documents
    ]