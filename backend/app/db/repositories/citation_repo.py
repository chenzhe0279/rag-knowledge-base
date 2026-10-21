from collections.abc import Sequence
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.models import AnswerCitation


# 定义引用快照（AnswerCitation）的仓储类，专门负责与引用表进行数据库交互
class AnswerCitationRepository:
    # 构造函数：接收并保存数据库异步会话
    def __init__(self, session: AsyncSession) -> None:
        # 将传入的 session 保存在实例属性中，供后续方法使用
        self.session = session

    # 定义异步方法：批量添加引用快照记录
    async def bulk_add(self, citations: Sequence[AnswerCitation]) -> None:
        # 防御性判断：如果传入的引用序列为空
        if not citations:
            # 直接返回，避免无意义的数据库交互
            return

        # 将序列中的所有引用对象一次性加入 SQLAlchemy 的 session 会话中
        # 使用 add_all 比循环调用 add 性能更好
        self.session.add_all(citations)

        # 执行 flush() 立即向数据库发送批量 INSERT 语句
        # 这样能立刻获取数据库生成的主键 ID 等默认值，同时不提交事务，交由外层控制事务边界
        await self.session.flush()