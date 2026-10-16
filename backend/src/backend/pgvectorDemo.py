"""
pgvector 连通性验证 —— asyncpg 版（匹配本项目技术栈）

为什么用 asyncpg 而不是 psycopg：
    backend/pyproject.toml 声明的依赖是 asyncpg + sqlalchemy[asyncio]，
    .env 里的 DATABASE_URL 也是 postgresql+asyncpg://。
    教程里的 psycopg 写法与 asyncpg 不通用，混用会报 No module named 'psycopg'。

运行方式（在 backend 目录下）：
    uv run python src/backend/pgvectorDemo.py
或在 PyCharm 里右键直接 Run。

依赖：只用 asyncpg，无需额外安装任何包。
连接信息从项目根目录的 .env 读取（与后端共用同一份配置）。
"""

import asyncio
import sys
from pathlib import Path

import asyncpg
from sqlalchemy.engine import make_url

# 脚本位于 backend/src/backend/，把 backend/ 加入 sys.path 才能 import app.core.config
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.core.config import settings  # noqa: E402


def asyncpg_dsn() -> str:
    """把 .env 里的 postgresql+asyncpg:// 连接串转成 asyncpg 能直接用的 DSN。

    这样改 .env 里的密码/端口后，本脚本自动跟随，不会再出现配置脱节。
    """
    url = make_url(settings.database_url)
    return url.set(drivername="postgresql").render_as_string(hide_password=False)


DSN = asyncpg_dsn()


async def main() -> None:
    print("=" * 58)
    print(" pgvector 连通性验证 (asyncpg)")
    print("=" * 58)

    # ---------- 1. 连接 ----------
    conn = await asyncpg.connect(DSN)
    print("[OK] 已连接:", DSN)

    # ---------- 2. 环境信息 ----------
    ver = await conn.fetchval("select version()")
    print("[OK] 服务端:", ver.split(" on ")[0])

    ext = await conn.fetchval("select extversion from pg_extension where extname='vector'")
    print("[OK] pgvector 版本:", ext)
    if not ext:
        raise SystemExit("[X] pgvector 扩展未安装")

    who = await conn.fetchrow("select current_user, current_database()")
    print(f"[OK] 当前身份: {who[0]} @ {who[1]}")

    # ---------- 3. 建表 ----------
    await conn.execute("drop table if exists demo")
    await conn.execute(
        "create table demo (id bigserial primary key, content text, emb vector(3))"
    )
    print("[OK] 建表 demo (emb vector(3))")

    # ---------- 4. 写入向量 ----------
    # 关键点：asyncpg 不像 psycopg 那样自动适配，必须用 $n::vector 显式转换，
    # 并把向量写成 '[1,2,3]' 这样的字符串。
    rows = [
        ("apple", "[1,2,3]"),
        ("banana", "[4,5,6]"),
        ("cherry", "[7,8,9]"),
        ("dark", "[10,11,12]"),
    ]
    await conn.executemany(
        "insert into demo (content, emb) values ($1, $2::vector)", rows
    )
    print("[OK] 写入向量:", await conn.fetchval("select count(*) from demo"), "行")

    # ---------- 5. L2 距离检索 (<->) ----------
    print("[OK] 以 [1,2,4] 查询最近邻 (L2 距离 <->):")
    hit = await conn.fetch(
        "select id, content, round((emb <-> $1::vector)::numeric, 4) as dist "
        "from demo order by emb <-> $1::vector limit 3",
        "[1,2,4]",
    )
    for i, r in enumerate(hit, 1):
        print(f"       {i}. id={r['id']}  {r['content']:<8} 距离={r['dist']}")

    # ---------- 6. 余弦距离检索 (<=>) ----------
    print("[OK] 余弦距离 (<=>) 排序:")
    hit2 = await conn.fetch(
        "select content, round((emb <=> $1::vector)::numeric, 4) as cos "
        "from demo order by emb <=> $1::vector limit 3",
        "[1,2,3]",
    )
    for r in hit2:
        print(f"       {r['content']:<8} cosine_dist={r['cos']}")

    # ---------- 7. HNSW 索引（RAG 检索性能关键）----------
    await conn.execute(
        "create index demo_hnsw on demo using hnsw (emb vector_cosine_ops)"
    )
    idx = await conn.fetchval(
        "select indexdef from pg_indexes where tablename='demo' and indexname='demo_hnsw'"
    )
    print("[OK] HNSW 索引:", idx)

    # ---------- 8. 清理 ----------
    await conn.execute("drop table demo")
    left = await conn.fetchval("select count(*) from pg_tables where tablename='demo'")
    print("[OK] 清理完成, 残留表 =", left)

    await conn.close()
    print("=" * 58)
    print(" 全部通过 —— 后端可以正常使用 pgvector")
    print("=" * 58)


if __name__ == "__main__":
    asyncio.run(main())
