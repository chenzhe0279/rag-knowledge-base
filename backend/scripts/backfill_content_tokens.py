"""回填 document_chunks.content_tokens

用法（在 backend 目录下）：
    uv run python -m scripts.backfill_content_tokens

说明：
- 脚本会遍历所有 chunk，重新分词并写回 content_tokens；
- content_tsv 是生成列，UPDATE content_tokens 时 PostgreSQL 会自动重算；
- 重复执行是安全的（结果一致）。
"""

import asyncio

from sqlalchemy import select

from app.core.logger import get_logger
from app.db.models import DocumentChunk
from app.db.session import AsyncSessionLocal
from app.retrieval.tokenizer import segment

logger = get_logger(__name__)


async def main() -> None:
    async with AsyncSessionLocal() as session:
        chunks = (await session.execute(select(DocumentChunk))).scalars().all()
        changed = 0

        for chunk in chunks:
            tokens = segment(chunk.content)
            if chunk.content_tokens != tokens:
                chunk.content_tokens = tokens
                changed += 1

        await session.commit()
        logger.info(
            "backfill content_tokens done: total=%d changed=%d",
            len(chunks),
            changed,
        )


if __name__ == "__main__":
    asyncio.run(main())
