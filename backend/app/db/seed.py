from app.core.config import settings
from app.core.logger import get_logger
from app.core.security import hash_password
from app.db.models import Role, User, UserStatus
from app.db.repositories.role_repo import RoleRepository
from app.db.repositories.user_repo import UserRepository
from app.db.session import AsyncSessionLocal
from app.services.permission_service import WILDCARD_PERMISSION_TAG



# 获取当前模块专属的日志记录器
# 传入 __name__ 后，打印日志时会自动带上当前文件名
logger = get_logger(__name__)

# =====================================================================
# 常量定义：系统内置的默认角色配置。
# 这些数据会在系统首次启动（库里没有用户时）被写入数据库。
# =====================================================================
_BUILTIN_ROLES: list[dict] = [
    {
        "name": "admin",
        "description": "系统管理员",
        # 通配标签：检索 SQL 不附加权限过滤。也就是说，管理员可以看所有文档。
        "permission_tags": [WILDCARD_PERMISSION_TAG],
    },
    {
        "name": "user",
        "description": "普通用户",
        # 默认仅能访问 "public" 标签的文档；空 permission_tags 的存量文档也会被视为公开
        "permission_tags": ["public"],
    },
]


# =====================================================================
# 函数作用：初始化数据库的种子数据（Seed）。
# 仅在数据库完全为空（没有任何用户）时执行，自动创建内置角色和管理员账号，
# 防止系统刚部署时没有任何人能登录进去。
# =====================================================================
async def seed_default_admin() -> None:
    """库内无用户时建 admin 角色 + user 角色 + admin 用户（关联 admin 角色）。"""
    # 开启一个独立的数据库会话（因为这不是在处理 HTTP 请求，是在系统启动或后台脚本中运行）
    async with AsyncSessionLocal() as session:
        user_repo = UserRepository(session)

        # 【核心幂等逻辑】如果数据库里已经有用户了，说明系统已经初始化过了，直接退出即可。
        # 这样哪怕系统重启 100 次，也不会重复创建 admin 账号。
        if await user_repo.count_all() > 0:
            return

        # 记录日志，表明正在执行初始化
        logger.info("seeding default admin user and built-in roles")
        role_repo = RoleRepository(session)

        # 用一个字典记录已经创建或已经存在的角色，方便后面给 admin 绑定
        roles_by_name: dict[str, Role] = {}

        # 遍历刚才定义的内置角色列表
        for spec in _BUILTIN_ROLES:
            # 先查一下数据库里有没有这个角色（防止之前手动建了一半的情况）
            existing = await role_repo.get_by_name(spec["name"])

            if existing is not None:
                # 如果已经存在，直接存入字典，跳过本次循环，不重复创建
                roles_by_name[spec["name"]] = existing
                continue

            # 如果不存在，实例化新的角色对象
            role = Role(
                name=spec["name"],
                description=spec["description"],
                # 将元组转为列表，确保数据类型符合数据库模型的定义
                permission_tags=list(spec["permission_tags"]),
            )
            # 保存到数据库
            await role_repo.add(role)
            # 将新创建的角色存入字典
            roles_by_name[spec["name"]] = role

        # 创建超级管理员账号
        admin_user = User(
            # 从配置文件 settings 中读取账号（默认是 admin）
            username=settings.default_admin_username,
            # 从配置文件中读取明文密码，并立刻用 hash_password 转为哈希值存储
            password_hash=hash_password(settings.default_admin_password),
            display_name=settings.default_admin_display_name,
            status=UserStatus.ACTIVE,
        )

        # 给超级管理员绑定刚才拿到的 admin 角色
        admin_user.roles = [roles_by_name["admin"]]

        # 将管理员账号存入数据库
        await user_repo.add(admin_user)

        # 【最终提交】统一提交事务，将角色和管理员账号一起落盘
        await session.commit()