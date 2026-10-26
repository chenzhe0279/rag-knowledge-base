from langgraph.graph import END, START, StateGraph

from app.core.config import settings
from app.core.logger import get_logger
from app.workflows.nodes import (
    normalize_query,
    observe_context,
    plan_retrieval,
    retrieve,
    route_query,
)
from app.workflows.rag_state import RAGState

logger = get_logger(__name__)


# =========================================================================
# 路由函数 1：在 "规划（plan）" 节点执行完毕后，决定下一步走向哪里
# LangGraph 会根据这个函数返回的字符串（节点名称），决定图的流转方向。
# =========================================================================
def _after_plan(state: RAGState) -> str:
    """planner 决策为 refuse 时直接结束，避免再做无意义的检索。"""

    # 1. 检查历史步骤里是否有记录
    if state.get("agent_steps"):
        # 提取最后一条步骤记录中的 "action"（大模型做出的决策）
        last_action = state["agent_steps"][-1].get("action")

        # 2. 【核心短路逻辑】：如果大模型明确表示要“拒答（refuse）”
        if last_action == "refuse":
            # 直接返回 "end"，告诉 LangGraph 结束流程，跳转到 END 节点。
            # 绝不再浪费算力和时间去跑 "retrieve"（检索）节点。
            return "end"

    # 3. 如果不是拒答（比如是 proceed 或 rewrite_query），就返回 "retrieve"
    # 告诉工作流：继续去执行检索节点。
    return "retrieve"


# =========================================================================
# 路由函数 2：在 "观察（observe）" 节点执行完毕后，决定是结束循环还是继续
# =========================================================================
def _after_observe(state: RAGState) -> str:
    """observe 后决定继续循环还是结束。

    结束条件（任一即停）：
    - 关闭了 agent loop（退化为单轮）
    - 本轮已足够（context_sufficient=True）
    - 达到 agent_max_rounds 上限
    """
    # 如果配置里关闭了 Agent 循环（比如为了省钱/降级），直接结束。
    if not settings.agent_loop_enabled:
        return "end"

    # 如果 observe_context 节点评估后，认为信息已经足够了（True），直接结束循环，去生成答案。
    if state.get("context_sufficient"):
        return "end"

    # 获取当前的检索轮次（默认 0），如果已经大于等于配置的最大轮次（如 3 轮）
    if state.get("retrieval_round", 0) >= settings.agent_max_rounds:
        # 即使信息还不够，也不能再查了，防止无限消耗 Token，强制结束。
        return "end"

    # 4. 【继续循环】
    # 如果上面三个结束条件都没触发，说明还没搜够，且没超限。
    # 返回 "plan"，让工作流跳转回 "规划（plan_retrieval）" 节点，让大模型重新思考并改写查询词，开启下一轮。
    return "plan"


# 定义构建 LangGraph 工作流图的函数。
# LangGraph 的核心思想就是把 AI 的执行过程，画成一张有节点（Node）和连线（Edge）的流程图。
def _build_graph():
    # 1. 初始化状态图（StateGraph）。
    # 传入 RAGState 作为全局状态字典，这意味着流经这张图的每一步数据，都必须符合 RAGState 的数据结构。
    builder = StateGraph(RAGState)

    # ================= 注册节点（Node） =================
    # 第一个参数是给节点起的名字，第二个参数是对应的函数。
    builder.add_node("normalize_query", normalize_query)  # 查询规范化
    builder.add_node("route_query", route_query)  # 路由判定
    builder.add_node("plan_retrieval", plan_retrieval)  # Agent 检索规划（思考）
    builder.add_node("retrieve", retrieve)  # 执行检索（行动）
    builder.add_node("observe_context", observe_context)  # 观察检索结果（评估）

    # ================= 铺设连线（Edge） =================
    # 2. 将 START（起点）连到 normalize_query 节点。
    # 意味着图一启动，第一件事就是规范化查询词。
    builder.add_edge(START, "normalize_query")

    # 3. 常规连线：执行完 A 节点，立刻执行 B 节点。
    builder.add_edge("normalize_query", "route_query")  # 规范化后，去判定路由
    builder.add_edge("route_query", "plan_retrieval")  # 判定完路由，去规划检索策略

    # 4. 【核心机制】：条件边（Conditional Edges）。
    # 执行完 "plan_retrieval" 后，接下来去哪？由路由函数 _after_plan 来决定。
    # 字典映射：如果 _after_plan 返回 "retrieve"，就跳到 "retrieve" 节点；如果返回 "end"，就跳到 END（结束）。
    builder.add_conditional_edges(
        "plan_retrieval",
        _after_plan,
        {"retrieve": "retrieve", "end": END}
    )

    # 5. 检索完成后，必须交给 observe_context 去评估结果好坏。
    builder.add_edge("retrieve", "observe_context")

    # 6. 【循环闭环】：再次使用条件边。
    # 执行完 "observe_context" 后，由 _after_observe 决定。
    # 如果它返回 "plan"，就跳回 "plan_retrieval" 节点（这就实现了 Agentic RAG 的多轮循环反思！）。
    # 如果它返回 "end"，就走向 END，彻底结束工作流。
    builder.add_conditional_edges(
        "observe_context",
        _after_observe,
        {"plan": "plan_retrieval", "end": END},
    )

    # 7. 编译图。将上面的节点和连线打包成一个可运行的实例。
    return builder.compile()


# 8. 【极其重要的性能优化】：模块加载时编译一次。
_rag_graph = _build_graph()


# 9. 对外暴露工厂函数，供外部（如 FastAPI 路由或父图）获取这张图。
def get_rag_graph():
    """对外暴露已编译好的子图；模块加载时一次编译，请求里直接复用。"""
    return _rag_graph