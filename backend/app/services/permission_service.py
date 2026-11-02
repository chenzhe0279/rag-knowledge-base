from app.db.models import User




# 通配权限标签：含义"无视权限过滤"，admin 默认持有
WILDCARD_PERMISSION_TAG = "*"

# 内置角色名
ADMIN_ROLE_NAME = "admin"


# =====================================================================
# 函数作用：合并用户所有角色的 permission_tags 并去重。
# 这是一个非常核心的权限计算函数，决定了用户到底能看到哪些文档。
# =====================================================================
def compute_user_permission_tags(user: User) -> list[str]:
    """合并用户所有角色的 permission_tags 并去重。

    - 任一角色持有 "*" -> 直接返回 ["*"]，下游 SQL 不加权限过滤
    - 多角色叠加用集合去重；顺序对检索逻辑无意义，但稳定排序便于 debug
    """
    # 1. 初始化一个空集合（Set）。
    # 用集合是为了自动去重：如果用户有两个角色，都有 "doc:read" 权限，集合里只会留一个。
    merged: set[str] = set()

    # 2. 遍历用户拥有的所有角色
    for role in user.roles:
        # 3. 遍历当前角色拥有的所有权限标签
        for tag in role.permission_tags:
            # 4. 【最高优先级拦截】如果这个角色带有通配符 "*"
            if tag == WILDCARD_PERMISSION_TAG:
                # 直接返回 ["*"]。只要有一处是通配，整个权限就是超级无敌的，不用往下算了（短路逻辑）
                return [WILDCARD_PERMISSION_TAG]
            # 5. 普通权限标签，加入到集合中
            merged.add(tag)

    # 6. 最后把集合转成列表，并做一次排序（sorted）。
    # 排序不是为了业务逻辑，而是为了每次打印出来的权限顺序一样，方便开发者排查 Bug。
    return sorted(merged)


# =====================================================================
# 函数作用：判断用户是否是超级管理员（admin）。
# =====================================================================
def is_admin(user: User) -> bool:
    """是否拥有 admin 角色（按角色名识别，不依赖通配标签，便于学员理解）。"""
    # 使用 any() 函数遍历用户的角色列表。
    # 只要用户的角色列表中有任意一个角色的 name 等于 "admin"，就返回 True。
    return any(role.name == ADMIN_ROLE_NAME for role in user.roles)