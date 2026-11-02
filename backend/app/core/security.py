from datetime import UTC, datetime, timedelta

import bcrypt
import jwt

from app.core.config import settings
from app.core.exceptions import UnauthorizedError


# =====================================================================
# 函数作用：将用户输入的明文密码，转换为数据库存储的安全哈希字符串。
# =====================================================================
def hash_password(plain: str) -> str:
    """bcrypt 默认 cost=12，单次哈希约 200ms，足够防御彩虹表 + 暴力破解。"""
    #  bcrypt.gensalt()：生成一个随机盐（Salt）。它保证了即使是相同的密码，每次生成的哈希值也完全不同。
    #  bcrypt.hashpw(...)：执行哈希计算。
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


# =====================================================================
# 函数作用：校验用户登录时输入的明文密码，与数据库里的哈希值是否匹配。
# =====================================================================
def verify_password(plain: str, hashed: str) -> bool:
    try:
        # 1. 将明文密码和数据库里的哈希值都编码为 bytes 格式。
        # 2. bcrypt.checkpw 会从 hashed 中提取出当时的盐（Salt），用相同的算法计算 plain 的哈希，并进行安全的比对。
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


# =====================================================================
# 函数作用：生成访问令牌（Access Token）。
# 将用户身份信息打包，加上签名和过期时间，生成一个 JWT 字符串发给前端。
# =====================================================================
def create_access_token(subject: str) -> str:
    """signed JWT。subject 约定放 user_id 字符串。"""
    # 安全检查：如果服务端没有配置 JWT 密钥，绝对不能让系统带病运行
    if not settings.jwt_secret:
        # 启动期已经打过 ERROR；这里再兜一道，避免空 secret 签出"任何人都能伪造"的 token
        raise UnauthorizedError("服务端未配置 JWT secret，无法签发 token")

    # 获取当前的 UTC 时间
    now = datetime.now(UTC)

    # 构建 JWT 的核心载荷（Payload），也就是你想塞进 Token 里的数据
    payload = {
        # sub (Subject)：代表这个 Token 属于谁，这里放 user_id
        "sub": subject,
        # iat (Issued At)：签发时间（时间戳格式），记录 Token 是什么时候发出去的
        "iat": int(now.timestamp()),
        # exp (Expiration Time)：过期时间。用当前时间加上配置的过期分钟数，转为时间戳
        "exp": int((now + timedelta(minutes=settings.jwt_expire_minutes)).timestamp()),
    }

    # 调用 jwt.encode 进行加密签名。传入载荷、密钥和服务端配置的算法（如 HS256），生成最终的 Token 字符串
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


# =====================================================================
# 函数作用：解析并验证访问令牌（Access Token）。
# 用户下次请求带着 Token 来时，用它来验明正身，并提取出用户 ID。
# =====================================================================
def decode_access_token(token: str) -> str:
    """返回 token 中 sub 字段（user_id 字符串）；任何失败都转 UnauthorizedError。"""
    # 同样的安全检查：没密钥怎么验证签名？
    if not settings.jwt_secret:
        raise UnauthorizedError("服务端未配置 JWT secret")

    try:
        # 调用 jwt.decode 解析 Token。
        # 必须指定 algorithms 列表，防止黑客使用“none”算法伪造 Token 攻击。
        # PyJWT 会自动校验签名是否被篡改，以及是否已经过期。
        payload = jwt.decode(
            token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
        )
    except jwt.ExpiredSignatureError as exc:
        # 专门捕获“过期”异常，给前端返回明确提示，引导用户去重新登录
        raise UnauthorizedError("登录已过期，请重新登录") from exc
    except jwt.InvalidTokenError as exc:
        # 捕获所有其他的 Token 异常（比如格式错乱、签名不匹配、被篡改等）
        raise UnauthorizedError("无效的访问凭证") from exc

    # 从解析出来的 payload 字典中提取 sub 字段（即 user_id）
    subject = payload.get("sub")

    # 最后一道防线：确保提取出来的 subject 确实是一个非空字符串
    if not isinstance(subject, str) or not subject:
        raise UnauthorizedError("无效的访问凭证")

    # 全部校验通过，返回真实的用户 ID
    return subject