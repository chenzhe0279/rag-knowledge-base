from fastapi import APIRouter, Query, Response
from uuid import UUID
from app.api.deps import CurrentAdmin, DbSession
from app.api.schemas.auth import UserRead
from app.api.schemas.users import (
    AssignRolesRequest,
    UserCreate,
    UserPage,
    UserUpdate,
)
from app.core.exceptions import ValidationError
from app.db.models import UserStatus
from app.services.user_service import UserService

router = APIRouter(prefix="/users", tags=["users"])


# =====================================================================
# 接口作用：获取用户列表（分页）。
# 【权限控制】参数 _: CurrentAdmin 强制要求调用此接口的必须是管理员。
# =====================================================================
@router.get("", response_model=UserPage, operation_id="listUsers")
async def list_users(
        _: CurrentAdmin, # 【管理员鉴权】下划线 _ 表示虽然需要校验管理员权限，但在当前函数内部不需要使用该管理员的具体信息
        session: DbSession,
        page: int = Query(1, ge=1),
        page_size: int = Query(20, ge=1, le=100),
) -> UserPage:
    # 实例化用户服务层
    service = UserService(session)
    # 调用服务层获取分页数据和总条数
    items, total = await service.list_users(page, page_size)

    # 组装并返回分页响应模型
    return UserPage(
        # 将 ORM 对象列表转换为 Pydantic 模型列表
        items=[UserRead.model_validate(u) for u in items],
        total=total,
        page=page,
        page_size=page_size,
    )


# =====================================================================
# 接口作用：管理员创建新用户。
# 【权限控制】同样要求必须是管理员。
# =====================================================================
@router.post("", response_model=UserRead, status_code=201, operation_id="createUser")
async def create_user(
        _: CurrentAdmin, # 【管理员鉴权】使用 _ 占位，表示需要管理员权限但不需要用到具体的管理员信息
        session: DbSession,
        # 请求体：包含新用户的信息（用户名、密码、昵称、角色 ID 列表）
        payload: UserCreate,
) -> UserRead:
    # 实例化用户服务层
    service = UserService(session)

    # 调用服务层的方法创建用户
    user = await service.create_user(
        username=payload.username,
        password=payload.password,
        display_name=payload.display_name,
        role_ids=payload.role_ids,
    )

    # 将创建好的用户 ORM 对象转换为 Pydantic 响应模型并返回
    return UserRead.model_validate(user)


# =====================================================================
# 接口作用：更新（修改）指定用户的信息。
# 【权限控制】仅管理员可操作。
# 【核心逻辑】因为前端传来的 status 是字符串，后端需要安全地将其转换为枚举类型。
# =====================================================================
@router.patch("/{user_id}", response_model=UserRead, operation_id="updateUser")
async def update_user(
        _: CurrentAdmin, # 【管理员鉴权】使用 _ 占位，表示需要管理员权限但不需要用到具体的管理员信息
        session: DbSession,
        user_id: UUID,
        payload: UserUpdate,
) -> UserRead:
    # 初始化状态变量，默认为 None（代表前端没有修改状态）
    status: UserStatus | None = None

    # 如果前端确实传了 status 字段
    if payload.status is not None:
        try:
            # 尝试将前端传来的字符串（如 "active"）转换为 UserStatus 枚举对象
            status = UserStatus(payload.status)
        except ValueError as exc:
            # 如果前端传了乱七八糟的字符串（如 "running"），枚举转换会失败，抛出 400 校验异常
            raise ValidationError("非法的用户状态") from exc

    # 实例化用户服务层
    service = UserService(session)

    # 调用服务层进行更新，将转换好的 status 以及其他字段传进去
    user = await service.update_user(
        user_id,
        display_name=payload.display_name,
        status=status,
        password=payload.password,
    )
    # 将更新后的 ORM 对象转换为 Pydantic 模型返回
    return UserRead.model_validate(user)


# =====================================================================
# 接口作用：给指定的用户分配/重置角色。
# 【权限控制】仅管理员可操作。
# =====================================================================
@router.put("/{user_id}/roles", response_model=UserRead, operation_id="assignUserRoles")
async def assign_user_roles(
        _: CurrentAdmin, # 【管理员鉴权】使用 _ 占位，表示需要管理员权限但不需要用到具体的管理员信息
        session: DbSession,
        user_id: UUID,
        payload: AssignRolesRequest,
) -> UserRead:
    # 实例化用户服务层
    service = UserService(session)

    # 调用服务层的 set_roles 方法进行角色绑定（全量替换）
    user = await service.set_roles(user_id, payload.role_ids)

    # 返回更新后的用户信息
    return UserRead.model_validate(user)


# =====================================================================
# 接口作用：删除指定的用户。
# 【权限控制】仅管理员可操作。
# =====================================================================
@router.delete("/{user_id}", status_code=204, operation_id="deleteUser")
async def delete_user(
        admin: CurrentAdmin,  # 注意：这里的管理员变量命名为 admin（而不是 _），因为后续需要用到它的 ID 做防呆判断
        session: DbSession,
        user_id: UUID,
) -> Response:
    # 【核心防呆逻辑】如果当前登录的管理员的 ID，等于要删除的用户的 ID
    if admin.id == user_id:
        # 防呆：admin 不能把自己删了
        raise ValidationError("不能删除当前登录的管理员账号")

    # 实例化用户服务层
    service = UserService(session)

    # 执行删除操作
    await service.delete_user(user_id)

    # 返回空的 204 响应
    return Response(status_code=204)