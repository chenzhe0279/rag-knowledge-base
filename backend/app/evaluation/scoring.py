from dataclasses import dataclass
from typing import Literal

"""指标计算函数+Bad Case归因规则。"""

# Bad Case 归因类别。与 PRD「Bad Case 归因」12 类对齐。
# Literal 是 Python 的类型提示，表示这个变量的值只能从下面这几个字符串里选，写错一个字母 IDE 都会报错。
BadCaseCategory = Literal[
    # 文档解析失败（比如 PDF 转文本乱码）
    "document_parse_failed",
    # 文本切分不合理（把一句话切断了）
    "chunk_split_bad",
    # 向量检索没召回（语义没匹配上）
    "embedding_recall_miss",
    # 关键词检索没召回（字面没匹配上）
    "keyword_recall_miss",
    # 多路召回融合出错（RRF算法把好结果排低了）
    "rrf_fusion_error",
    # 精排（重排）阶段把正确的排到了后面
    "rerank_order_error",
    # 上下文判断过松（检索到了无关内容，但模型没识别出来）
    "context_judge_too_loose",
    # 上下文判断过严（检索到了有用内容，但被系统误判并拒绝了）
    "context_judge_too_strict",
    # 提示词约束太弱（模型没按要求格式输出，或没要求它拒答）
    "prompt_constraint_weak",
    # 生成脱离上下文（模型幻觉，没按检索到的内容回答）
    "generation_off_context",
    # 引用解析失败（前端解析 [1]、[2] 角标失败）
    "citation_parse_failed",
    # 权限过滤错误（该看的文档没搜出来，不该看的搜出来了）
    "permission_filter_error",
    # 其他未归类的问题
    "other",
]

# 指标低于此值视为"显著低"，触发对应归因。
_LOW_SCORE_THRESHOLD = 0.5


@dataclass(frozen=True)
class BadCaseRule:
    """一条规则归因结论。"""

    # 是否被判定为 Bad Case（True 代表出了问题）
    is_bad_case: bool

    # 归因类别（只能填入上面 Literal 定义的 12 种之一，或者 None 代表没有具体原因）
    category: BadCaseCategory | None


# =====================================================================
# 方法作用：计算“引用命中率”（Citation Hit）。
# 用于评估 RAG 系统生成的引用，是否真的找对了文档或包含了关键信息。
# 只要满足以下任一条件即视为“命中”：
# 1. 实际引用的文档名在期望的文档名列表中；
# 2. 期望的关键词出现在实际引用的原文（quote）拼接字符串中。
# =====================================================================
def compute_citation_hit(
        actual_citations: list[dict],
        expected_document_names: list[str],
        expected_keywords: list[str],
) -> bool:
    """引用命中率判定：

    1. 任一 citation 的 document_name 出现在 expected_document_names -> 命中
    2. 任一 expected_keyword 出现在 citations 的 quote 拼接里 -> 命中
    3. 否则未命中
    """
    # 如果系统根本没有生成任何引用，直接判定为未命中（False）
    if not actual_citations:
        return False

    # 提取所有实际引用的文档名称，并存入集合（Set）中。
    actual_doc_names = {c.get("document_name", "") for c in actual_citations}

    # 判断【规则1】：遍历期望命中的文档名，只要有一个出现在实际文档名集合中，就算命中。
    # 后面的 `if name` 是为了防止传入空字符串导致误判。
    if any(name in actual_doc_names for name in expected_document_names if name):
        return True

    # 如果配置了需要匹配的期望关键词
    if expected_keywords:
        # 把所有实际引用的原文提取出来，用换行符拼成一个巨大的字符串。
        quote_blob = "\n".join(str(c.get("quote", "")) for c in actual_citations)

        # 判断【规则2】：遍历期望的关键词，只要有一个出现在拼接好的原文大字符串中，就算命中。
        if any(kw in quote_blob for kw in expected_keywords if kw):
            return True

    # 如果以上规则都不满足，则最终判定为未命中（False）
    return False


# =====================================================================
# 方法作用：计算“拒答正确率”（Refusal Correctness）。
# 用于评估系统的安全防线是否精准。该拒答的时候拒了，或者不该拒答的时候正常回答了，都算正确。
# =====================================================================
def compute_refusal_correct(actual_refused: bool, should_refuse: bool) -> bool:
    """拒答正确率：实际拒答状态 == 期望。"""
    # 逻辑极其简单：实际是否拒答（True/False）与期望是否拒答一致，即算正确。
    return actual_refused == should_refuse


