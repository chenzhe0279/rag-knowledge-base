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

    cors_origins: str = "http://localhost:5173"

    @property
    def cors_origin_list(self) -> list[str]:
        result = []
        # 1. 把原始的字符串按逗号分割成列表
        parts = self.cors_origins.split(",")

        # 2. 遍历每一个部分
        for o in parts:
            # 3. 去掉首尾的空白字符（比如空格、换行）
            clean_o = o.strip()

            # 4. 如果去掉空格后不是空字符串，就加入结果
            if clean_o:
                result.append(clean_o)

        return result

    # ===== Embedding (DashScope OpenAI 兼容协议) =====
    embedding_api_key: str = ""
    # 阿里云 DashScope 提供的 OpenAI 兼容模式接口地址，允许我们使用标准的 OpenAI SDK 去调用通义千问的向量化模型
    embedding_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    embedding_model: str = "text-embedding-v3"
    # 向量维度（决定了存入数据库的向量数组长度）。
    # 警告：这个维度必须与数据库（如 PostgreSQL 的 pgvector 扩展）建表时定义的 Vector(N) 维度完全一致！
    # 如果以后需要修改维度，必须通过 Alembic 编写迁移脚本，重新创建并同步这张表。
    embedding_dim: int = 1024
    # 向量化批处理大小。由于 API 通常有单次请求的数据量/Token 限制，不能一次性把整本书传过去，
    # 这里设置为 10，表示每次请求处理 10 个文本块，避免触发限流或超时报错。
    embedding_batch_size: int = 10

    # ===== 文档上传与切分 =====
    # 允许用户上传的单个文件最大体积（单位：MB）。
    # 超过此大小将拒绝上传，防止过大的文件导致服务器内存溢出或处理超时。
    upload_max_size_mb: int = 50
    # 文本切分块大小 (Chunk Size)。将长文档切分成小段，600 代表每个文本块大约包含 600 个字符/Token。
    # 这个值需要权衡：太大可能导致检索不准且超出模型上下文，太小可能导致语义被截断。
    chunk_size: int = 600
    # 文本切分重叠大小 (Chunk Overlap)。相邻两个文本块之间重叠的字符数（60）。
    # 作用是防止重要的句子或语义恰好被切断在 chunk_size 的边界处，保留上下文连贯性。
    chunk_overlap: int = 60

    # ===== Chat 模型 (DashScope OpenAI 兼容协议) =====
    # 默认与 embedding 同 base_url
    chat_api_key: str = ""
    # DeepSeek 官方 OpenAI 兼容协议的 Base URL
    chat_base_url: str = "https://api.deepseek.com"
    # 调用最新的 DeepSeek V4.1 Flash 模型
    chat_model: str = "deepseek-flash"

    # ===== 检索与问答 =====
    # 检索 Top-K：交给 LLM 的候选 chunk 数量
    retrieval_top_k: int = 5
    # 拒答阈值：cosine similarity (= 1 - cosine_distance) 的下限
    # Top-K 中最高分仍低于此值，直接拒答，不调 LLM
    retrieval_min_score: float = 0.6
    # 多轮窗口：load_context 节点取最近多少轮塞进 prompt
    chat_history_window: int = 5

    # ===== Query 优化 =====
    # 关掉后 route_query 节点强制走 original，方便对比有/无路由的效果
    query_route_enabled: bool = True
    # Multi-Query 策略生成的子查询数量，过大会增加 embedding 成本
    multi_query_count: int = 3

    # ===== 混合检索 =====
    # 每路（向量 / 关键词）召回数量；设计文档建议候选 20-50
    # 取 20 兼顾召回率与 RRF 融合开销
    retrieval_recall_top_k: int = 20
    # RRF 平滑常数，业界一般用 60；越小越偏向高排名条目
    rrf_k: int = 60

    # ===== Agentic RAG =====
    # 关掉后图退化为单轮检索，作为单轮 vs agent 循环的对比开关
    agent_loop_enabled: bool = True
    # 最大检索轮次（含首轮）。LLM 决策最多触发 max_rounds-1 次再检索，避免循环调用
    agent_max_rounds: int = 3

    # ===== Reranker (DashScope qwen3-rerank) =====
    # 关掉后 rerank 节点直接透传，作为有/无精排的对比开关
    rerank_enabled: bool = True
    # DashScope rerank 端点，不是标准 OpenAI API
    rerank_base_url: str = (
        "https://dashscope.aliyuncs.com/compatible-api/v1/reranks"
    )
    rerank_model: str = "qwen3-rerank"
    # 留空时复用 chat_api_key（同一份 DashScope key，避免重复配置）
    rerank_api_key: str = ""
    # rerank Top1 相关度阈值；低于此值视为"上下文不足"由 judge_context 触发拒答
    # qwen3-rerank 输出 relevance_score ∈ [0, 1]，0.3 是经验值
    rerank_min_score: float = 0.3
    # 请求超时（秒），rerank 是同步调用主链路，超时要短一点避免拖慢回答
    rerank_timeout: float = 8.0

    # ===== 答案校验  =====
    # 关掉后跳过 verify_answer 调用，方便对比有/无引用支撑校验的效果
    verify_answer_enabled: bool = True

    @property
    def effective_rerank_api_key(self) -> str:
        """rerank_api_key 留空时回落到 chat_api_key，二者本来就是同一份 DashScope key。"""
        return self.rerank_api_key or self.chat_api_key

@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()

settings = get_settings()