from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

@dataclass(frozen=True)
class RetrievalFilter:
    """检索时的文档元数据过滤条件；空字段表示不限制。"""

    # 1. 文件类型过滤（如 .pdf, .docx）。
    # 使用 tuple（元组）而不是 list（列表），配合 frozen=True 实现真正的深度只读。
    # 默认值为空元组 ()，表示不限制任何文件类型。
    mime_types: tuple[str, ...] = ()

    # 2. 文档创建时间的起始边界。默认 None 表示不限制开始时间。
    created_from: datetime | None = None

    # 3. 文档创建时间的结束边界。默认 None 表示不限制结束时间。
    created_to: datetime | None = None

    # 4. 指定特定文档的 ID 列表（用于只在特定的几篇文档里搜索）。
    # 同样使用 tuple 保证不可变，默认空元组 () 表示不限制特定文档。
    document_ids: tuple[UUID, ...] = ()

    # 【核心新增特性】：使用 @property 将方法伪装成属性，调用时无需加括号（如 filter.is_empty）。
    @property
    def is_empty(self) -> bool:
        """
        判断当前过滤条件是否为空。
        如果用户什么都没选（所有字段都是空元组或 None），则返回 True，表示不需要加任何额外过滤条件。
        """
        # 使用了 Python 的 or 短路运算和 not 取反：
        # 如果 mime_types、created_from 等全都是空值（在 Python 中布尔值为 False），
        # 那么括号里的 or 表达式结果为 False，外层 not 得到 True。
        # 只要其中有任何一项有值（哪怕是 0 或空字符串之外的值），整体就返回 False。
        return not (
                self.mime_types
                or self.created_from
                or self.created_to
                or self.document_ids
        )