from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models import Role, User


# =====================================================================
# 类作用：用户表（User）的数据库仓储层（Repository）。
# 负责封装与 User 表相关的所有数据库增删改查操作。
# =====================================================================
class UserRepository:
    # 初始化方法，注入异步数据库会话
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # =====================================================================
    # 方法作用：根据用户 ID（主键）查询用户信息。
    # =====================================================================
    async def get_by_id(self, user_id: UUID) -> User | None:
        # roles 走 lazy="selectin" 自动预加载，这里 session.get 直接拿即可
        # 因为我们在 User 模型里定义了 lazy="selectin"，当查出 User 时，SQLAlchemy 会自动顺带把 roles 查出来，不需要手动写 join
        return await self.session.get(User, user_id)

    # =====================================================================
    # 方法作用：根据用户名查询用户信息。
    # 典型场景：登录时校验用户名是否存在。
    # =====================================================================
    async def get_by_username(self, username: str) -> User | None:
        # 构建查询语句
        stmt = (
            select(User)
            # 过滤条件：用户名匹配
            .where(User.username == username)
            # 强制预加载 roles 关系，防止在异步环境下因延迟加载引发报错
            .options(selectinload(User.roles))
        )
        # 执行查询。
        # scalar_one_or_none()：期望返回 0 个或 1 个结果。如果没找到返回 None，如果找到返回 User 对象。如果查到多个（理论上不可能，因为 username 唯一），会报错。
        return (await self.session.execute(stmt)).scalar_one_or_none()

    # =====================================================================
    # 方法作用：统计系统里一共有多少个用户。
    # 典型场景：系统初始化时，判断是否需要自动创建超级管理员账号。
    # =====================================================================
    async def count_all(self) -> int:
        """启动期种子初始化用：库内无用户时才建 admin。"""
        # 构建 COUNT 查询，统计 User.id 的数量
        # 外层套 int() 防止数据库驱动返回 Decimal 等非原生 int 类型
        return int(
            (await self.session.execute(select(func.count(User.id)))).scalar_one()
        )

    # =====================================================================
    # 方法作用：分页查询用户列表。
    # 返回当前页的用户对象列表，以及用户的总数（用于前端计算总页数）。
    # =====================================================================
    async def list_paginated(self, page: int, page_size: int) -> tuple[list[User], int]:
        # 安全校验与偏移量计算（防止前端传负数或超大数据）
        page = max(page, 1)
        page_size = max(min(page_size, 100), 1)
        offset = (page - 1) * page_size

        # 构建主查询语句
        items_stmt = (
            select(User)
            # 按创建时间正序排，时间相同则按 ID 正序排，保证分页结果稳定
            .order_by(User.created_at.asc(), User.id.asc())
            # 跳过前面的数据
            .offset(offset)
            # 限制返回条数
            .limit(page_size)
            # 强制预加载关联的 roles（角色）数据，防止异步环境下的懒加载报错
            .options(selectinload(User.roles))
        )

        # 构建总数查询语句
        count_stmt = select(func.count(User.id))

        # 执行主查询，提取出 ORM 对象列表
        items = (await self.session.execute(items_stmt)).scalars().all()
        # 执行总数查询，提取出整数
        total = (await self.session.execute(count_stmt)).scalar_one()

        # 返回列表和总数
        return list(items), int(total)

    # =====================================================================
    # 方法作用：向数据库添加一个新用户。
    # =====================================================================
    async def add(self, user: User) -> User:
        # 将新用户对象放入 Session 的待处理队列
        self.session.add(user)
        # flush 到数据库（执行 INSERT），生成主键 ID 等，但不 commit
        await self.session.flush()
        # 返回带有 ID 的 User 对象
        return user

    # =====================================================================
    # 方法作用：从数据库中删除一个用户。
    # =====================================================================
    async def delete(self, user: User) -> None:
        # 将用户对象标记为待删除状态
        await self.session.delete(user)
        # flush 到数据库（执行 DELETE），但不 commit
        await self.session.flush()

    # =====================================================================
    # 方法作用：整体替换用户拥有的角色集合。
    # 常用于管理员修改用户角色（比如把张三从“访客”改成“管理员”）。
    # =====================================================================
    async def set_roles(self, user: User, roles: list[Role]) -> None:
        """整体替换用户角色集合。"""
        # 直接对多对多关系属性赋新值，SQLAlchemy 会自动计算需要新增和删除的中间表记录
        user.roles = roles
        # flush 到数据库，更新关联关系（写入 user_roles 中间表）
        await self.session.flush()