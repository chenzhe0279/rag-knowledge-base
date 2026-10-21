from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.llm.prompts import REFUSAL_ANSWER
from app.retrieval.vector_retriever import VectorRetriever
from app.workflows.rag_state import RAGState


# 定义 LangGraph 节点函数：执行向量检索并根据检索质量判断是否拒答
async def retrieve(state: RAGState, session: AsyncSession) -> RAGState:
    # 1. 实例化向量检索器，注入数据库会话（用于执行 pgvector 相似度查询）
    retriever = VectorRetriever(session)

    # 2. 从全局状态中取出上一步规范化后的查询语句（state["query"]），
    # 并执行向量检索。top_k 限制从配置文件中读取（例如取最相似的 5 条）。
    chunks = await retriever.search(state["query"], top_k=settings.retrieval_top_k)

    # 检索为空 / 最高相似度过低 -> 直接拒答；不再调 LLM
    # 3. 判断是否触发拒答（refused）：
    # 情况 A：chunks 为空列表（没搜到任何东西）。
    # 情况 B：chunks 不为空，但排在最前面的（分数最高的）那条得分，低于我们配置的最低阈值 (retrieval_min_score)。
    refused = not chunks or chunks[0].score < settings.retrieval_min_score

    # 4. 构造一个局部的状态更新字典，准备返回给 LangGraph 去合并到全局 State 中。
    update: RAGState = {
        # 保存检索到的文本块列表
        "retrieved_chunks": chunks,
        # 保存是否拒答的布尔值标记
        "refused": refused,
    }

    # 5. 如果判定为需要拒答（检索质量太差）
    if refused:
        # 直接将最终的 "answer" 字段设置为预设的固定拒答文案（如："抱歉，知识库中没有找到..."）。
        # 这样后续的生成节点（generate）看到已经有 answer 了，就可以直接跳过，从而节省大模型的调用成本和时间。
        update["answer"] = REFUSAL_ANSWER

    # 6. 返回局部更新字典
    return update