from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, File, Query, Response, UploadFile

from app.api.deps import DbSession
from app.api.schemas.documents import (
    DocumentChunkDetail,
    DocumentChunkListResponse,
    DocumentChunkRead,
    DocumentChunkStats,
    DocumentListResponse,
    DocumentRead,
    DocumentStatusValue,
)
from app.db.models import DocumentStatus
from app.services.document_service import DocumentService

# 创建文档相关的路由实例
# prefix="/documents"：该路由下的接口路径都会带上 /documents 前缀
# tags=["documents"]：在 Swagger 接口文档中归类到 "documents" 标签下
router = APIRouter(prefix="/documents", tags=["documents"])


@router.post("", response_model=DocumentRead, status_code=201, operation_id="uploadDocument")
async def upload_document(
        session: DbSession,
        background_tasks: BackgroundTasks,
        # File(...) 表示这是一个必填的文件上传字段，并附带了接口文档的描述
        file: UploadFile = File(..., description="待上传文档 (PDF / DOCX / Markdown / HTML)"),
) -> DocumentRead:
    """上传文档：写入 COS、落库后立即返回，解析与向量化通过 BackgroundTasks 异步进行。"""
    # 实例化文档服务，注入数据库会话
    service = DocumentService(session)

    # 调用服务层执行上传逻辑。注意这里将 background_tasks 传了进去，
    # 服务层在处理完落库后，会将耗时的解析任务推入后台执行。
    document = await service.upload(file, background_tasks)

    # 将 SQLAlchemy 的 ORM 对象（document）验证并转换为 Pydantic 响应模型（DocumentRead）
    # Pydantic V2 推荐使用 model_validate 替代 V1 的 from_orm
    return DocumentRead.model_validate(document)


