from langchain_core.embeddings import Embeddings
from langchain_openai import OpenAIEmbeddings

from app.core.config import settings
from app.core.exceptions import ConfigurationError

# 模块级全局变量，用于保存单例的 Embeddings 实例（初始化为 None）
_embeddings: Embeddings | None = None


def get_embeddings() -> Embeddings:
    """
    获取全局唯一的 Embeddings 实例（单例工厂）。
    Embeddings 客户端的初始化会持有网络连接和配置，多次实例化会造成资源浪费。
    """
    # 声明这里要修改的是模块级的全局变量 _embeddings
    global _embeddings

    # 1. 如果已经初始化过了，直接返回，保证单例
    if _embeddings is not None:
        return _embeddings

    # 2. 校验必要的配置项。如果没有配置 API Key，立刻抛出配置异常，避免后续发请求时报错
    if not settings.embedding_api_key:
        raise ConfigurationError("Embedding API key 未配置，请在 .env 设置 EMBEDDING_API_KEY")

    # 3. 实例化 OpenAI 兼容的 Embeddings 客户端
    _embeddings = OpenAIEmbeddings(
        model=settings.embedding_model,  # 使用的模型名称（如 text-embedding-v3）
        api_key=settings.embedding_api_key,  # 模型服务的 API Key
        base_url=settings.embedding_base_url,  # 服务提供商的接口地址（如阿里云 DashScope 的兼容地址）
        dimensions=settings.embedding_dim,  # 向量维度大小（必须与数据库表字段的维度一致，如 1024）
        chunk_size=settings.embedding_batch_size,  # 批量请求的文本数量（每次发送多少个文本块给 API，避免超出单次请求限制）
        # 关闭 LangChain 客户端本地的 Token 长度校验。
        # 因为这里使用的是第三方兼容接口（DashScope），客户端可能无法正确识别其 Token 编码，
        # 交给服务端去校验长度即可，避免本地误判导致正常请求被拦截。
        check_embedding_ctx_length=False,
    )

    # 4. 返回刚刚初始化好的实例
    return _embeddings