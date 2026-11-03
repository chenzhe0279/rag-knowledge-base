from uuid import UUID
from fastapi import APIRouter, Response
from app.api.deps import CurrentAdmin, DbSession
from app.api.schemas.auth import RoleRead
from app.api.schemas.roles import RoleCreate, RoleUpdate
from app.services.role_service import RoleService

router = APIRouter(prefix="/roles", tags=["roles"])


# =====================================================================
# 接口作用：获取系统中所有的角色列表。
# 【权限控制】仅管理员可访问。
# =====================================================================
@router.get("", response_model=list[RoleRead], operation_id="listRoles")
async def list_roles(_: CurrentAdmin, session: DbSession) -> list[RoleRead]:
    # 实例化角色服务层
    service = RoleService(session)
    # 调用服务层获取全部角色数据
    roles = await service.list_roles()
    # 使用列表推导式，将 ORM 对象列表转换为 Pydantic 响应模型列表并返回
    return [RoleRead.model_validate(r) for r in roles]


# =====================================================================
# 接口作用：创建一个新角色。
# 【权限控制】仅管理员可访问。
# =====================================================================
@router.post("", response_model=RoleRead, status_code=201, operation_id="createRole")
async def create_role(_: CurrentAdmin, session: DbSession, payload: RoleCreate,) -> RoleRead:
    # 实例化角色服务层
    service = RoleService(session)
    # 调用服务层方法创建角色，传入名称、描述和权限标签
    role = await service.create_role(
        name=payload.name,
        description=payload.description,
        permission_tags=payload.permission_tags,
    )
    # 将创建好的 ORM 对象转换为 Pydantic 响应模型并返回
    return RoleRead.model_validate(role)


# =====================================================================
# 接口作用：更新指定角色的信息（支持局部更新）。
# 【权限控制】仅管理员可访问。
# =====================================================================
@router.patch("/{role_id}", response_model=RoleRead, operation_id="updateRole")
async def update_role(_: CurrentAdmin, session: DbSession, role_id: UUID, payload: RoleUpdate,) -> RoleRead:
    # 实例化角色服务层
    service = RoleService(session)
    # 调用服务层更新方法。注意：这里没有传 name，因为系统不允许修改角色名
    role = await service.update_role(
        role_id,
        description=payload.description,
        permission_tags=payload.permission_tags,
    )
    # 返回更新后的角色信息
    return RoleRead.model_validate(role)


# =====================================================================
# 接口作用：根据 ID 删除指定的角色。
# 【权限控制】仅管理员可访问。
# 【返回状态】204 No Content，表示成功但无内容返回。
# =====================================================================
@router.delete("/{role_id}", status_code=204, operation_id="deleteRole")
async def delete_role(_: CurrentAdmin, session: DbSession, role_id: UUID,) -> Response:
    # 实例化角色服务层
    service = RoleService(session)
    # 调用服务层删除方法（内部会校验该角色是否是受保护的内置角色，如 admin/user）
    await service.delete_role(role_id)
    # 返回空的 204 响应
    return Response(status_code=204)