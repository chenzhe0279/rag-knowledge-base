import hashlib

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

from app.core.config import settings


def _build_splitter() -> RecursiveCharacterTextSplitter:
    """
    构建文本切分器（工厂方法）。

    为什么叫 Recursive（递归）？
    它会优先尝试用大分隔符（如双换行）切分；如果切出来的块还太大，
    就会退一步用更小的分隔符（如单换行、句号）继续切，直到满足 chunk_size 限制。
    """
    return RecursiveCharacterTextSplitter(
        # 每个文本块的最大字符数（从配置文件读取，如 600）
        chunk_size=settings.chunk_size,
        # 相邻两个文本块之间重叠的字符数（如 60），防止语义在边界处被硬生生切断
        chunk_overlap=settings.chunk_overlap,
        # 分隔符优先级列表。
        # 中文场景下默认分隔符过于偏英文，这里加入中文标点；
        # 最后的空串 "" 作为兜底，表示如果前面都切不开，就按单字符硬切。
        separators=["\n\n", "\n", "。", "！", "？", "；", "，", " ", ""],
        # 计算文本长度的函数，默认就是 len（按字符数算），显式写出更清晰
        length_function=len,
        # 表示上面的 separators 是普通字符串，而不是正则表达式
        is_separator_regex=False,
    )


def split(documents: list[Document]) -> list[Document]:
    """
    切分文档并补齐 chunk 级 metadata。

    :param documents: 原始的长文档列表（LangChain Document 格式）
    :return: 切分后的文本块列表
    """
    # 1. 获取配置好的切分器
    splitter = _build_splitter()

    # 2. 执行切分。
    # LangChain 会自动保留原 Document 的 metadata，并应用到切出来的每个 chunk 上。
    chunks = splitter.split_documents(documents)

    # 3. 遍历切分后的每一个块，为它们追加专属的 metadata
    for index, chunk in enumerate(chunks):
        # chunk_index 用于排序与定位：记录这个块在原文档中的先后顺序
        chunk.metadata["chunk_index"] = index

        # chunk_hash 给后续增量索引比对：
        # 如果用户重新上传了修改过的文档，可以通过比对这个哈希值，只重新向量化发生改变的块，节省 API 费用。
        # 使用 MD5 计算内容的十六进制字符串（固定 32 位长度）
        chunk.metadata["chunk_hash"] = hashlib.md5(
            chunk.page_content.encode("utf-8")  # 必须编码成 bytes 才能计算哈希
        ).hexdigest()

    # 4. 返回带有完整 metadata 的文本块列表
    return chunks