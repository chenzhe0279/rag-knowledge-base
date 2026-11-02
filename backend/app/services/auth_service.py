from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logger import get_logger
from app.core.security import create_access_token, verify_password
from app.db.models import User, UserStatus
from app.db.repositories.user_repo import UserRepository

# 获取当前模块的日志记录器
logger = get_logger(__name__)


# =====================================================================
# 类作用：认证服务层（AuthService）。
# 负责处理用户的登录校验逻辑（验证账号密码、判断账号状态）以及签发 Token。
# =====================================================================
class AuthService:
    # 初始化方法，注入数据库会话
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        # 实例化用户仓储层（负责查数据库）
        self.user_repo = UserRepository(session)

    # =====================================================================
    # 方法作用：校验用户登录。
    # 如果校验通过，返回用户对象；如果失败（用户不存在/密码错/被禁用），返回 None。
    # =====================================================================
    async def authenticate(self, username: str, password: str) -> User | None:
        """登录校验。

        - 用户名不存在 / 密码不对 / 账号禁用 -> 统一返回 None
        - 不区分"用户不存在"与"密码不对"避免侧信道枚举用户名
        - 路由层把 None 统一翻译成 UnauthorizedError("用户名或密码错误")
        """
        # 1. 去数据库里根据用户名查询用户
        user = await self.user_repo.get_by_username(username)

        # 2. 如果用户不存在，直接返回 None
        if user is None:
            return None

        # 3. 如果用户存在，但状态不是 ACTIVE（比如被禁用、封号了），记录日志并返回 None
        if user.status != UserStatus.ACTIVE:
            logger.info("login refused (disabled): username=%s", username)
            return None

        # 4. 校验密码。verify_password 会对比明文密码和数据库里的哈希值。
        # 如果密码不匹配，返回 None。
        if not verify_password(password, user.password_hash):
            return None

        # 5. 所有检查都通过，返回查到的用户对象
        return user

    # =====================================================================
    # 方法作用：为登录成功的用户签发访问令牌（JWT）。
    # 使用 @staticmethod 是因为这个方法不需要访问 self（不需要查数据库），纯粹是一个工具方法。
    # =====================================================================
    @staticmethod
    def issue_token(user: User) -> str:
        # 调用 core/security.py 里的生成 Token 函数，把 user.id 转成字符串传进去作为载荷(sub)
        return create_access_token(str(user.id))