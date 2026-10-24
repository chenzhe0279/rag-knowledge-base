"""中文分词器：jieba 预分词，供 PostgreSQL simple 全文检索使用。

为什么需要它：
- PostgreSQL 原生没有中文分词，to_tsvector('simple', '差旅报销制度')
  会把整串当成一个 token；
- 这里先把中文切成词、用空格连接，再交给 PG 的 simple 配置，
  PG 就能按词建 tsvector / GIN 索引。

索引侧和查询侧必须使用同一套规则，否则会出现“索引里有、查询匹配不上”。
"""

import re
from pathlib import Path

import jieba

# jieba 默认把词典缓存写到系统临时目录
# 解释：__file__ 是当前文件路径，resolve() 转绝对路径，parents[2] 向上找两级（假设当前在 backend/app/utils/ 下，向上两级刚好是 backend/ 目录）。
_CACHE_DIR = Path(__file__).resolve().parents[2] / ".cache" / "jieba"

# 确保这个缓存目录存在。parents=True 表示父目录如果不存在也一并创建，exist_ok=True 表示如果已存在不报错。
_CACHE_DIR.mkdir(parents=True, exist_ok=True)

# 覆盖 jieba 内部的临时目录属性，强行让它把生成的缓存文件放进我们指定的目录中。
jieba.dt.tmp_dir = str(_CACHE_DIR)

# 英文 / 路径 / 型号：整体保留，避免 jieba 把 /api/documents/upload 切碎。
# 允许以 / 开头（接口路径常见），也允许中间出现 . / : - _。
# 解释正则：匹配三种情况之一，用 | 隔开。
# 1. [/A-Za-z][A-Za-z0-9_./:-]* ：匹配英文单词或路径（允许以 / 或字母开头，后面跟字母数字或符号）。
# 2. [\u4e00-\u9fff]+ ：匹配连续的中文字符。
# 3. \d+ ：匹配连续的数字。
_PIECE_RE = re.compile(r"[/A-Za-z][A-Za-z0-9_./:-]*|[\u4e00-\u9fff]+|\d+")

# 只过滤高频虚词；不要过滤“规定 / 时限 / 制度”这类实词，也不要过滤数字。
# 解释：使用 frozenset 而不是普通 set，因为 frozenset 是不可变集合，作为全局变量更安全，且查找速度极快。
_STOPWORDS = frozenset(
    {
        "的", "了", "是", "在", "和", "与", "及", "或", "而", "被", "把",
        "对", "从", "到", "为", "以", "于", "中", "上", "下", "什么",
        "多少", "怎么", "如何", "吗", "呢", "啊", "呀", "这", "那", "其",
        "之", "第", "条", "款", "项",
    }
)

# 可选：把业务专有名词（制度名、接口名、产品名）放进 userdict.txt，
# jieba 就不会把它们切碎。文件不存在时跳过，不影响启动。
# 解释：with_name 保证去当前同级目录下找 userdict.txt。
_USERDICT = Path(__file__).with_name("userdict.txt")

# 如果这个自定义词典文件真实存在，就让 jieba 加载它，提高分词的准确性。
if _USERDICT.exists():
    jieba.load_userdict(str(_USERDICT))


# 定义内部生成器函数：按“英文/路径、中文、数字”三类切段，保持原文顺序。
def _iter_pieces(text: str):
    """按“英文/路径、中文、数字”三类切段，保持原文顺序。"""
    # pos 用于记录上一次匹配结束的位置，用来处理那些没有被正则匹配到的字符（比如标点符号）。
    pos = 0

    # 遍历正则表达式在字符串中找到的所有匹配项
    for m in _PIECE_RE.finditer(text):
        # 如果当前匹配的起始位置大于上一次的结束位置，说明中间有没被匹配的字符（如空格、逗号等）
        if m.start() > pos:
            # 把这些无关字符作为 "other" 类型产出（后续可能会被丢弃，但保证了原文本顺序不乱）
            yield "other", text[pos:m.start()]

        # 获取当前匹配到的具体字符串片段
        piece = m.group(0)

        # 判断这个片段的类型
        if piece.isdigit():
            yield "num", piece  # 如果是纯数字，标记为 "num"
        elif piece[0].isascii():
            yield "latin", piece  # 如果以 ASCII 字符开头，标记为 "latin"（英文或路径）
        else:
            yield "han", piece  # 否则标记为 "han"（中文）

        # 更新 pos 为当前匹配的结束位置
        pos = m.end()

    # 循环结束后，如果文本末尾还有剩余的字符没被匹配，把它们作为 "other" 产出
    if pos < len(text):
        yield "other", text[pos:]


