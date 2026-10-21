from app.workflows.nodes.generate import stream_generate
from app.workflows.nodes.load_context import load_context
from app.workflows.nodes.normalize_query import normalize_query
from app.workflows.nodes.retrieve import retrieve

# 定义 __all__ 变量
# 作用 1：严格控制对外暴露的公共接口。当其他模块使用 `from app.workflows.nodes import *` 时，只会导入这个列表里列出的名字。
# 作用 2：作为模块的“说明书”，让开发者一眼就能看出这个包（nodes）里到底提供了哪些核心的节点函数。
__all__ = [
    # 加载历史对话上下文的节点函数
    "load_context",
    # 规范化/改写用户查询的节点函数
    "normalize_query",
    # 执行向量检索的节点函数
    "retrieve",
    # 调用大模型流式生成回答的节点函数
    "stream_generate",
]