from pydantic import BaseModel, Field


# =====================================================================
# 类作用：创建角色（Role）的请求体模型。
# 用于接收前端传递过来的新建角色数据，并进行初步的格式校验。
# =====================================================================
class RoleCreate(BaseModel):
    # 角色名称：必填，限制长度在 1 到 64 个字符之间
    name: str = Field(min_length=1, max_length=64)

    # 角色描述：可选，默认值为空字符串 ""，最大长度限制为 256
    description: str = Field(default="", max_length=256)

    # 权限标签列表：可选，默认值为空列表。
    # 使用 default_factory=list 保证每次实例化时都生成全新的独立列表，避免多个实例共享同一个列表导致数据串号。
    permission_tags: list[str] = Field(default_factory=list)


# =====================================================================
# 类作用：更新角色信息（PATCH 请求）的请求体模型。
# 支持部分更新，前端只需传递需要修改的字段即可。
# =====================================================================
class RoleUpdate(BaseModel):
    """name 字段刻意不暴露：策略代码以角色名为锚（"admin"），不允许改名。"""

    # 角色描述：可选。如果不传（为 None），则保持数据库中的原值不变；如果传了，最大长度限制为 256
    description: str | None = Field(default=None, max_length=256)

    # 权限标签列表：可选。如果不传，则保持原值不变；如果传了，则用新列表整体替换旧的权限标签。
    # 注意：这里没有写 Field(default_factory=list)，因为这里默认值就是 None，代表“不修改”。
    permission_tags: list[str] | None = None