# 定义对外暴露的核心分词函数：把原文切成“空格分隔”的词串，供数据库全文检索使用。
def segment(text: str, *, for_query: bool = False) -> str:
    """把原文切成“空格分隔”的词串。

    - 索引侧 for_query=False：jieba.cut，token 少、索引小；
    - 查询侧 for_query=True：jieba.cut_for_search，多出重叠词，召回更广。
    """
    # 准备一个列表，用来装所有最终保留的 token
    tokens: list[str] = []

    # 遍历刚才切好的三类片段
    for kind, piece in _iter_pieces(text):
        # 如果是英文或路径
        if kind == "latin":
            # 转成小写（统一格式，防止大小写导致检索失败），并加入列表
            tokens.append(piece.lower())

        # 如果是数字，原样加入列表
        elif kind == "num":
            tokens.append(piece)

        # 如果是中文片段
        elif kind == "han":
            # 判断当前是不是在“查询”阶段
            if for_query:
                # 如果是查询阶段，使用搜索模式的分词（切得更细）
                cutter = jieba.cut_for_search(piece)
            else:
                # 如果是建立索引阶段，使用标准模式的分词（保持词义完整）
                cutter = jieba.cut(piece)

            # 1. 遍历分词器（cutter）切出来的每一个词（t）
            for t in cutter:
                # 2. 过滤条件 A：如果去掉两边的空格后，不是一个空字符串（防止 jieba 切出无意义的空白）
                if t.strip():
                    # 3. 过滤条件 B：如果这个词不在我们定义的停用词字典（_STOPWORDS）里
                    if t not in _STOPWORDS:
                        # 4. 符合条件，把词加入结果列表
                        tokens.append(t)

    # 最后用空格把所有的词拼接成一个长字符串返回
    return " ".join(tokens)


# 定义函数：把用户的提问转化为 PostgreSQL 全文检索能识别的 OR 表达式。
def build_tsquery(query: str) -> str:
    """把用户 query 变成 websearch_to_tsquery 能吃的 OR 表达式。

    用 OR 而不是 AND 的原因：
    - 中文 query 分词后 token 多，AND 要求每个词都命中，长 query 很容易 0 召回；
    - RRF 只看排名，OR 带来的低相关结果会被低排名稀释；拒答仍看向量分。
    """
    # 1. 先调用 segment 函数对 query 进行分词。
    # for_query=True 代表使用细粒度分词模式。它会返回一个用空格拼接的字符串，比如："差旅 报销 标准"
    segmented_str = segment(query, for_query=True)

    # 2. 用 .split() 把这个长字符串按空格切开，变成一个列表。比如：["差旅", "报销", "标准"]
    raw_list = segmented_str.split()

    # 3. 准备一个空列表，用来装清洗后的词
    tokens = []

    # 4. 遍历刚才切出来的列表
    for t in raw_list:
        # 5. 如果这个词不是空字符串（防御性过滤）
        if t:
            # 6. 加入最终列表
            tokens.append(t)

    # 如果切完发现啥都没有，直接返回空字符串
    if not tokens:
        return ""

    # 1. 准备一个空列表，用来装加工后的词
    quoted_tokens = []

    # 2. 遍历刚才切出来的词（tokens = ["差旅", "报销", "标准"]）
    for t in tokens:
        # 3. 用双引号把每个词包起来，比如把 差旅 变成 "差旅"
        formatted_token = f'"{t}"'
        quoted_tokens.append(formatted_token)

    # 4. 用 " or " 把列表里所有的词连成一个长字符串
    # 当你的代码最终执行时，PostgreSQL 收到的检索指令相当于
    # SELECT * FROM document_chunks
    # WHERE content_tsv @@ websearch_to_tsquery('chinese_zh', '"差旅" or "报销" or "标准"');
    final_query = " or ".join(quoted_tokens)
    return final_query