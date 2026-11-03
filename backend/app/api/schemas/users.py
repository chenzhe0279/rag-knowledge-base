from uuid import UUID
from pydantic import BaseModel, Field
from app.api.schemas.auth import UserRead, UserStatusValue

# =====================================================================
# 类作用：创建用户（管理员新建用户）的请求体模型。
# =====================================================================
class UserCreate(BaseModel):
    # 用户名：限制长度在 2 到 64 个字符之间
    username: str = Field(min_length=2, max_length=64)
    # 密码：限制长度在 4 到 128 个字符之间
    password: str = Field(min_length=4, max_length=128)
    # 昵称：限制长度在 1 到 128 个字符之间
    display_name: str = Field(min_length=1, max_length=128)
    # 角色 ID 列表：可选，默认为空列表。使用 default_factory 防止可变对象共享陷阱
    role_ids: list[UUID] = Field(default_factory=list)


# =====================================================================
# 类作用：更新用户信息的请求体模型（PATCH 请求）。
# 允许前端只传需要修改的字段，实现部分更新。
# =====================================================================
class UserUpdate(BaseModel):
    """PATCH 请求体；字段均可选。

    password 字段如果传非空字符串则重置密码；传 None 不动密码。
    """

    # 昵称：可选，如果传了，限制最大长度为 128
    display_name: str | None = Field(default=None, max_length=128)
    # 状态：可选，只能传 "active" 或 "disabled"
    status: UserStatusValue | None = None
    # 密码：可选，如果传了非空密码，限制长度在 4 到 128 之间
    password: str | None = Field(default=None, min_length=4, max_length=128)


# =====================================================================
# 类作用：专门用于给用户分配角色的请求体模型。
# 前端在下拉框勾选完角色后，把角色 ID 列表打包发过来。
# =====================================================================
class AssignRolesRequest(BaseModel):
    # 角色 ID 列表
    role_ids: list[UUID] = Field(default_factory=list)


# =====================================================================
# 类作用：用户列表的分页响应模型。
# 用于返回用户数据列表以及分页元数据。
# =====================================================================
class UserPage(BaseModel):
    # 当前页的用户数据列表（复用了之前定义的 UserRead 模型）
    items: list[UserRead]
    # 数据库中用户的总数
    total: int
    # 当前页码：必须大于等于 1
    page: int = Field(ge=1)
    # 每页显示的条数：必须在 1 到 100 之间
    page_size: int = Field(ge=1, le=100)