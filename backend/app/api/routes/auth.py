from fastapi import APIRouter

from app.api.deps import CurrentUser, DbSession
from app.api.schemas.auth import LoginRequest, LoginResponse, MeResponse, UserRead
from app.core.exceptions import UnauthorizedError
from app.services.auth_service import AuthService
from app.services.permission_service import compute_user_permission_tags, is_admin

router = APIRouter(prefix="/auth", tags=["auth"])


# =====================================================================
# 接口作用：用户登录。
# 校验前端传来的账号密码，成功后签发 JWT Token，并返回用户信息及权限。
# =====================================================================
@router.post("/login", response_model=LoginResponse, operation_id="login")
async def login(payload: LoginRequest, session: DbSession) -> LoginResponse:
    # 实例化认证服务层
    service = AuthService(session)

    # 调用服务层进行身份校验（去数据库比对用户名和哈希密码）
    user = await service.authenticate(payload.username, payload.password)

    # 校验失败（用户不存在、密码错或账号被禁用，统一返回 None）
    if user is None:
        # 统一文案，避免侧信道枚举用户名 vs 密码
        # （即：无论到底是账号错还是密码错，提示都一样，防黑客试探）
        raise UnauthorizedError("用户名或密码错误")

    # 校验成功，调用服务层签发 JWT Token
    token = AuthService.issue_token(user)

    # 组装登录响应模型并返回
    return LoginResponse(
        access_token=token,
        # 将数据库实体模型安全地转换为 Pydantic 响应模型
        user=UserRead.model_validate(user),
        # 合并该用户所有角色的权限标签（用于前端按钮级别的权限控制）
        permission_tags=compute_user_permission_tags(user),
        # 判断是否为管理员
        is_admin=is_admin(user),
    )


# =====================================================================
# 接口作用：获取当前登录用户的信息（常被称为 /me 接口）。
# 前端初始化（如刷新页面）时调用，用于恢复用户的登录状态和权限。
# =====================================================================
@router.get("/me", response_model=MeResponse, operation_id="getCurrentUser")
async def me(user: CurrentUser) -> MeResponse:
    """前端启动时 / 路由切换时拉一次，保证角色变更后立即生效。"""
    # 这里的 user: CurrentUser 是一个依赖注入。
    # FastAPI 会自动去解析请求头中的 Token，查库校验并拿到 user 对象传进来。
    # 如果 Token 无效，根本走不到这个函数内部就会返回 401。
    return MeResponse(
        user=UserRead.model_validate(user),
        permission_tags=compute_user_permission_tags(user),
        is_admin=is_admin(user),
    )