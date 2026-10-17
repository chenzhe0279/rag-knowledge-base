"""腾讯云 COS 客户端封装"""

import asyncio

from fastapi import Body
from qcloud_cos import CosConfig, CosS3Client
from qcloud_cos.cos_exception import CosClientError, CosServiceError
from sqlalchemy.util import await_

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

    @property
    def bucket(self) -> str:
        """当前客户端绑定的默认存储桶名称。"""
        return self._bucket

    @property
    def region(self) -> str:
        """COS 服务所在的地域，如 ap-guangzhou、ap-shanghai 等。"""
        return settings.cos_region
    
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

    async def put_object(self, *, key: str, body: bytes, content_type: str) -> None:
        """
        上传字节流到指定 object key。如果对象已存在则同名覆盖。

        :param key: COS 上的对象路径（如 'documents/xxx.pdf'）
        :param body: 文件的二进制内容
        :param content_type: 文件的 MIME 类型（如 'application/pdf'）
        """
        # 因为腾讯云 SDK 是同步阻塞的，所以使用 asyncio.to_thread
        # 把网络 I/O 操作丢到后台线程池，避免阻塞主线程的 asyncio 事件循环。
        await asyncio.to_thread(
            self._client.put_object,  # 注意：这里传的是函数引用（不带括号），交给后台去调用
            Bucket=self._bucket,  # 存储桶名称
            Key=key,  # 对象键（路径）
            Body=body,  # 文件字节流
            ContentType=content_type,  # 文件类型
        )

    async def get_object(self, key: str) -> bytes:
        """
        读取指定 object 的全部字节内容。

        :param key: COS 上的对象路径
        :return: 文件的二进制字节流 (bytes)
        """

        # 为什么要在这里定义一个内部函数 _read？
        # 因为 SDK 的 get_object 返回的 Body 是一个“流(stream)”，
        # 真正读取流里的数据（.read()）依然是一个耗时的同步网络 I/O 操作。
        # 如果只把 get_object 丢进 to_thread，拿到流对象后，在主线程里 .read() 依然会卡死事件循环。
        # 所以，把“获取对象” + “读取流” 这整个完整过程打包成 _read 函数。
        def _read() -> bytes:
            response = self._client.get_object(Bucket=self._bucket, Key=key)
            # SDK 返回的 Body 是流失对象，get_raw_stream 拿到原始 stream
            # 然后一次性将流中的数据全部读取到内存中，返回 bytes
            return response["Body"].get_raw_stream().read()

        # 将上述完整的阻塞操作 _read 丢到后台线程池执行，等待结果返回
        return await asyncio.to_thread(_read)

    async def delete_object(self, key: str) -> None:
        """
        删除指定的 object。

        :param key: COS 上的对象路径
        """
        # 同理，包装同步的删除操作，避免阻塞事件循环
        await asyncio.to_thread(
            self._client.delete_object,  # 传入函数引用
            Bucket=self._bucket,
            Key=key,
        )


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