@router.get("", response_model=DocumentListResponse, operation_id="listDocuments")
async def list_documents(
        session: DbSession,
        # Query(默认值, 校验规则)：定义 URL 查询参数。
        # page 默认 1，最小值为 1；page_size 默认 20，限制在 1 到 100 之间。
        page: int = Query(1, ge=1),
        page_size: int = Query(20, ge=1, le=100),
        # status 为可选参数，类型使用前文定义的 Literal 联合类型，方便前端生成精确的枚举
        status: DocumentStatusValue | None = Query(None, description="按文档状态筛选"),
) -> DocumentListResponse:
    # 实例化文档服务
    service = DocumentService(session)

    # 调用服务层的分页查询方法。
    # 注意 status 的处理：前端传过来的是字符串（DocumentStatusValue），
    # 这里需要将其转换回 Python 内部的枚举类型（DocumentStatus）才能传给数据库层使用。
    items, total = await service.list_documents(
        page,
        page_size,
        status=DocumentStatus(status) if status else None,
    )

    # 组装并返回分页响应模型
    return DocumentListResponse(
        # 使用列表推导式，将查询出来的 ORM 对象列表批量转换为 Pydantic 模型列表
        items=[DocumentRead.model_validate(d) for d in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{document_id}", response_model=DocumentRead, operation_id="getDocument")
async def get_document(document_id: UUID, session: DbSession) -> DocumentRead:
    """
    根据 ID 获取单个文档的详细信息。
    路径中的 {document_id} 会自动绑定到函数的 document_id 参数。
    """
    # 实例化业务服务层，注入数据库会话
    service = DocumentService(session)

    # 调用服务层查询文档。如果文档不存在，服务层会抛出 NotFoundError（全局异常处理器会将其转为 404）
    document = await service.get(document_id)

    # 将数据库 ORM 对象转换为 Pydantic 响应模型，过滤敏感字段并格式化数据
    return DocumentRead.model_validate(document)


@router.delete("/{document_id}", status_code=204, operation_id="deleteDocument")
async def delete_document(document_id: UUID, session: DbSession) -> Response:
    """
    根据 ID 删除文档。
    注意状态码使用了 204 (No Content)，表示操作成功，但服务器不需要返回任何响应体。
    """
    service = DocumentService(session)

    # 调用服务层执行删除逻辑（包括 DB 删除和 COS 云存储文件删除）
    await service.delete(document_id)

    # 按照 RESTful 规范，DELETE 成功且没有返回内容时，返回一个 204 空响应
    return Response(status_code=204)


@router.post("/{document_id}/retry", response_model=DocumentRead, operation_id="retryDocument")
async def retry_document(document_id: UUID, session: DbSession, background_tasks: BackgroundTasks,) -> DocumentRead:
    """
    重试失败（FAILED 状态）的文档解析入库任务。
    """
    service = DocumentService(session)

    # 调用服务层重试逻辑。
    # 传入 background_tasks 是因为重试通常意味着要重新跑一遍耗时的解析任务，
    # 服务层会将任务推入后台，并立刻返回重置状态后的文档对象。
    document = await service.retry(document_id, background_tasks)

    # 将返回的 ORM 对象转换为 Pydantic 模型返回给前端
    return DocumentRead.model_validate(document)


# 定义一个常量，专门用来匹配 DOCX 文件的 MIME 类型。
# 为什么要单独定义？因为现代浏览器（如 Chrome、Edge）原生不支持直接内联渲染 Word 文档，
# 如果强行让浏览器在页面内打开 DOCX，它会直接弹出一个空白页或触发下载框。因此我们需要特殊处理它。
_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"



@router.get("/{document_id}/file", operation_id="downloadDocument")
async def download_document(
        document_id: UUID,
        session: DbSession,
        # 定义查询参数 download。默认值为 0（表示预览）。
        # ge=0, le=1 是 Pydantic 的数值约束：表示这个值最小是 0，最大是 1。
        # 这样设计可以防止前端不小心或恶意传入 download=999 这种无意义的值。
        download: int = Query(0, ge=0, le=1, description="1=强制下载，0=尝试内联预览"),
) -> Response:
    """返回文档原始字节。

    - PDF / HTML / Markdown：浏览器通常支持内联渲染，会直接在网页上打开预览。
    - DOCX / 不支持预览的格式：浏览器无法渲染，必须强制 attachment 触发下载。
    """
    # 1. 实例化服务层，并注入数据库 session。
    service = DocumentService(session)

    # 2. 去数据库查这条文档的元数据（比如它的文件名、MIME 类型、以及在云存储中的 object_key）。
    # 如果没查到，service.get 内部会抛出 404 异常。
    document = await service.get(document_id)

    # 3. 拿着 object_key，去云存储（如腾讯云 COS）下载真实的文件二进制流（bytes）。
    # 注意：这里使用的是全量加载，如果文件特别大（如100MB），会占用服务器内存。
    # 生产环境中，超大文件通常建议使用 StreamingResponse 流式返回。
    content = await service.file_service.download(document.cos_object_key)

    # 4. 决定浏览器处理文件的行为（核心逻辑）：
    # 满足以下任意一个条件，就强制浏览器下载文件：
    # 条件 A：用户明确要求下载（download == 1）
    # 条件 B：文件类型是 DOCX（因为浏览器根本没法内联预览它）
    force_attachment = download == 1 or document.mime_type == _DOCX_MIME

    # 5. 设置 HTTP 响应头中的处置方式：
    # "attachment" 会弹出浏览器的下载保存框。
    # "inline" 会尝试利用浏览器的内置阅读器（如 PDF 阅读器）在网页内直接打开。
    disposition = "attachment" if force_attachment else "inline"

    # 6. 【关键】解决中文文件名乱码问题：
    # HTTP 协议规定，响应头（Headers）中只能包含 ASCII 字符。
    # 如果文件名是 "员工手册.pdf"，直接塞进 Header 里会引发各种乱码或报错。
    # 必须使用 URL 编码（如变成 %E5%91%98%E5%B7%A5...）。
    # quote() 函数就是用来做编码的，safe="" 表示把 /、? 等所有保留字符也一并编码，确保绝对安全。
    filename_quoted = quote(document.name, safe="")

    # 7. 构造并返回文件流响应
    return Response(
        content=content,  # 文件的二进制字节流
        media_type=document.mime_type,  # 告诉浏览器这到底是个什么文件（如 application/pdf），浏览器据此决定用什么软件打开
        headers={
            # 构造 Content-Disposition 头，这是告诉浏览器下载/预览行为的核心指令
            # RFC 5987 规定了多字节字符的标准写法：filename*=UTF-8''编码后的文件名
            # 这里将行为（inline/attachment）和编码后的中文文件名拼装在一起
            "Content-Disposition": (
                f"{disposition}; filename*=UTF-8''{filename_quoted}"
            ),
        },
    )


@router.get("/{document_id}/chunks", response_model=DocumentChunkListResponse, operation_id="listDocumentChunks")
async def list_document_chunks(
        document_id: UUID,  # 路径参数，从 URL 中提取文档的 UUID
        session: DbSession,  # 依赖注入，自动获取当前请求的数据库异步会话
        # 分页参数：默认第 1 页，ge=1 保证页码不能小于 1
        page: int = Query(1, ge=1),
        # 分页参数：默认每页 20 条，ge=1 保证最小 1 条，le=100 限制最大不超过 100 条，防止恶意拉取大量数据
        page_size: int = Query(20, ge=1, le=100),
) -> DocumentChunkListResponse:
    """获取指定文档下的文本块（Chunk）分页列表，并附带切分统计信息。"""

    # 1. 实例化业务服务层，将数据库会话注入进去
    service = DocumentService(session)

    # 2. 调用服务层方法，获取分页数据、总条数以及统计信息
    # service.list_chunks 内部会先校验文档是否存在，然后再查询数据
    items, total, stats = await service.list_chunks(document_id, page, page_size)

    # 3. 构建并返回响应对象
    return DocumentChunkListResponse(
        # 3.1 将数据库查出的 ORM 对象列表 (items)，通过列表推导式转换为 Pydantic 模型列表。
        # 这里调用了 DocumentChunkRead.from_orm_chunk(c)，因为列表接口只需要返回截断后的摘要（content_excerpt），
        # 不需要返回完整的超长文本，从而减小响应体积，提升传输速度。
        items=[DocumentChunkRead.from_orm_chunk(c) for c in items],

        # 3.2 直接透传总条数和当前分页参数
        total=total,
        page=page,
        page_size=page_size,

        # 3.3 处理切分统计信息。
        # 由于 stats 有可能是 None（例如文档尚未切分或切分为空），所以在赋值前需要做条件判断。
        stats=DocumentChunkStats(
            # 如果 stats 不为空，则从 stats 对象中提取各个属性，构建 Pydantic 统计模型
            total=stats.total,
            avg_length=stats.avg_length,
            min_length=stats.min_length,
            max_length=stats.max_length,
        )
        if stats is not None  # 条件判断：如果 stats 不是 None
        else None,  # 否则，将 stats 字段赋值为 None
    )


@router.get("/{document_id}/chunks/{chunk_id}", response_model=DocumentChunkDetail, operation_id="getDocumentChunk")
async def get_document_chunk(document_id: UUID,  chunk_id: UUID,  session: DbSession) -> DocumentChunkDetail:
    """
    获取指定文档下的单个文本块（Chunk）的完整详情。

    与列表接口不同，此接口会返回完整的 content 文本，适合用户在详情页查看全文。
    """
    # 1. 实例化业务服务层，将数据库会话注入进去。
    service = DocumentService(session)

    # 2. 调用服务层方法获取 chunk。
    # 传入 document_id 和 chunk_id，服务层会执行双条件查询。
    # 如果找不到，服务层会抛出 NotFoundError（最终返回 404 给前端）。
    chunk = await service.get_chunk(document_id, chunk_id)

    # 3. 将 SQLAlchemy 的 ORM 对象转换为 Pydantic 响应模型。
    # 注意这里调用的不是 model_validate，而是作者自定义的工厂方法 from_orm_chunk。
    # 因为在转换过程中，可能需要处理 None 值（比如计算字符数）或者组装特殊字段，
    # 使用工厂方法能更灵活地控制数据转换逻辑。
    return DocumentChunkDetail.from_orm_chunk(chunk)