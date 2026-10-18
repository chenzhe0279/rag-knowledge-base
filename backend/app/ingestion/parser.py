import asyncio
import io

from docling.datamodel.base_models import DocumentStream
from docling.document_converter import DocumentConverter
from langchain_core.documents import Document

from app.core.exceptions import AppException
from app.core.logger import get_logger

logger = get_logger(__name__)

class DocumentParseError(AppException):
    code = "document_parse_error"
    message = "文档解析失败"
    http_status = 400


# 模块级全局变量，用于保存单例的 DocumentConverter 实例
# 初始为 None，表示尚未初始化
_converter: DocumentConverter | None = None


def _get_converter() -> DocumentConverter:
    """单例工厂：DocumentConverter 内部会加载模型，初始化较重，因此全局只实例化一次"""
    """注意，DocumentConverter要单例化，因为它内部会加载多个模型，初始化比较耗时，复用这个对象可以避免每次解析都新建浪费时间。"""
    # 声明我们要修改的是全局变量 _converter
    global _converter

    # 如果还没有被初始化过（懒加载）
    if _converter is None:
        # 实例化 Docling 的转换器
        _converter = DocumentConverter()

    # 返回全局唯一的转换器实例
    return _converter


def _convert_sync(filename: str, content: bytes) -> str:
    """
    同步执行文档解析的内部函数。
    因为 Docling 的解析是同步且耗时的 CPU/IO 操作，所以单独提出来方便放入线程池运行。
    """
    # 将传入的文件名和二进制内容，封装成 Docling 期望的 DocumentStream 对象
    # io.BytesIO(content) 将纯字节流包装成了类文件对象（支持 read/seek 等操作）
    source = DocumentStream(name=filename, stream=io.BytesIO(content))

    # 调用单例转换器，执行真正的解析操作（耗时的部分）
    result = _get_converter().convert(source)

    # 将解析后的文档树（Document Tree）导出为 Markdown 格式的纯文本，并返回
    return result.document.export_to_markdown()


async def parse(filename: str, content: bytes) -> list[Document]:
    """异步对外接口：接收文件，调用解析器，并转成 LangChain 所需的 Document 列表"""
    try:
        # 使用 asyncio.to_thread 将耗时的 _convert_sync 丢到后台线程池执行。
        # 避免阻塞 FastAPI 的 asyncio 事件循环，导致其他接口卡死。
        # markdown: str 强制指定类型注解，帮助 IDE 推断
        markdown: str = await asyncio.to_thread(_convert_sync, filename, content)

    except Exception as exc:
        # 捕获解析过程中可能出现的任何异常（如文件损坏、模型报错等）
        # logger.exception 会自动记录完整的异常堆栈，便于排查问题
        logger.exception("docling parse failed：%s", filename)
        # 抛出自定义的业务异常 DocumentParseError，并利用 from exc 保留原始异常链
        raise DocumentParseError(f"Docling 解析失败：{exc}") from exc

    # 校验解析结果：如果去掉空白字符后为空，说明没有解析出有效内容
    if not markdown.strip():
        raise DocumentParseError("解析结果为空，文档可能损坏或不受支持")

    # 返回 LangChain 标准的 Document 对象列表
    # LangChain 的 RAG 流程需要统一的数据格式：page_content 存正文，metadata 存溯源信息
    return [
        Document(
            page_content=markdown,  # 解析出的 Markdown 文本
            metadata={"source": filename},  # 元数据：保留原始文件名，方便后续检索溯源
        )
    ]