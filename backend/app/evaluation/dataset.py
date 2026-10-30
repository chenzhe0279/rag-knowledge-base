import json
from dataclasses import dataclass
from pathlib import Path

from app.core.exceptions import NotFoundError, ValidationError

# 动态获取当前文件所在目录，并在其下面拼接 "datasets" 文件夹路径
# 用于定位存放本地评测集文件（如 jsonl 文件）的根目录
DATASETS_DIR = Path(__file__).resolve().parent / "datasets"


@dataclass(frozen=True)
class EvaluationCase:
    """单条评测样本。

    expected_keywords 与 expected_document_names 配合做"引用命中率"判定：
    - 命中文档名 -> 视为引用命中
    - 命中任一关键词（在 actual citations 的 quote 拼接里）-> 视为引用命中
    """

    # 样本的唯一标识符（例如题号）
    case_id: str
    # 用户提问内容
    question: str
    # 期望的标准答案（用于 RAGAS 的 reference，计算准确率和召回率）
    expected_answer: str
    # 期望命中的文档名称列表（如果系统引用的文档名在这个列表里，算作命中）
    expected_document_names: list[str]
    # 期望包含的关键词列表（如果系统引用的原文内容里包含这些词，算作命中）
    expected_keywords: list[str]
    # 这道题是否应该被系统拒答（用于测试系统的安全性与边界）
    should_refuse: bool
    # 标签（用于后续按维度汇总统计，例如 ["财务", "多跳推理"]）
    tags: list[str]


def list_datasets() -> list[tuple[str, int]]:
    """枚举 datasets/ 下所有 jsonl，返回 (name, size) 二元组列表。"""
    # 1. 防御性检查：如果 datasets 目录都不存在，直接返回空列表
    if not DATASETS_DIR.exists():
        return []

    results: list[tuple[str, int]] = []

    # 2. 遍历目录下所有 .jsonl 后缀的文件，并使用 sorted 保证每次返回的顺序一致
    for path in sorted(DATASETS_DIR.glob("*.jsonl")):
        # 3. 打开文件（指定 utf-8 编码防乱码）
        with path.open("r", encoding="utf-8") as f:
            # 4. 统计有效行数：遍历每一行，如果 strip() 后不为空，说明是一条有效数据，count 累加 1
            count = sum(1 for line in f if line.strip())

        # 5. 将 (去掉后缀的文件名, 有效行数) 作为元组存入结果列表
        results.append((path.stem, count))
    return results


def load_dataset(name: str) -> list[EvaluationCase]:
    """根据数据集名称，加载并解析出所有的单条评测样本。"""
    # 1. 拼接出完整的文件路径 (例如：datasets/test_data.jsonl)
    path = DATASETS_DIR / f"{name}.jsonl"

    # 2. 如果文件不存在，直接抛出 404 业务异常
    if not path.exists():
        raise NotFoundError(f"评测集不存在: {name}")

    cases: list[EvaluationCase] = []

    # 3. 打开文件，使用 enumerate 从 1 开始记录行号，方便后续报错定位
    with path.open("r", encoding="utf-8") as f:
        for line_no, raw in enumerate(f, start=1):
            # 去除首尾空白字符
            line = raw.strip()
            # 跳过空行
            if not line:
                continue

            try:
                # 4. 尝试将这一行 JSON 字符串解析为 Python 字典
                data = json.loads(line)
            except json.JSONDecodeError as exc:
                # 5. 如果 JSON 格式写错了，捕获异常，并抛出带有“文件名”和“具体行号”的 ValidationError，方便用户修改测试集
                raise ValidationError(
                    f"评测集 {name} 第 {line_no} 行 JSON 非法: {exc.msg}"
                ) from exc

            # 6. 将解析出来的字典，转换成强类型的 EvaluationCase 数据类对象，并追加到列表中
            cases.append(_parse_case(data, line_no=line_no, dataset=name))

    return cases


def _parse_case(data: dict, *, line_no: int, dataset: str) -> EvaluationCase:
    """解析单条 JSON 数据，转换为 EvaluationCase 对象。

    - line_no 和 dataset 用于在报错时精准定位是哪个文件的哪一行出了问题。
    """
    try:
        # 尝试实例化 EvaluationCase 数据类
        return EvaluationCase(
            # 【必填字段】直接使用 data["key"] 读取。如果 JSON 里缺了这个字段，会抛出 KeyError
            case_id=str(data["id"]),
            question=str(data["question"]),

            # 【可选字段】使用 data.get("key", 默认值) 读取。如果没填，就用默认值，不会报错
            # 强制转为字符串，防止用户在 jsonl 里填了数字或 null 导致类型错误
            expected_answer=str(data.get("expected_answer", "")),

            # 【防坑技巧】data.get() 如果取不到值，默认返回 None。
            # 如果写成 list(None) 会直接报错崩溃。
            # 所以这里用了 `or []`：如果取出来是 None（假值），就变成 list([])，从而安全地转为空列表。
            expected_document_names=list(data.get("expected_document_names") or []),
            expected_keywords=list(data.get("expected_keywords") or []),

            # 强制转为布尔值，默认 False
            should_refuse=bool(data.get("should_refuse", False)),

            # 同样使用 `or []` 防 None 报错
            tags=list(data.get("tags") or []),
        )

    except KeyError as exc:
        # 捕获 KeyError（即必填字段缺失，比如 JSON 里没写 "id" 或 "question"）
        # exc.args[0] 会获取缺失的那个具体字段名（比如 'id'）
        raise ValidationError(
            f"评测集 {dataset} 第 {line_no} 行缺失字段: {exc.args[0]}"
        ) from exc