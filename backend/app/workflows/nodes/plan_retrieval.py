from app.core.config import settings
from app.llm.agent_planner import get_agent_planner
from app.llm.query_rewriter import get_query_rewriter
from app.workflows.rag_state import QueryRoute, RAGState


# 定义 LangGraph 节点函数：用于 Agentic RAG 的检索规划。
# 接收当前的 RAG 状态，返回局部更新的状态字典。
async def plan_retrieval(state: RAGState) -> RAGState:
    # 1. 安全获取历史步骤。
    # 使用 list() 进行浅拷贝，防止直接修改 state 中的原列表，这在状态机模式中是铁律。
    # 如果 state 里没有 "agent_steps"，则给一个空列表 [] 兜底。
    steps = list(state.get("agent_steps", []))

    # 2. 提取当前的路由策略。如果之前没设置，默认为 "original"（原问题检索）。
    current_route: QueryRoute = state.get("route", "original") # type: ignore[assignment]

    # 3. 提取当前的查询词。
    # 优先使用 state 里的 "query"（可能是被改写过的），如果为空，则回退使用原始问题 "question"。
    current_query = state.get("query") or state["question"]

    # 第 1 轮：route_query 已经决定好了 route/query，无需再调 LLM
    # 4. 核心判断：如果 steps 为空，说明这是智能体的第一轮检索。
    if not steps:
        # 5. 将初始状态作为第一步，追加到历史记录中。
        # 这一步不需要调用大模型（LLM）去重新思考，因为前面的 route_query 节点已经帮我们决策过了。
        steps.append(
            {
                "round": 1,  # 轮次：第 1 轮
                "action": "initial",  # 动作：初始化（首轮默认动作）
                "reason": "首轮检索沿用 route_query 决策",  # 原因：记录为什么直接执行
                "route": current_route,  # 记录当前使用的路由策略
                "query": current_query,  # 记录当前实际执行的查询词
            }
        )
        # 6. 返回增量状态。LangGraph 会自动把这个新列表合并到全局的 RAGState 中。
        return {"agent_steps": steps}

    # 后续轮：由 LLM planner 决定如何重试
    # 调用大模型（Agent Planner），让它基于历史失败记录，思考接下来该采取什么动作（action）
    decision = await get_agent_planner().plan(
        question=state["question"],  # 原始问题
        current_route=current_route,  # 这一轮用的检索策略
        current_query=current_query,  # 这一轮用的查询词
        previous_steps=steps,  # 历史检索记录
    )

    # 初始化用于更新 LangGraph 全局状态的字典（打补丁）
    update: RAGState = {}
    # 默认情况下，如果大模型没决定要改，那就保持当前的策略和查询词不变
    new_route = current_route
    new_query = current_query

    # ================= 分支 1：大模型决定“改写查询词” =================
    if decision.action == "rewrite_query" and decision.new_query:
        # 改 query 同时把 route 强制重置为 original：上一轮可能是 multi_query，
        # 残留的 multi_queries 会让 retrieve 忽略本轮新 query，必须清干净
        # （极其关键的状态清理：如果不清理，后续节点看到 multi_queries 还有值，会继续执行多路检索）
        new_query = decision.new_query
        new_route = "original"  # 强制把策略改回 original，意味着只用这一个新的 query 去搜

        update["query"] = new_query
        update["route"] = new_route # type: ignore[assignment]
        # 下面这三个清空极其重要：清掉历史残留的改写结果、HyDE 文本和多路查询列表
        update["rewritten_query"] = None
        update["hyde_answer"] = None
        update["multi_queries"] = None

    # ================= 分支 2：大模型决定“切换检索路由” =================
    elif decision.action == "switch_route" and decision.new_route:
        # 真正切换：调 QueryRewriter 补齐目标路由对应字段，避免只换标签不换行为
        rewriter = get_query_rewriter()
        result = await rewriter.apply_route(
            question=state["question"],
            route=decision.new_route,
            multi_query_count=settings.multi_query_count,
        )
        # 从执行结果中提取最终生效的 route 和 query（如果 apply_route 内部发生异常降级，这里的 route 可能是 original）
        new_route = result.route
        new_query = result.query

        update["route"] = new_route
        update["query"] = new_query
        # 把 apply_route 生成的各种辅助字段（如改写文本、HyDE 答案、多路查询列表）全部塞进更新字典
        update["rewritten_query"] = result.rewritten_query
        update["hyde_answer"] = result.hyde_answer
        update["multi_queries"] = result.multi_queries

    # 1. 将本轮大模型做出的决策，作为一个新的 step 追加到历史列表中。
    steps.append(
        {
            # 使用当前列表长度 + 1 作为轮次。
            # 确保轮次绝对连续递增（1, 2, 3...），
            # 哪怕中间某轮报错丢失了数据，只要它在列表里，它的轮次就是正确的。
            "round": len(steps) + 1,

            # 记录大模型决定采取的动作（如 "proceed", "rewrite_query", "refuse" 等）
            "action": decision.action,

            # 记录大模型做出该决策的原因（大模型的思考过程，方便前端展示和后续复盘）
            "reason": decision.reason,

            # 记录本轮最终生效的检索策略（如 original, hyde, multi_query 等）
            "route": new_route,

            # 记录本轮最终生效的查询词
            "query": new_query,
        }
    )

    # 将更新后的完整步骤历史，存入待返回的状态更新字典中
    update["agent_steps"] = steps

    # 3. 返回局部更新字典，LangGraph 会自动将其合并到全局的 RAGState 中
    return update