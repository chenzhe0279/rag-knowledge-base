"""应用配置：从根目录 .env 读取环境变量并暴露 settings 单例。"""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict
PROJECT_ROOT = Path(__file__).resolve().parents[3]

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_name: str = "rag-knowledge-base"
    log_level: str = "INFO"
    # 新增的数据库配置
    database_url: str = "postgresql+asyncpg://rag:rag@localhost:5432/rag_kb"

@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()

settings = get_settings()