from uuid import UUID

from sqlalchemy import select, Sequence
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Role




# =====================================================================
# 类作用：角色表（Role）的数据库仓储层（Repository）。
# 负责封装与 Role 表相关的所有数据库操作，比如根据 ID/名称查角色、批量查角色等。
# =====================================================================

class RoleRepository:
    # 初始化方法，注入异步数据库会话
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # =====================================================================
    # 方法作用：根据主键 ID 查询单条角色信息。
    # =====================================================================
    async def get_by_id(self, role_id: UUID) -> Role | None:
        # 使用 session.get() 按主键查询，效率最高，且会优先走缓存
        return await self.session.get(Role, role_id)

    # =====================================================================
    # 方法作用：根据角色名称查询角色信息。
    # 典型场景：创建角色时校验名字是否重复，或者登录后根据角色名查权限。
    # =====================================================================
    async def get_by_name(self, name: str) -> Role | None:
        # 构建查询语句：SELECT * FROM roles WHERE name = ?
        stmt = select(Role).where(Role.name == name)
        # scalar_one_or_none() 返回单个对象或 None，查不到不报错
        return (await self.session.execute(stmt)).scalar_one_or_none()

    # =====================================================================
    # 方法作用：获取系统中所有的角色列表。
    # =====================================================================
    async def list_all(self) -> list[Role]:
        """角色总量天然小不分页。"""
        # 按创建时间正序、ID正序排序，保证前端下拉框展示顺序稳定
        stmt = select(Role).order_by(Role.created_at.asc(), Role.id.asc())
        # .scalars().all() 提取出纯净的 Role 对象列表
        return list((await self.session.execute(stmt)).scalars().all())

    # =====================================================================
    # 方法作用：根据一组 ID，批量查询多个角色信息。
    # 典型场景：给用户分配角色时，前端可能传一个角色 ID 列表过来，后端需要查出对应的实体对象。
    # =====================================================================
    async def get_many(self, role_ids: Sequence[UUID]) -> list[Role]:
        # 防御性判断：如果传进来的是空列表，直接返回空列表，避免无意义的数据库查询
        if not role_ids:
            return []
        # 构建查询语句：使用 in_ 操作符，相当于 SQL 里的 WHERE id IN (id1, id2, ...)
        stmt = select(Role).where(Role.id.in_(list(role_ids)))
        return list((await self.session.execute(stmt)).scalars().all())

    # =====================================================================
    # 方法作用：向数据库添加一个新角色。
    # =====================================================================
    async def add(self, role: Role) -> Role:
        # 放入 Session 待处理队列
        self.session.add(role)
        # 刷入数据库获取数据库生成的字段（如自增ID、创建时间），但不提交事务
        await self.session.flush()
        return role

    # =====================================================================
    # 方法作用：从数据库中删除指定角色。
    # =====================================================================
    async def delete(self, role: Role) -> None:
        # 标记为待删除
        await self.session.delete(role)
        # 执行 DELETE 语句，不提交事务
        await self.session.flush()