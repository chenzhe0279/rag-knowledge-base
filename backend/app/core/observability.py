"""LangSmith 可观测性接入。

设计意图：
- 把 langsmith 的具体 SDK 调用收敛到一个文件，让业务代码只看到 `@traceable`
  装饰器和 `get_current_trace_id()` 两个稳定符号
- 启动期把 `settings` 同步成 LangSmith 官方环境变量。langsmith SDK 内部读
  的是 env vars (`LANGSMITH_TRACING` / `LANGSMITH_API_KEY` ...)，不读我们的
  `Settings`，所以必须在 `create_app` 阶段做一次显式同步
- 未启用时强制写 `LANGSMITH_TRACING=false`，避免 SDK 在缺 key 情况下尝试
  上报 trace 报错刷屏
"""

import os

from app.core.config import settings
from app.core.logger import get_logger

# 初始化当前模块的日志记录器
logger = get_logger(__name__)


def configure_observability() -> None:
    """把 settings 写到 LangSmith 官方环境变量，应用启动时调用一次即可。

    - 启用：写 LANGSMITH_TRACING=true + API key / project / endpoint
    - 关闭：强制写 LANGSMITH_TRACING=false，避免 SDK 走默认开启路径
    """

    # 判断是否启用了可观测性（前面看过的那个 property：开关打开 AND 有 API Key）
    if settings.observability_enabled:
        # 核心同步操作：把配置塞进系统环境变量，让底层 SDK 能读到
        os.environ["LANGSMITH_TRACING"] = "true"
        os.environ["LANGSMITH_API_KEY"] = settings.langsmith_api_key
        os.environ["LANGSMITH_PROJECT"] = settings.langsmith_project
        os.environ["LANGSMITH_ENDPOINT"] = settings.langsmith_endpoint

        # 记录 Info 级别日志，表示开启成功
        logger.info(
            "LangSmith tracing enabled: project=%s endpoint=%s",
            settings.langsmith_project,
            settings.langsmith_endpoint,
        )
    else:
        # 如果未启用（没填 key 或开关关了），强制将环境变量设为 false
        # 这是为了防止某些情况下 SDK 误以为要开启，导致抛出异常或刷屏报错
        os.environ["LANGSMITH_TRACING"] = "false"
        logger.info("LangSmith tracing disabled (no LANGSMITH_API_KEY or switch off)")


def get_current_trace_id() -> str | None:
    """读取当前 @traceable 上下文中的 trace_id。

    - 未启用 LangSmith / 不在 traceable 上下文 / 任何异常 -> 返回 None
    - 永远不抛错：可观测性是"加分项"，不能因为 trace SDK 抖动阻断问答
    """
    # 1. 前置校验：如果全局未开启可观测性（没配 key 或开关关了），直接返回 None
    # 提前返回可以省去后续的模块导入和计算开销
    if not settings.observability_enabled:
        return None

    try:
        # 2. 延迟导入（Lazy Import）：把 import 放在函数内部或 try 块里
        # 这样做的好处是，如果没启用 tracing，根本不会加载 langsmith 的底层依赖，加快应用启动速度
        from langsmith.run_helpers import get_current_run_tree

        # 3. 获取当前的运行树节点（通常是被 @traceable 装饰的函数运行时的上下文）
        run = get_current_run_tree()

        # 4. 如果不在 traceable 的上下文中（比如是被其他非追踪函数调用的），run 会返回 None
        if run is None:
            return None

        # 5. 提取 trace_id 并转为字符串返回
        return str(run.trace_id)

    except Exception:
        # 6. 兜底异常处理：可观测性工具属于“锦上添花”的功能
        # 绝对不能因为 LangSmith SDK 自身的网络超时、序列化失败等 bug，导致主业务（AI 问答）崩溃
        # 记录一条 warning 级别的日志（带堆栈信息），然后安全返回 None
        logger.warning("get_current_trace_id 异常，返回 None", exc_info=True)
        return None


def build_trace_url(trace_id: str | None) -> str | None:
    """把 trace_id 拼成 LangSmith UI 的 run 详情页 URL。

    需要用户在 .env 配置 LANGSMITH_RUN_URL_PREFIX（带 org / project 信息），
    未配置时返回 None，前端只展示复制按钮、不展示跳转链接。
    """
    # 1. 容错处理：如果没有 trace_id（可能没开启追踪），或者没有配置 URL 前缀
    # 直接返回 None，此时前端可能只显示一个复制 ID 的按钮
    if not trace_id or not settings.langsmith_run_url_prefix:
        return None

    # 2. 拼接完整的 URL。
    # 使用了 rstrip('/') 来移除配置前缀末尾可能多余的斜杠，
    # 防止拼接出类似 "https://xxx.com//r/xxx" 这样带双斜杠的错误 URL。
    return f"{settings.langsmith_run_url_prefix.rstrip('/')}/r/{trace_id}"