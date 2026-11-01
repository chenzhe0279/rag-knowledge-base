import asyncio
import warnings
from dataclasses import dataclass

# ragas 0.4 把 metrics import 路径迁到 collections，但小写实例 API 在 v1.0 前都可用；
# 这里集中静默 DeprecationWarning，避免污染日志，等 ragas 1.0 发布后再升级
warnings.filterwarnings("ignore", category=DeprecationWarning, module="ragas")

from ragas import evaluate  # noqa: E402
from ragas.dataset_schema import EvaluationDataset, SingleTurnSample  # noqa: E402
from ragas.metrics import (  # noqa: E402
    answer_relevancy,
    context_precision,
    context_recall,
    faithfulness,
)

from app.core.logger import get_logger  # noqa: E402
from app.ingestion.embedder import get_embeddings  # noqa: E402
from app.llm.models import get_chat_model  # noqa: E402

# 初始化日志记录器
logger = get_logger(__name__)


@dataclass(frozen=True)
class RagasMetrics:
    """单条 case 的 RAGAS 4 指标结果，全部 [0, 1] ∪ {None}。

    None 表示 RAGAS 本次未能算出该指标（异常 / 缺关键输入），下游按缺失处理。
    """

    # 忠实度：回答是否完全基于检索内容，无幻觉
    faithfulness: float | None

    # 答案相关性：回答是否切题
    answer_relevancy: float | None

    # 上下文精确率：检索到的内容中有多少是有用的
    context_precision: float | None

    # 上下文召回率：有用的内容是否都被检索出来了
    context_recall: float | None


@dataclass(frozen=True)
class RagasSample:
    """喂给 evaluate 的单条样本。"""

    # 用户的提问
    question: str

    # 系统实际生成的回答
    answer: str

    # 系统实际检索到的上下文片段列表
    retrieved_contexts: list[str]

    # 标准参考答答案（ground_truth / reference）
    reference_answer: str


# 定义需要 RAGAS 评估的指标列表
# 这些变量是从前面导入的 metrics 模块中取出的实例
_METRICS = [faithfulness, answer_relevancy, context_precision, context_recall]



# =====================================================================
# 方法作用：批量进行 RAGAS 评测（“阅卷流水线”）。
# 它接收一批系统的真实回答样本，将其转换为 RAGAS 框架需要的格式，
# 然后丢到后台线程中调用大模型进行打分，最后把结果清洗好返回。
# 它拥有极强的容错性，即使整批评测崩溃，也会返回空占位符，绝不拖垮主业务。
# =====================================================================
async def evaluate_batch(samples: list[RagasSample]) -> list[RagasMetrics]:
    """对一批样本算 RAGAS 指标，返回长度与 samples 一致的指标列表。

    任一条样本因为字段缺失（空 retrieved_contexts / 空 reference）会被 RAGAS
    某些指标判 NaN，这里统一转 None；整批异常时全部样本返回 None 占位。
    """
    # 防御性判断：如果没有传入任何样本，直接返回空列表
    if not samples:
        return []

    # 【数据转换】把我们内部定义的 RagasSample 列表，转换为 RAGAS 官方要求的数据集格式
    dataset = EvaluationDataset(
        samples=[
            SingleTurnSample(
                # 用户的提问
                user_input=s.question,
                # 系统生成的回答（如果为空，用空格占位，防止底层报错）
                response=s.answer or " ",
                # 检索到的上下文列表（如果为空，给个包含空格的列表兜底）
                retrieved_contexts=s.retrieved_contexts or [" "],
                # 标准参考答案（同样做空值兜底）
                reference=s.reference_answer or " ",
            )
            for s in samples
        ]
    )

    # 【核心计算】使用 try-except 包裹整个评测过程
    try:
        # 使用 asyncio.to_thread 将同步的 evaluate 函数丢到后台线程池中运行。
        # 原因：evaluate 内部会进行大量同步的网络请求（调用大模型），如果不放线程里，会卡死整个异步主程序。
        result = await asyncio.to_thread(
            evaluate,
            dataset=dataset,
            metrics=_METRICS,
            # 传入我们自己系统配置的大模型和 Embedding 模型，RAGAS 用它们来当裁判
            llm=get_chat_model(),
            embeddings=get_embeddings(),
            # 告诉 RAGAS：计算单条样本如果报错，不要抛出异常中断整批评测，跳过它继续算后面的。
            raise_exceptions=False,
            # 关闭进度条打印，保持后台日志干净
            show_progress=False,
        )
    except Exception:
        # 【终极兜底】如果发生了不可抗力的整批崩溃（比如大模型服务完全宕机），
        # 记录日志，并返回一个长度与样本数一致的“空指标”列表，保证外层调用方不会因为拿到 None 而报错。
        logger.exception("RAGAS evaluate 整批失败，返回 None 占位")
        return [_empty_metrics() for _ in samples]

    # 【结果清洗】将 RAGAS 返回的原始结果，提取并转换为我们的 RagasMetrics 对象列表
    return _extract_metrics(result, expected=len(samples))


