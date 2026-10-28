from collections.abc import Sequence
from uuid import UUID
from sqlalchemy import func
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from app.db.models import Conversation, Message, MessageRole

DEFAULT_CONVERSATION_TITLE = "新对话"

# 定义对话仓储类（Repository），专门负责与 Conversation 和 Message 相关的数据库操作
class ConversationRepository:
    # 构造函数：接收数据库异步会话
    def __init__(self, session: AsyncSession) -> None:
        # 将传入的 session 保存在实例属性中，供后续所有方法使用
        self.session = session

    # 定义异步方法：创建一个新的对话
    async def create(self, title: str = DEFAULT_CONVERSATION_TITLE) -> Conversation:
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

    async def count_messages(self, conversation_id: UUID) -> int:
        """统计指定对话（conversation_id）下的消息总数。"""
        # 构建 SQL 查询语句：使用 SQLAlchemy 的 func.count() 统计 Message 表中符合条件的主键 id 数量
        stmt = select(func.count(Message.id)).where(
            # 过滤条件：消息的 conversation_id 必须与传入的参数一致
            Message.conversation_id == conversation_id
        )

        # 异步执行查询并获取结果：
        return int((await self.session.execute(stmt)).scalar_one())

    async def list_page(self, page: int, page_size: int) -> tuple[list[tuple[Conversation, int]], int]:
        """按 updated_at 倒序分页，返回（会话，消息数）列表 + 总数。

        消息数用一次 LEFT JOIN + GROUP BY 拿，避免 N+1 查询。
        """
        # --- 1. 分页参数安全校验与偏移量计算 ---
        # 确保页码至少为 1
        page = max(page, 1)
        # 确保每页条数在 1 到 100 之间
        page_size = max(min(page_size, 100), 1)
        # 计算 SQL 查询的 OFFSET（跳过前面多少条数据）
        offset = (page - 1) * page_size

        # --- 2. 构建主查询语句 ---
        # 定义聚合函数：统计 Message.id 的数量，并取别名为 "message_count"
        msg_count = func.count(Message.id).label("message_count")

        stmt = (
            select(Conversation, msg_count)
            # 使用 LEFT OUTER JOIN 保证即使没有消息的会话也能被查出来
            .outerjoin(Message, Message.conversation_id == Conversation.id)
            # 按 Conversation.id 分组以计算每个会话的消息数
            .group_by(Conversation.id)
            # 按更新时间降序排序，若更新时间相同则按 ID 降序作为第二排序条件，保证分页稳定性
            .order_by(Conversation.updated_at.desc(), Conversation.id.desc())
            # 限制返回条数并设置偏移量
            .limit(page_size)
            .offset(offset)
        )

        # 异步执行查询并获取所有结果行（rows 是一个列表，每项是包含 Conversation 和 message_count 的元组）
        rows = (await self.session.execute(stmt)).all()
        # 将结果转换为指定格式的列表：取出 Conversation 实例，并将 message_count 转为 Python int
        items = [(row[0], int(row[1])) for row in rows]

        # --- 3. 查询总记录数（用于前端分页组件） ---
        # 统计 Conversation 表的总行数，并转换为 int 类型
        total = int(
            (await self.session.execute(select(func.count(Conversation.id)))).scalar_one()
        )

        # 返回分页数据列表和总条数
        """
        (
            [(会话A的数据, 5), (会话B的数据, 0)],  # 当前页的列表
            3  # 数据库里总共有 3 个会话
        )
        """
        return items, total

    async def delete(self, conversation_id: UUID) -> bool:
        """硬删会话：messages / answer_citations 由 ON DELETE CASCADE 自动清理。

        返回是否真正删了一行，不存在时返回 False，便于路由 404 兜底。
        """
        conversation = await self.get(conversation_id)
        if conversation is None:
            return False
        await self.session.delete(conversation)
        await self.session.flush()
        return True


    async def update_title_if_default(self, conversation_id: UUID, title: str) -> None:
        """首次提问后把"新对话"自动改成问题前 N 字。

        只在当前 title 仍是默认值时改，避免覆盖用户手动改过的标题。
        """
        # 1. 清理传入的标题（通常是用户的第一句提问），去除首尾多余的空白字符
        new_title = title.strip()

        # 2. 如果清理后是空字符串，则直接返回，不进行修改
        if not new_title:
            return

        # 3. 从数据库中获取该会话对象
        conversation = await self.get(conversation_id)

        # 4. 核心逻辑：如果会话不存在，或者当前标题已经不是默认标题（说明用户手动改过），则直接返回
        if conversation is None or conversation.title != DEFAULT_CONVERSATION_TITLE:
            return

        # 5. 截取新标题的前 30 个字符作为最终标题，防止标题过长导致 UI 显示异常或数据库字段超长
        conversation.title = new_title[:30]

        # 6. 将修改应用到数据库会话中（flush 会将 SQL 发送给数据库，但不提交事务，通常由外层统一 commit）
        await self.session.flush()

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