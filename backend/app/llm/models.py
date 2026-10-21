from langchain_core.language_models.chat_models import BaseChatModel
from langchain_openai import ChatOpenAI

from app.core.config import settings
from app.core.exceptions import ConfigurationError

# 声明一个模块级的全局变量，用于缓存大模型客户端实例（单例模式）。
# 初始状态为 None，表示尚未初始化。
_chat_model: BaseChatModel | None = None


# 定义工厂函数，用于获取（或懒加载）大模型客户端实例。
# 返回类型标注为 BaseChatModel，这是 LangChain 中所有聊天模型的基础接口。
def get_chat_model() -> BaseChatModel:
    """返回流式 ChatOpenAI 实例。

    单例缓存：模型客户端持有 httpx 连接池，反复创建会浪费资源。
    """

    # 声明接下来要修改的是模块级的全局变量 _chat_model
    global _chat_model

    # 单例模式的核心逻辑：如果全局变量已经有值（说明之前已经初始化过了）
    if _chat_model is not None:
        # 直接返回缓存的实例，避免重复创建连接池，节约系统资源
        return _chat_model

    # 前置校验：如果在配置文件中没有读取到 API Key
    if not settings.chat_api_key:
        # 立刻抛出自定义的配置异常，阻止后续请求，避免运行时才发现未配置报错
        raise ConfigurationError("Chat API key 未配置，请在 .env 设置 CHAT_API_KEY")

    # 实例化大模型客户端
    _chat_model = ChatOpenAI(
        # 指定要调用的模型名称（如 qwen-plus 或 deepseek-chat）
        model=settings.chat_model,
        # 传入 API Key 用于身份认证
        api_key=settings.chat_api_key,
        # 指定模型服务商的 API 基础地址（兼容 OpenAI 协议的地址）
        base_url=settings.chat_base_url,
        # 知识库问答 + 严格的引用编号约束属于指令遵循任务，温度设 0
        # 避免 [N] 编号在不同 chunk 间漂移
        # 解释：temperature=0 表示让模型输出最确定的结果，减少随机性。对于 RAG（检索增强），这非常重要，能防止模型胡编乱造或打乱引用标记。
        temperature=0,
        # 开启流式输出。如果为 False，用户需要等大模型完整生成所有文字后页面才会显示；开启后可以实现打字机效果，极大提升交互体验。
        streaming=True,
    )

    # 返回刚刚初始化好的大模型实例
    return _chat_model