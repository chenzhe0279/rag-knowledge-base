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

# jieba 默认把词典缓存写到系统临时目录（可能落到 C 盘）。
# 固定到 backend/.cache/jieba，保证生成文件都在 D 盘。
_CACHE_DIR = Path(__file__).resolve().parents[2] / ".cache" / "jieba"
_CACHE_DIR.mkdir(parents=True, exist_ok=True)
jieba.dt.tmp_dir = str(_CACHE_DIR)

# 英文 / 路径 / 型号：整体保留，避免 jieba 把 /api/documents/upload 切碎。
# 允许以 / 开头（接口路径常见），也允许中间出现 . / : - _。
_PIECE_RE = re.compile(r"[/A-Za-z][A-Za-z0-9_./:-]*|[\u4e00-\u9fff]+|\d+")

# 只过滤高频虚词；不要过滤“规定 / 时限 / 制度”这类实词，也不要过滤数字。
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
_USERDICT = Path(__file__).with_name("userdict.txt")
if _USERDICT.exists():
    jieba.load_userdict(str(_USERDICT))


def _iter_pieces(text: str):
    """按“英文/路径、中文、数字”三类切段，保持原文顺序。"""
    pos = 0
    for m in _PIECE_RE.finditer(text):
        if m.start() > pos:
            yield "other", text[pos:m.start()]

        piece = m.group(0)
        if piece.isdigit():
            yield "num", piece
        elif piece[0].isascii():
            yield "latin", piece
        else:
            yield "han", piece

        pos = m.end()

    if pos < len(text):
        yield "other", text[pos:]


def segment(text: str, *, for_query: bool = False) -> str:
    """把原文切成“空格分隔”的词串。

    - 索引侧 for_query=False：jieba.cut，token 少、索引小；
    - 查询侧 for_query=True：jieba.cut_for_search，多出重叠词，召回更广。
    """
    tokens: list[str] = []

    for kind, piece in _iter_pieces(text):
        if kind == "latin":
            tokens.append(piece.lower())
        elif kind == "num":
            tokens.append(piece)
        elif kind == "han":
            cutter = jieba.cut_for_search(piece) if for_query else jieba.cut(piece)
            tokens.extend(t for t in cutter if t.strip() and t not in _STOPWORDS)

    return " ".join(tokens)


def build_tsquery(query: str) -> str:
    """把用户 query 变成 websearch_to_tsquery 能吃的 OR 表达式。

    用 OR 而不是 AND 的原因：
    - 中文 query 分词后 token 多，AND 要求每个词都命中，长 query 很容易 0 召回；
    - 教程里的 zhparser 靠词性过滤把虚词丢掉，所以能用 plainto_tsquery（AND）；
      我们没有词性过滤，必须放宽；
    - RRF 只看排名，OR 带来的低相关结果会被低排名稀释；拒答仍看向量分。
    """
    tokens = [t for t in segment(query, for_query=True).split() if t]
    if not tokens:
        return ""

    # 用双引号包住每个 token，避免 websearch 把 - / : 等当成语法符号。
    return " or ".join(f'"{t}"' for t in tokens)
