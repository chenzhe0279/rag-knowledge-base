"""add hybrid retrieval support

Revision ID: b7c1e2f3a4d5
Revises: 53a85db0af83
Create Date: 2026-10-24

Windows 本地版：
- 不创建 zhparser 扩展、不创建 chinese_zh 文本搜索配置；
- 用应用层 jieba 预分词写入 content_tokens；
- content_tsv 仍由 PostgreSQL 生成列自动维护。
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "b7c1e2f3a4d5"
down_revision: Union[str, Sequence[str], None] = "53a85db0af83"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1) 应用层分词结果：jieba 切好、空格连接的词串。
    #    老数据先填 ''，随后由 scripts/backfill_content_tokens.py 回填。
    op.add_column(
        "document_chunks",
        sa.Column(
            "content_tokens",
            sa.Text(),
            nullable=False,
            server_default=sa.text("''"),
        ),
    )

    # 2) 生成列：从 content_tokens 自动算 tsvector。
    #    必须是双参数 to_tsvector('simple'::regconfig, ...)，单参数版本不是 immutable，
    #    不能用于生成列。
    op.execute(
        "ALTER TABLE document_chunks ADD COLUMN content_tsv tsvector "
        "GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, content_tokens)) STORED"
    )

    # 3) GIN 索引：@@ 操作符走它做倒排查找。
    op.execute(
        "CREATE INDEX ix_document_chunks_content_tsv "
        "ON document_chunks USING GIN (content_tsv)"
    )

    # 4) 混合检索调试元数据。
    #    历史 citation 没有这个字段，所以必须 nullable=True。
    op.add_column(
        "answer_citations",
        sa.Column("retrieval_meta", postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("answer_citations", "retrieval_meta")
    op.execute("DROP INDEX IF EXISTS ix_document_chunks_content_tsv")
    op.execute("ALTER TABLE document_chunks DROP COLUMN IF EXISTS content_tsv")
    op.execute("ALTER TABLE document_chunks DROP COLUMN IF EXISTS content_tokens")
