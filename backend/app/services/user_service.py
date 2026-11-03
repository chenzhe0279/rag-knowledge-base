from collections.abc import Sequence
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, NotFoundError, ValidationError
from app.core.security import hash_password
from app.db.models import User, UserStatus
from app.db.repositories.role_repo import RoleRepository
from app.db.repositories.user_repo import UserRepository


# =====================================================================
# 类作用：用户服务层（UserService）。
# 负责处理与用户相关的业务逻辑，是路由层（API）和仓储层（数据库）之间的桥梁。
# 在这里会进行业务规则校验（如用户是否存在、角色是否合法等）。
# =====================================================================
class UserService:
    # 初始化方法，注入数据库会话，并实例化相关的仓储层
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.user_repo = UserRepository(session)
        # 因为用户和角色是关联的，所以这里也顺便实例化了角色仓储，方便后续（比如创建用户时分配角色）调用
        self.role_repo = RoleRepository(session)

    # =====================================================================
    # 方法作用：分页获取用户列表。
    # =====================================================================
    async def list_users(self, page: int, page_size: int) -> tuple[list[User], int]:
        # 直接调用用户仓储层的分页方法。服务层在这里没有特殊的业务逻辑需要处理，直接透传即可。
        return await self.user_repo.list_paginated(page, page_size)

    # =====================================================================
    # 方法作用：根据 ID 获取单个用户详情。
    # =====================================================================
    async def get_user(self, user_id: UUID) -> User:
        # 去数据库里查询用户
        user = await self.user_repo.get_by_id(user_id)

        # 业务校验：如果数据库里没有这个用户，必须抛出 404 业务异常。
        # 如果不抛，直接返回 None，路由层拿到 None 后可能会导致奇怪的前端报错（比如前端报错 Cannot read properties of null）。
        if user is None:
            raise NotFoundError("用户不存在")

        return user

    # =====================================================================
    # 方法作用：创建一个新用户。
    # =====================================================================
    async def create_user(
            self, *, username: str, password: str, display_name: str,
            role_ids: Sequence[UUID] | None = None,
    ) -> User:
        # 1. 清洗输入数据：去除首尾空格
        username = username.strip()
        # 如果昵称为空（去空格后），默认使用用户名作为昵称
        display_name = display_name.strip() or username

        # 2. 基础校验
        if not username:
            raise ValidationError("用户名不能为空")
        # 密码不能为空，且长度至少 4 位
        if not password or len(password) < 4:
            raise ValidationError("密码长度至少 4 位")

        # 3. 查重校验：确认用户名没被注册过
        existing = await self.user_repo.get_by_username(username)
        if existing is not None:
            raise ConflictError(f"用户名 {username} 已存在")

        # 4. 构建用户实体对象
        user = User(
            username=username,
            # 【核心安全】调用 hash_password 将明文密码转为哈希值存储
            password_hash=hash_password(password),
            display_name=display_name,
            # 新用户默认状态为正常/启用
            status=UserStatus.ACTIVE,
        )

        # 5. 处理角色关联（如果前端指定了角色 ID 列表）
        if role_ids:
            # 根据 ID 列表批量查询角色实体
            roles = await self.role_repo.get_many(list(role_ids))
            # 将角色绑定给用户
            user.roles = roles

        # 6. 持久化到数据库
        await self.user_repo.add(user)
        await self.session.commit()
        # 刷新实体：因为刚刚操作了 roles 多对多关系，这里指定刷新 roles 属性，确保返回给前端的对象携带了完整的角色信息
        await self.session.refresh(user, attribute_names=["roles"])
        return user


    # =====================================================================
    # 方法作用：更新（修改）用户信息。支持部分更新。
    # =====================================================================
    async def update_user(self, user_id: UUID, *, display_name: str | None = None, status: UserStatus | None = None, password: str | None = None,) -> User:
        # 先获取用户（如果不存在会直接抛 404）
        user = await self.get_user(user_id)

        # 更新昵称逻辑
        if display_name is not None:
            display_name = display_name.strip()
            if not display_name:
                raise ValidationError("昵称不能为空")
            user.display_name = display_name

        # 更新状态逻辑
        if status is not None:
            user.status = status

        # 更新密码逻辑
        if password is not None:
            if len(password) < 4:
                raise ValidationError("密码长度至少 4 位")
            # 重新计算哈希
            user.password_hash = hash_password(password)

        # 提交更改
        await self.session.commit()
        # commit 会 expire 所有列属性；这里先整体 refresh 重新加载 updated_at 等列，
        # 再单独刷新 roles，避免 Pydantic 在同步序列化时触发异步懒加载。
        await self.session.refresh(user)
        await self.session.refresh(user, attribute_names=["roles"])
        return user

    # =====================================================================
    # 方法作用：专门用于整体替换用户拥有的角色（通常用于管理员分配角色的接口）。
    # =====================================================================
    async def set_roles(self, user_id: UUID, role_ids: Sequence[UUID]) -> User:
        # 获取用户
        user = await self.get_user(user_id)
        # 根据 ID 查出所有的目标角色
        roles = await self.role_repo.get_many(list(role_ids))
        # 调用仓储层的方法进行角色覆盖（内部多对多关系表会同步更新）
        await self.user_repo.set_roles(user, roles)
        await self.session.commit()
        # 刷新角色的关联数据，确保返回最新
        await self.session.refresh(user, attribute_names=["roles"])
        return user

    # =====================================================================
    # 方法作用：根据 ID 删除用户（硬删除）。
    # =====================================================================
    async def delete_user(self, user_id: UUID) -> None:
        # 获取用户，顺便校验存在性
        user = await self.get_user(user_id)
        # 删除用户
        await self.user_repo.delete(user)
        # 提交事务
        await self.session.commit()