# =====================================================================
# 方法作用：Bad Case 自动归因（“错题本”的裁判员）。
# 当一个测试用例跑完后，这个方法会像医生问诊一样，按照从“硬伤”到“软伤”的顺序，
# 层层排查到底是系统哪个环节出了问题，并给出对应的错误分类（Category）。
# 如果所有指标都正常，则判定为“非 Bad Case”。
# =====================================================================
def classify_bad_case(
    *,
    should_refuse: bool,        # 测试集里这道题“应该”被拒答吗？
    actual_refused: bool,       # 系统实际“有没有”拒答？
    refusal_correct: bool,      # 拒答的逻辑对不对（该拒拒了，或不该拒没拒）？
    citation_hit: bool | None,  # 引用有没有命中期望的文档或关键词？（拒答题可能为 None）
    faithfulness: float | None, # RAGAS 评测指标：回答是否完全基于检索内容（无幻觉）
    answer_relevancy: float | None, # RAGAS 评测指标：回答是否切题（有没有答非所问）
    context_precision: float | None, # RAGAS 评测指标：检索到的内容中有多少是有用的（排序质量）
    context_recall: float | None, # RAGAS 评测指标：有用的内容是否都被检索出来了（召回质量）
    has_error: bool,            # 系统执行这道题时是否发生了代码报错/异常？
) -> BadCaseRule:
    """根据各种指标，对评测结果进行自动化 Bad Case 归因。

    规则的优先级是按「越底层的问题越优先归因」排的：拒答错误是最严重的；引用没命中是次严重；RAGAS 4 项按「召回 → 排序 → 生成 → 表达」的顺序兜底。
    注意 `permission_filter_error`、`keyword_recall_miss`、`rrf_fusion_error` 这些类别规则不会主动归因，留给前端人工归类用。
    比如 RRF 融合出错这种事，自动规则识别不了，得人工根据实际情况改。
    """

    # 【第 1 步：排雷】如果代码直接报错了，属于系统异常，直接归为 other 类
    if has_error:
        return BadCaseRule(is_bad_case=True, category="other")

    # 【第 2 步：查拒答】拒答错误的两种方向：该拒不拒 / 不该拒却拒了
    if not refusal_correct:
        # 如果该拒答但没拒答（系统判断太宽松，把不该答的答了）
        if should_refuse and not actual_refused:
            return BadCaseRule(is_bad_case=True, category="context_judge_too_loose")
        # 如果是不该拒答但拒答了（系统判断太严格，把该答的拦住了）
        return BadCaseRule(is_bad_case=True, category="context_judge_too_strict")

    # 【第 3 步：查引用】非拒答 case 才考察引用命中；拒答 case 的 citation_hit 本就 None
    # 如果明确没有命中引用，说明检索阶段没找到对的文档
    if citation_hit is False:
        return BadCaseRule(is_bad_case=True, category="embedding_recall_miss")

    # 【第 4 步：看指标】RAGAS 指标顺序：
    # 先看召回 (context_recall) -> 排序 (context_precision) ->
    # 生成忠实度 (faithfulness) -> 答案相关性 (answer_relevancy)

    # 如果召回率太低：说明压根没搜到相关的资料
    if _is_low(context_recall):
        return BadCaseRule(is_bad_case=True, category="embedding_recall_miss")

    # 如果精确率太低：说明搜到了一些资料，但有用的排在后面，被精排（rerank）搞砸了
    if _is_low(context_precision):
        return BadCaseRule(is_bad_case=True, category="rerank_order_error")

    # 如果忠实度太低：说明资料找对了，但大模型没有老老实实按资料回答，产生了幻觉
    if _is_low(faithfulness):
        return BadCaseRule(is_bad_case=True, category="generation_off_context")

    # 如果相关性太低：说明大模型虽然没幻觉，但答非所问，没有按提示词的约束来
    if _is_low(answer_relevancy):
        return BadCaseRule(is_bad_case=True, category="prompt_constraint_weak")

    # 【第 5 步：通关】所有检查都没问题，判定为非 Bad Case（完全正常）
    return BadCaseRule(is_bad_case=False, category=None)


# =====================================================================
# 方法作用：一个简单的工具函数，判断传入的分数是否低于设定的及格线。
# =====================================================================
def _is_low(score: float | None) -> bool:
    """判断指标得分是否低于及格线阈值。"""
    # 只有当分数存在（不为 None）且小于设定的阈值（0.5）时，才认为是“低分”
    return score is not None and score < _LOW_SCORE_THRESHOLD