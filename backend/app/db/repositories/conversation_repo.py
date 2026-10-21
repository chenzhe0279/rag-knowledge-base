from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models import Conversation, Message, MessageRole


# 定义对话仓储类（Repository），专门负责与 Conversation 和 Message 相关的数据库操作
class ConversationRepository:
    # 构造函数：接收数据库异步会话
    def __init__(self, session: AsyncSession) -> None:
        # 将传入的 session 保存在实例属性中，供后续所有方法使用
        self.session = session

    # 定义异步方法：创建一个新的对话
    async def create(self, title: str = "新对话") -> Conversation:
        # 实例化 Conversation 数据库模型对象，如果不传标题则使用默认的"新对话"
        conversation = Conversation(title=title)
        # 将该对象加入到当前 SQLAlchemy 的 session 会话中（此时还在内存中）
        self.session.add(conversation)
        # 【核心】执行 flush() 而不是 commit()。
        # flush 会立刻向数据库发送 INSERT 语句，从而获取数据库自动生成的 UUID 主键和创建时间。
        # 但不会提交事务，事务的最终控制权交由外层（如 Service 层）管理。
        await self.session.flush()
        # 返回刚刚创建好的对话对象（已包含数据库生成的主键）
        return conversation

    # 定义异步方法：根据对话 ID 获取单个对话
    async def get(self, conversation_id: UUID) -> Conversation | None:
        # 使用 SQLAlchemy 最推荐的 session.get() 方法进行主键查询。
        # 它自带一级缓存，性能最好。找不到会返回 None。
        return await self.session.get(Conversation, conversation_id)

    # 定义异步方法：获取指定对话下的所有消息（按时间正序）
    async def list_messages(self, conversation_id: UUID) -> list[Message]:
        """按时间正序返回所有消息（含引用）。前端展示历史用。"""

        # 构建查询语句
        stmt = (
            # 查询 Message 实体
            select(Message)
            # 过滤条件：只查属于当前 conversation_id 的消息
            .where(Message.conversation_id == conversation_id)
            # 排序规则：先按创建时间升序，时间相同则按 ID 升序（保证顺序绝对稳定）
            .order_by(Message.created_at.asc(), Message.id.asc())
            # 预加载优化：一次性把每条消息关联的引用来源 (citations) 查出来，避免前端展示时触发 N+1 查询
            .options(selectinload(Message.citations))
        )
        # 执行查询。scalars() 提取 Message 实体对象，all() 返回列表，最后转成纯 Python list 返回。
        return list((await self.session.execute(stmt)).scalars().all())

    # 定义异步方法：获取指定对话最近的 N 条消息
    async def recent_messages(self, conversation_id: UUID, limit: int) -> list[Message]:
        """取最近 N 条消息，按时间正序返回。"""

        # 防御性校验：如果限制数量小于等于 0，直接返回空列表
        if limit <= 0:
            return []

        # 先按倒序取 N 条，再在 Python 侧反转为正序
        # 为什么这么做？因为如果直接正序 + limit，拿到的是最老的 N 条，而不是最新的 N 条。
        # 所以要先用 DESC 拿最新的，再翻转过来。
        stmt = (
            # 查询 Message 实体
            select(Message)
            # 过滤条件：属于当前对话
            .where(Message.conversation_id == conversation_id)
            # 排序规则：按创建时间降序（最新的排最前面）
            .order_by(Message.created_at.desc(), Message.id.desc())
            # 限制最多取 limit 条
            .limit(limit)
        )

        # 执行查询，拿到降序排列的消息列表
        rows = list((await self.session.execute(stmt)).scalars().all())

        # 使用 reversed() 将列表反转，恢复成从旧到新的正序，方便直接拼接进大模型的上下文中
        return list(reversed(rows))

    # 定义异步方法：批量添加多条消息到数据库
    async def add_messages(self, messages: Sequence[Message]) -> None:
        # 防御性判断：如果传入的消息序列为空
        if not messages:
            # 直接返回，避免无意义的数据库交互
            return

        # 将序列中的所有 Message 对象一次性加入 SQLAlchemy 的 session 会话中（批量添加，性能更好）
        self.session.add_all(messages)

        # 执行 flush() 立即向数据库发送 INSERT 语句。
        # 这样做可以立刻获取数据库生成的主键 ID 和默认时间戳，同时不提交事务，保证外层事务的原子性。
        await self.session.flush()

    # 装饰器：声明这是一个静态方法。不需要访问实例属性(self)或类属性(cls)，可以通过类名直接调用
    @staticmethod
    # 定义静态方法：快速构造一个“用户（USER）”角色的消息对象
    def make_user_message(conversation_id: UUID, content: str) -> Message:
        # 实例化 Message ORM 模型，绑定对话 ID、指定角色为 USER、传入消息内容，并返回
        return Message(conversation_id=conversation_id, role=MessageRole.USER, content=content)

    # 装饰器：同样声明这是一个静态方法
    @staticmethod
    # 定义静态方法：快速构造一个“AI 助手（ASSISTANT）”角色的消息对象
    def make_assistant_message(
            # 对话 ID
            conversation_id: UUID,
            # AI 的回复内容
            content: str,
            # 星号 * 表示后面的参数必须使用关键字传递（强制关键字参数）
            *,
            # 可选参数：额外元数据（比如大模型名称、消耗的 token 数、耗时等）。默认为 None。
            extra_metadata: dict | None = None,
            # 返回类型为 Message ORM 对象
    ) -> Message:
        # 实例化 Message 模型并返回
        return Message(
            # 绑定对话 ID
            conversation_id=conversation_id,
            # 指定角色为 ASSISTANT（AI 助手）
            role=MessageRole.ASSISTANT,
            # 传入回复的文本内容
            content=content,
            # 存入额外元数据。使用 `or {}` 兜底：如果传入的 extra_metadata 是 None，则赋一个空字典 {}。
            # 这是因为数据库模型里该字段定义了 nullable=False，不能存 None。
            extra_metadata=extra_metadata or {},
        )