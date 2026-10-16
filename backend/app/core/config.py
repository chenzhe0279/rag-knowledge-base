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
    database_url: str = ""
    # 腾讯云COS配置
    cos_secret_id: str = ""
    cos_secret_key: str = ""
    cos_region: str = "ap-guangzhou"
    cos_bucket: str = ""

    @property
    def cos_configured(self) -> bool:
        """
        只读属性：检查腾讯云 COS 配置是否完整。

        判断标准：cos_secret_id、cos_secret_key、cos_bucket 三者均非空。
        调用方式：直接写 settings.cos_configured（不加括号），返回 True/False。

        使用 @property 的用意：
        - 把“配置检查”封装成属性，调用更简洁。
        - 动态计算，不存储实际值，每次访问都基于当前配置判断。
        - 只读，外部无法赋值，避免误改配置状态。
        """
        # 利用 and 的短路特性：
        #   - 如果任意一个配置项为空字符串 ""，and 会返回该空字符串（假值）。
        #   - 如果三个都非空，and 返回最后一个非空字符串（真值）。
        # 外层 bool() 负责把结果统一转换成 True 或 False。
        return bool(self.cos_secret_id and self.cos_secret_key and self.cos_bucket)

@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()

settings = get_settings()