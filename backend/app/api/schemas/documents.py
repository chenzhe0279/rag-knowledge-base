from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# 与 app.db.models.DocumentStatus 同步；用 Literal 让前端 openapi-typescript
# 生成精确的字面量联合类型，而不是宽 string
# 作用：限制前端传入或后端返回的 status 只能是这五个固定的字符串之一，防止非法状态
DocumentStatusValue = Literal["uploading", "parsing", "indexing", "ready", "failed"]


class DocumentRead(BaseModel):
    """
    文档信息响应模型。
    用于 FastAPI 返回给前端的 JSON 数据结构定义。
    """
    # 【核心配置】：允许从任意对象属性读取数据（即从 SQLAlchemy 的 ORM 模型实例直接转换）
    # 替代了 Pydantic v1 的 orm_mode = True
    model_config = ConfigDict(from_attributes=True)

    id: UUID  # 文档主键 ID
    name: str  # 文件名
    file_hash: str  # 文件的 SHA256 哈希值
    mime_type: str  # 文件 MIME 类型
    size: int  # 文件大小（字节）
    thumbnail_url: str | None = None  # 缩略图地址；没有则为 None
    status: DocumentStatusValue  # 当前处理状态（强类型约束）
    error_message: str | None = None  # 错误信息（可选，默认为 None）
    created_at: datetime  # 创建时间
    updated_at: datetime  # 最后更新时间


class DocumentListResponse(BaseModel):
    """
    文档分页列表响应模型。
    封装了分页的元数据和具体的数据列表。
    """
    items: list[DocumentRead]  # 当前页的文档对象列表
    total: int  # 数据库中的文档总条数

    # 使用 Field 进行参数校验：
    # ge=1 表示 greater than or equal，即页码最小为 1
    page: int = Field(ge=1)

    # ge=1, le=100 表示每页数量最小为 1，最大不能超过 100（防止恶意请求一次性拉取过多数据）
    page_size: int = Field(ge=1, le=100)


# chunk 列表里只回截断后的摘要，避免长 chunk 撑爆响应；查看完整内容走详情接口
# 作用：限制返回给前端的文本预览长度，防止网络传输过大或前端渲染卡顿
_CONTENT_EXCERPT_LIMIT = 100


class DocumentChunkRead(BaseModel):
    """chunk 列表项。content_excerpt 已在 API 层截断到固定长度。"""

    # 基础元数据字段
    id: UUID
    chunk_index: int  # 文本块在原文档中的顺序
    page_no: int | None = None  # 页码（可选）
    section_path: str | None = None  # 章节路径（可选）

    # 核心数据字段
    content_excerpt: str  # 截断后的文本摘要，而不是完整内容
    char_count: int  # 文本块的完整字符数（让前端知道实际上有多长）
    chunk_hash: str  # 文本块的 MD5 哈希值

    @classmethod
    def from_orm_chunk(cls, chunk) -> "DocumentChunkRead":
        """
        工厂方法：将 SQLAlchemy 的 DocumentChunk ORM 对象转换为当前 Pydantic 模型。
        在这里进行数据裁剪，避免了在路由层或服务层写重复的转换代码。
        """
        # 1. 获取原始内容，如果为 None 则转为空字符串，防止后续切片报错
        content = chunk.content or ""

        # 2. 执行截断：取前 100 个字符
        excerpt = content[:_CONTENT_EXCERPT_LIMIT]

        # 3. 如果原始内容超过了 100 字符，在末尾追加省略号，提示前端内容并未展示完
        if len(content) > _CONTENT_EXCERPT_LIMIT:
            excerpt += "..."

        # 4. 显式构造并返回当前模型实例
        return cls(
            id=chunk.id,
            chunk_index=chunk.chunk_index,
            page_no=chunk.page_no,
            section_path=chunk.section_path,
            content_excerpt=excerpt,  # 返回截断后的摘要
            char_count=len(content),  # 返回完整长度
            chunk_hash=chunk.chunk_hash,
        )


class DocumentChunkStats(BaseModel):
    """切分统计：直观看到 chunk_size / overlap 配置的实际效果。"""

    total: int  # 该文档切分出的总块数
    avg_length: int  # 文本块的平均字符长度（用来验证是否接近配置的 chunk_size）
    min_length: int  # 最短文本块的字符数
    max_length: int  # 最长文本块的字符数


class DocumentChunkListResponse(BaseModel):
    """
    文档分块列表响应模型。
    不仅包含分页数据，还贴心地附带了切分统计信息，方便前端进行展示或调试。
    """

    items: list[DocumentChunkRead]  # 当前页的文本块列表（使用 DocumentChunkRead 模型，只包含摘要）
    total: int  # 该文档下的文本块总数量

    # 分页参数校验：页码最小为 1
    page: int = Field(ge=1)

    # 分页参数校验：每页数量限制在 1 到 100 之间，防止恶意请求刷爆数据库
    page_size: int = Field(ge=1, le=100)

    # 切分统计信息。可能为 None（例如该文档还没有切分出任何块时）
    stats: DocumentChunkStats | None = None


class DocumentChunkDetail(BaseModel):
    """chunk 详情：返回完整 content。"""

    # 允许从任意对象（如 SQLAlchemy 的 ORM 模型实例）的属性中读取数据
    model_config = ConfigDict(from_attributes=True)

    id: UUID  # 文本块的主键 ID
    document_id: UUID  # 所属文档的 ID（便于前端溯源）
    chunk_index: int  # 在原文档中的顺序
    page_no: int | None = None  # 页码（可选）
    section_path: str | None = None  # 章节路径（可选）

    # 【核心区别】：这里返回的是完整的 content，而列表接口（DocumentChunkRead）只返回 content_excerpt 摘要
    content: str

    char_count: int  # 完整内容的字符数
    chunk_hash: str  # 文本块的 MD5 哈希值
    created_at: datetime  # 文本块创建/入库时间

    @classmethod
    def from_orm_chunk(cls, chunk) -> "DocumentChunkDetail":
        """
        工厂方法：将 SQLAlchemy 的 DocumentChunk ORM 对象转换为当前详情模型。
        由于需要计算 char_count 并处理 None 值，因此显式进行属性映射。
        """
        return cls(
            id=chunk.id,
            document_id=chunk.document_id,
            chunk_index=chunk.chunk_index,
            page_no=chunk.page_no,
            section_path=chunk.section_path,
            content=chunk.content,  # 返回完整正文
            # 安全计算字符长度：如果 chunk.content 为 None，则使用空字符串兜底，防止 len(None) 报错
            char_count=len(chunk.content or ""),
            chunk_hash=chunk.chunk_hash,
            created_at=chunk.created_at,
        )

class DocumentRenameRequest(BaseModel):  # 重命名请求体
    name: str = Field(  # 新文件名，包含扩展名
        min_length=1,  # 至少 1 个字符
        max_length=255,  # 最多 255 个字符
        description="新的文件名，必须保留原扩展名",  # Swagger 说明
    )