# =====================================================================
# 方法作用：结果提取与清洗（宏观）。
# 把 RAGAS 框架返回的原始杂乱结果，提取并转换为项目内部定义的强类型对象列表。
# 同时处理“实际返回条数”与“期望条数”不一致的异常情况，保证数据长度对齐。
# =====================================================================
def _extract_metrics(result, expected: int) -> list[RagasMetrics]:
    # 尝试从 result 对象中获取 "scores" 属性。如果 result 结构不对或没有这个属性，返回空列表 [] 兜底
    rows = getattr(result, "scores", None) or []

    # 如果框架实际返回的行数，跟我们期望的样本数对不上（通常因为部分样本计算崩溃被丢弃）
    if len(rows) != expected:
        # 记录一条警告日志，方便开发人员事后排查
        logger.warning(
            "RAGAS 返回行数 %d 与样本数 %d 不一致，按可用值对齐", len(rows), expected
        )

    # 初始化最终结果列表
    metrics: list[RagasMetrics] = []

    # 无论实际返回多少行，我们都严格按照“期望的数量”去循环，保证最终列表长度绝对一致
    for i in range(expected):
        # 判断：当前的索引 i 是否小于实际返回的行数
        if i < len(rows):
            # 如果没越界，正常把这一行的数据取出来
            row = rows[i]
        else:
            # 如果越界了（说明 RAGAS 少算了/漏返回了数据），给个空字典作为占位符
            row = {}

        # 组装强类型的 RagasMetrics 数据对象
        metrics.append(
            RagasMetrics(
                # 调用 _pick 方法，安全地从字典里抠出对应的分数，如果出问题会自动转为 None
                faithfulness=_pick(row, "faithfulness"),
                answer_relevancy=_pick(row, "answer_relevancy"),
                context_precision=_pick(row, "context_precision"),
                context_recall=_pick(row, "context_recall"),
            )
        )
    return metrics


# =====================================================================
# 方法作用：单指标安全提取（微观）。
# 从一行结果字典中，安全地提取出一个浮点数（Float）分数。
# 极其强大的防御性编程：将 None、缺失、报错、NaN 统一处理为 None。
# =====================================================================
def _pick(row: dict, key: str) -> float | None:
    """从 RAGAS 结果行里取分数：NaN / 缺失 / 非数值都视为 None。"""
    # 使用 .get 安全获取，如果字典里没这个键，返回 None
    value = row.get(key)

    # 如果是 None，直接返回 None
    if value is None:
        return None

    try:
        # 尝试将其强行转换为浮点数（因为大模型框架有时会把数字当字符串返回，如 "0.85"）
        as_float = float(value)
    except (TypeError, ValueError):
        # 如果转换失败（比如传过来的是个列表 [] 或者是字母 "abc"），捕获异常并返回 None
        return None

    # 判断 NaN（Not a Number）：这是 Python 里的一个著名“黑客技巧”。
    # 在 IEEE 754 浮点数规范中，NaN 不等于任何数，甚至不等于它自己（NaN != NaN 永远为 True）。
    # 如果 RAGAS 因为缺少上下文等原因算出了 NaN，这里直接拦下，返回 None。
    if as_float != as_float:  # NaN
        return None

    # 一切正常，返回干净的浮点数
    return as_float



# =====================================================================
# 方法作用：生成一个空的指标占位对象（全为 None）。
# 用于在评测发生异常、或者某条样本没算出分数时，提供统一的安全默认值，
# 防止因缺少数据导致后续存数据库或前端渲染时报错。
# =====================================================================
def _empty_metrics() -> RagasMetrics:
    # 直接实例化 RagasMetrics 数据类，并将四个核心指标全部显式赋值为 None
    return RagasMetrics(
        faithfulness=None,
        answer_relevancy=None,
        context_precision=None,
        context_recall=None,
    )