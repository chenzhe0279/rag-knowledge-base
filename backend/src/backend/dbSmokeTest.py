"""
数据库连通性冒烟测试 —— 使用项目自己的 settings 与 SQLAlchemy async 引擎。

验证：backend/app/core/config.py 读到的 DATABASE_URL 能否连上本地
PostgreSQL 18.6 + pgvector 0.8.7，并完成建表 / 写入向量 / 相似度检索 / 建 HNSW 索引。

运行（在 backend 目录下）：
    uv run python src/backend/dbSmokeTest.py

关键写法提醒（实战踩坑总结）：
    1) 原生 asyncpg        -> 用 $1::vector，向量传字符串 "[1,2,3]"
    2) SQLAlchemy text()   -> 用 cast(:p as vector)
                              绝不能写 :p::vector，参数解析器会把 ":p:" 当占位符，
                              导致参数绑定错乱（参数只绑一半 / ProgrammingError）
    3) SQLAlchemy 没有原生 vector 类型，向量列靠 raw SQL 或自定义 TypeDecorator
"""

import asyncio
import sys
from pathlib import Path

# 脚本位于 backend/src/backend/，把 backend/ 加入 sys.path 才能 import app.core.config
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import create_async_engine  # noqa: E402

from app.core.config import settings  # noqa: E402


async def main() -> None:
    url = settings.database_url
    print("=" * 58)
    print(" SQLAlchemy async 引擎连通性测试")
    print("=" * 58)
    print(f"[..] app_name     : {settings.app_name}")
    print(f"[..] DATABASE_URL : ***@{url.split('@')[-1]}")

    engine = create_async_engine(url, echo=False, pool_pre_ping=True)

    try:
        async with engine.connect() as conn:
            print("[OK] 连接成功")

            ver = (await conn.execute(text("select version()"))).scalar_one()
            print("[OK] 服务端      :", ver.split(" on ")[0])

            ext = (
                await conn.execute(
                    text("select extversion from pg_extension where extname='vector'")
                )
            ).scalar_one_or_none()
            print("[OK] pgvector    :", ext or "未安装")
            if not ext:
                raise SystemExit("[X] pgvector 未在 rag_kb 中启用")

            who = (
                await conn.execute(
                    text("select current_user || ' @ ' || current_database()")
                )
            ).scalar_one()
            print("[OK] 连接身份    :", who)

            await conn.execute(text("drop table if exists _smoke"))
            await conn.execute(
                text(
                    "create table _smoke (id bigserial primary key, "
                    "content text, emb vector(3))"
                )
            )
            print("[OK] 建表 _smoke (emb vector(3)) 成功")

            # 写入向量：SQLAlchemy 必须用 cast()，不能写 ::vector
            await conn.execute(
                text(
                    "insert into _smoke (content, emb) "
                    "values (:c, cast(:e as vector))"
                ),
                [
                    {"c": "apple", "e": "[1,2,3]"},
                    {"c": "banana", "e": "[4,5,6]"},
                ],
            )
            n = (await conn.execute(text("select count(*) from _smoke"))).scalar_one()
            print("[OK] 插入向量    :", n, "行")

            rows = (
                await conn.execute(
                    text(
                        "select content, "
                        "round((emb <-> cast(:q as vector))::numeric, 4) as d "
                        "from _smoke order by emb <-> cast(:q as vector) limit 3"
                    ),
                    {"q": "[1,2,4]"},
                )
            ).all()
            print("[OK] L2 检索结果 :")
            for c, d in rows:
                print(f"       {c:<8} 距离={d}")

            await conn.execute(
                text(
                    "create index _smoke_hnsw on _smoke "
                    "using hnsw (emb vector_cosine_ops)"
                )
            )
            print("[OK] HNSW 索引创建成功")

            await conn.execute(text("drop table _smoke"))
            await conn.commit()
            print("[OK] 测试表已清理")

    finally:
        await engine.dispose()

    print("=" * 58)
    print(" 冒烟测试通过 —— SQLAlchemy async + asyncpg + pgvector 全链路正常")
    print("=" * 58)


if __name__ == "__main__":
    asyncio.run(main())