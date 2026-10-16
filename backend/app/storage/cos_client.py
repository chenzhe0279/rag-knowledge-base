"""腾讯云 COS 客户端封装"""

import asyncio

from qcloud_cos import CosConfig, CosS3Client
from qcloud_cos.cos_exception import CosClientError, CosServiceError

from app.core.config import settings
from app.core.exceptions import ConfigurationError
from app.core.logger import get_logger

# 获取当前模块的 logger，__name__ 会自动变成当前模块名
logger = get_logger(__name__)


class CosClient:
    """腾讯云 COS 客户端封装，提供异步友好的操作接口。"""

    def __init__(self) -> None:
        """
        初始化 COS 客户端。

        首先检查配置是否完整，如果不完整则抛出 ConfigurationError，
        该异常会被全局异常处理器捕获，最终返回 HTTP 503。
        """
        # 检查 settings 中的 COS 配置是否完整（三项均非空）
        if not settings.cos_configured:
            raise ConfigurationError("腾讯云 COS 未配置，请在 .env 中填写 COS_* 变量")

        # 使用配置构建 COS 客户端
        config = CosConfig(
            Region=settings.cos_region,
            SecretId=settings.cos_secret_id,
            SecretKey=settings.cos_secret_key,
        )
        self._client = CosS3Client(config)
        self._bucket = settings.cos_bucket  # 默认存储桶名称

    async def ping(self) -> bool:
        """
        异步检查 COS 凭据与存储桶是否可用。

        通过调用 head_bucket 接口验证，成功返回 True，失败返回 False。
        """
        try:
            # qcloud_cos 是同步库，用 asyncio.to_thread 将其放到线程池中执行，
            # 避免阻塞事件循环。
            # to_thread()是把一个同步的、会阻塞的函数，放到单独的线程里去执行，并返回一个可等待对象，这样就不会卡住当前的事件循环
            await asyncio.to_thread(self._client.head_bucket,Bucket=self._bucket)
            return True
        except (CosClientError, CosServiceError) as exc:
            # 凭据错误、桶不存在、网络问题等都会走到这里
            logger.warning("COS ping failed: %s", exc)
            return False


# 模块级单例，初始为 None，惰性初始化
_cos_client: CosClient | None = None


def get_cos_client() -> CosClient:
    """
    获取全局唯一的 COS 客户端实例（惰性构造）。

    如果尚未初始化，则创建 CosClient 实例；
    如果配置缺失，CosClient() 会抛出 ConfigurationError，
    该异常由全局异常处理器转换为 HTTP 503。
    """
    global _cos_client
    if _cos_client is None:
        _cos_client = CosClient()
    return _cos_client