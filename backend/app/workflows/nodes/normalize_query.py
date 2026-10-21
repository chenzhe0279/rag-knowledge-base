from app.workflows.rag_state import RAGState

# 目前normalize_query是个透传节点，没做什么额外处理，是给后续功能留的扩展点。
async def normalize_query(state: RAGState) -> RAGState:
    return {"query": state["question"]}