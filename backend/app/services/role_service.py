from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError, ValidationError, ConflictError
from app.db.models import Role
from app.db.repositories.role_repo import RoleRepository

# 内置角色：不允许删除，避免学员把 admin 删了登不进系统
# 使用 frozenset（不可变集合）而不是普通 set，防止在运行过程中被意外修改。
PROTECTED_ROLE_NAMES = frozenset({"admin", "user"})


# =====================================================================
# 类作用：角色服务层（RoleService）。
# 负责处理角色的业务逻辑，连接路由层和底层的数据库仓储层（Repository）。
# =====================================================================
class RoleService:
    # 初始化方法，注入数据库会话
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        # 实例化角色仓储层
        self.repo = RoleRepository(session)

    # =====================================================================
    # 方法作用：获取系统中所有角色的列表。
    # =====================================================================
    async def list_roles(self) -> list[Role]:
        # 直接透传调用仓储层的 list_all 方法
        return await self.repo.list_all()

    # =====================================================================
    # 方法作用：根据角色 ID 获取单个角色的详细信息。
    # =====================================================================
    async def get_role(self, role_id: UUID) -> Role:
        # 去数据库查询角色
        role = await self.repo.get_by_id(role_id)

        # 如果查不到（返回 None），抛出 404 业务异常
        if role is None:
            raise NotFoundError("角色不存在")

        # 返回查到的角色对象
        return role

    # =====================================================================
    # 方法作用：创建一个新角色。
    # =====================================================================
    async def create_role(self, *, name: str, description: str, permission_tags: list[str],) -> Role:
        # 去除角色名首尾的空格，防止用户故意敲空格绕过重名校验
        name = name.strip()

        # 校验：角色名不能是空字符串
        if not name:
            raise ValidationError("角色名不能为空")

        # 校验：去数据库查一下这个名字是不是已经被占用了
        if await self.repo.get_by_name(name) is not None:
            # 如果存在，抛出 409 资源冲突异常
            raise ConflictError(f"角色 {name} 已存在")

        # 实例化角色对象
        role = Role(
            name=name,
            # 描述也去除首尾空格
            description=description.strip(),
            # 调用内部辅助函数 _normalize_tags 对权限标签进行清洗（如去重、排序等）
            permission_tags=_normalize_tags(permission_tags),
        )

        # 保存到数据库
        await self.repo.add(role)
        # 提交事务，真正落盘
        await self.session.commit()
        return role

    # =====================================================================
    # 方法作用：更新（修改）角色信息。
    # 采用“部分更新”策略，只修改传入了非 None 的字段。
    # =====================================================================
    async def update_role(self, role_id: UUID, *, description: str | None = None, permission_tags: list[str] | None = None,) -> Role:
        # 先获取角色（如果不存在，get_role 内部会抛 404 异常）
        role = await self.get_role(role_id)

        # name 故意不允许改：避免权限策略代码里写死的角色名（"admin"）失效
        # 比如你的代码里写了 if role.name == "admin"，如果允许用户随便改名，这段代码就废了

        # 如果前端传了描述，且不是 None（代表用户确实想改描述）
        if description is not None:
            role.description = description.strip()

        # 如果前端传了权限标签，且不是 None
        if permission_tags is not None:
            # 同样进行清洗后赋值
            role.permission_tags = _normalize_tags(permission_tags)

        # 提交事务更新到数据库
        await self.session.commit()
        return role

    # =====================================================================
    # 方法作用：根据 ID 删除角色。
    # =====================================================================
    async def delete_role(self, role_id: UUID) -> None:
        # 先获取角色对象
        role = await self.get_role(role_id)

        # 检查该角色是否属于系统内置的保护角色（也就是我们上一张图看到的 "admin" 和 "user"）
        if role.name in PROTECTED_ROLE_NAMES:
            # 如果是，直接拦截并抛出 400 校验异常，禁止删除
            raise ValidationError(f"内置角色 {role.name} 不允许删除")

        # 如果不是保护角色，执行删除
        await self.repo.delete(role)
        # 提交事务，真正从数据库抹除
        await self.session.commit()


# =====================================================================
# 函数作用：清洗并标准化权限标签列表。
# 比如：把 [" 财务", "财务 ", "  ", "人事"] 变成 ["财务", "人事"]。
# =====================================================================
def _normalize_tags(tags: list[str]) -> list[str]:
    """去空白、去空串、去重、保持稳定顺序。"""

    # 1. 准备一个集合（Set），用于快速判断某个标签是否已经出现过。
    # 集合的查找时间复杂度是 O(1)，比用列表做 in 判断（O(n)）快得多。
    seen: set[str] = set()

    # 2. 准备一个列表（List），用来存放最终清洗好的结果，保持原本的输入顺序。
    result: list[str] = []

    # 3. 遍历传入的原始标签列表
    for tag in tags:
        # 去除标签首尾的空格、换行符等不可见字符
        t = tag.strip()

        # 4. 【核心过滤】
        # not t：如果去掉空格后变成空字符串，说明是脏数据，跳过。
        # t in seen：如果这个标签之前已经处理过了，说明是重复的，跳过。
        if not t or t in seen:
            continue

        # 5. 记录到已存在的集合中
        seen.add(t)

        # 6. 追加到最终的结果列表中
        result.append(t)

    # 7. 返回清洗干净的列表
    return result