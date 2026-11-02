"""FastAPI 依赖项汇总"""

from typing import Annotated
from uuid import UUID

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_session
from app.core.exceptions import PermissionDeniedError, UnauthorizedError
from app.core.security import decode_access_token
from app.db.models import User, UserStatus
from app.db.repositories.user_repo import UserRepository
from fastapi import Header
from app.services.permission_service import is_admin



# DbSession 是一个可复用的类型别名，用于 FastAPI 依赖注入：
# - Annotated 是 Python 的类型注解工具，语法是 Annotated[主类型, 附加信息]
# - AsyncSession：声明该参数的类型为 SQLAlchemy 的异步数据库会话
# - Depends(get_session)：告诉 FastAPI 在调用路由函数时，自动执行 get_session()
#   获取一个数据库会话并注入到该参数中，无需在每个路由里手动获取连接
DbSession = Annotated[AsyncSession, Depends(get_session)]


# =====================================================================
# 函数作用：从请求头（Header）中安全地提取出 JWT 字符串（纯字符串处理）。
# =====================================================================
def _parse_bearer_token(authorization: str | None) -> str:
    """从 Authorization header 取出 Bearer token；缺失或格式错误统一 401。"""
    # 如果请求头里没有 Authorization 字段，说明用户根本没带凭证
    if not authorization:
        raise UnauthorizedError("请先登录")

    # 格式通常是 "Bearer <token>"，用 partition(" ") 按第一个空格切分。
    # scheme = "Bearer", _, token = 具体的 JWT 字符串
    scheme, _, token = authorization.partition(" ")

    # 校验：前面的协议名必须是 Bearer（忽略大小写），且后面的 token 不能为空
    if scheme.lower() != "bearer" or not token:
        raise UnauthorizedError("无效的访问凭证")

    return token


# =====================================================================
# 函数作用：FastAPI 核心依赖。解析请求头中的 Token，校验通过后返回当前用户对象。
# 这就是绝大部分接口用来获取“当前登录用户是谁”的入口。
# =====================================================================
async def get_current_user(
        # 依赖注入：从 FastAPI 拿到数据库 Session
        session: Annotated[AsyncSession, Depends(get_session)],
        # 依赖注入：从 HTTP 请求头中提取 Authorization 字段，允许为空
        authorization: Annotated[str | None, Header(alias="Authorization")] = None,
) -> User:
    """解析 Bearer token，查表拿到 User。

    每个请求都重新查一次而不是把信息塞进 token：
    - 角色 / 状态变更后立即生效，不必等 token 自然过期
    - token 内只放 user_id，泄露 token 也拿不到额外用户信息
    """
    # 1. 提取纯 Token 字符串
    token = _parse_bearer_token(authorization)
    # 2. 解析 Token（会校验签名和过期时间），拿到 user_id 字符串
    subject = decode_access_token(token)

    try:
        # 3. 将字符串 user_id 强转为 UUID 对象
        user_id = UUID(subject)
    except (ValueError, TypeError) as exc:
        # 防止存进 Token 里的 ID 格式不对
        raise UnauthorizedError("无效的访问凭证") from exc

    # 4. 拿着 user_id 去数据库查真实的人（而不是直接信任 Token 里的数据）
    user = await UserRepository(session).get_by_id(user_id)

    # 5. 校验这个人是否存在
    if user is None:
        raise UnauthorizedError("用户不存在或已被删除")

    # 6. 校验这个人的账号是否被管理员禁用了
    if user.status != UserStatus.ACTIVE:
        raise UnauthorizedError("账号已被禁用")

    # 全部检查通过，返回完整的 User 对象
    return user


# =====================================================================
# 函数作用：FastAPI 权限依赖。在确认用户已登录的基础上，进一步校验其必须是管理员。
# =====================================================================
async def get_current_admin(user: Annotated[User, Depends(get_current_user)],) -> User:
    """仅 admin 可通过。普通用户 403。"""
    # 调用之前看过的 is_admin 函数判断角色
    if not is_admin(user):
        # 抛出 403 禁止访问异常，告诉前端“你登录了，但你没资格”
        raise PermissionDeniedError("仅管理员可访问")
    return user


# =====================================================================
# 类型别名：为了让路由层（Router）写起来更简洁。
# 以后在写接口时，参数直接写 current_user: CurrentUser 即可。
# =====================================================================
CurrentUser = Annotated[User, Depends(get_current_user)]
CurrentAdmin = Annotated[User, Depends(get_current_admin)]
