from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# 与 app.db.models.UserStatus 同步
UserStatusValue = Literal["active", "disabled"]


# =====================================================================
# 类作用：角色信息的响应模型（Schema）。
# 用于 FastAPI 返回角色数据给前端时的结构定义。
# =====================================================================
class RoleRead(BaseModel):
    # 允许从 ORM 数据库模型（SQLAlchemy）直接读取属性并转换为 Pydantic 模型
    model_config = ConfigDict(from_attributes=True)

    # 角色的唯一 ID
    id: UUID
    # 角色名称（如 "admin"）
    name: str
    # 角色描述
    description: str
    # 权限标签列表
    # 使用 default_factory=list 确保每个实例都有自己独立的空列表，避免多个实例共享同一个列表导致数据串号
    permission_tags: list[str] = Field(default_factory=list)
    # 角色创建时间
    created_at: datetime


# =====================================================================
# 类作用：用户信息的响应模型（Schema）。
# 用于 FastAPI 返回用户数据给前端时的结构定义。
# =====================================================================
class UserRead(BaseModel):
    """用户响应。role 列表里只展示必要字段，权限标签由前端从 roles 推。"""

    # 允许从 ORM 数据库模型直接读取属性并转换
    model_config = ConfigDict(from_attributes=True)

    # 用户的唯一 ID
    id: UUID
    # 用户名（登录账号）
    username: str
    # 用户昵称（展示用）
    display_name: str
    # 用户状态。使用之前定义的 Literal 类型，限制只能是 "active" 或 "disabled"
    status: UserStatusValue

    # 【嵌套模型】该用户拥有的角色列表。
    # 注意：这里直接用了 RoleRead 类。这意味着返回的 JSON 里，roles 会是一个包含角色详细信息的对象数组。
    # 同样使用 default_factory=list 防止共享内存陷阱。
    roles: list[RoleRead] = Field(default_factory=list)

    # 用户创建时间
    created_at: datetime
    # 用户信息最后更新时间
    updated_at: datetime


# =====================================================================
# 类作用：登录请求模型（前端发给后端的账号密码）。
# =====================================================================
class LoginRequest(BaseModel):
    # 登录用户名
    username: str
    # 登录密码（明文，后端收到后会去和数据库里的哈希值比对）
    password: str


# =====================================================================
# 类作用：登录成功后的响应模型（后端返回给前端的数据）。
# =====================================================================
class LoginResponse(BaseModel):
    # 签发的 JWT 访问令牌。前端需要把它存起来（比如 localStorage 或 Cookie）
    access_token: str

    # Token 的类型。使用 Literal 锁死为 "bearer"（OAuth 2.0 标准），默认也是 "bearer"
    token_type: Literal["bearer"] = "bearer"

    # 嵌套用户基础信息（复用了前面定义的 UserRead 模型）
    user: UserRead

    # 该用户合并后的所有权限标签（方便前端立刻拿到权限，进行按钮级别的控制）
    permission_tags: list[str] = Field(default_factory=list)

    # 是否为管理员（方便前端判断是否要渲染“后台管理”入口）
    is_admin: bool


# =====================================================================
# 类作用：获取“当前登录用户信息”的响应模型。
# 典型场景：用户刷新了网页，前端拿着本地存的 Token 再次请求后端，用于恢复用户状态。
# =====================================================================
class MeResponse(BaseModel):
    """当前登录用户视图：用户基础信息 + 合并后的有效权限标签 + 是否管理员。"""

    # 嵌套用户基础信息
    user: UserRead

    # 合并后的有效权限标签
    permission_tags: list[str] = Field(default_factory=list)

    # 是否是管理员
    is_admin: bool