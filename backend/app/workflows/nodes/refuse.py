from app.llm.prompts import REFUSAL_ANSWER
from app.workflows.rag_state import RAGState


# 定义 LangGraph 节点函数：执行拒答操作。
# 当检索质量极差、或者 Agent 循环达到最大轮次仍未找到资料时，工作流会流转到这个节点。
async def refuse(state: RAGState) -> RAGState:
    # 返回需要合并到全局状态（RAGState）中的更新字段。
    return {"refused": True, "answer": REFUSAL_ANSWER}