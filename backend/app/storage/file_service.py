from qcloud_cos import CosClientError, CosServiceError

from app.core.logger import get_logger
from app.storage.cos_client import CosClient, get_cos_client

logger =get_logger(__name__)

class FileService:
    def __init__(self, cos: CosClient | None = None) -> None:
        """
        初始化存储服务。

        :param cos: 可选的 COS 客户端实例。
                    - 传入实例：主要用于单元测试（可以传入 Mock 对象，避免发真实网络请求）。
                    - 不传（None）：走 or 后面的兜底逻辑，获取全局单例，用于生产环境。
        """
        # 依赖注入 + 单例兜底：如果传了就用传的，没传就去拿全局的
        self._cos = cos or get_cos_client()

    @property
    def bucket(self) -> str:
        """获取当前使用的存储桶名称（对外只读暴露，方便日志打印或业务判断）"""
        return self._cos.bucket

    @property
    def region(self) -> str:
        """获取当前存储桶所在的地域（如 ap-guangzhou）"""
        return self._cos.region

    @staticmethod
    def build_object_key(file_hash: str, suffix: str) -> str:
        """
        构建在 COS 中存储的完整对象键（路径）。
        使用静态方法，因为该方法不依赖实例状态（self）。

        :param file_hash: 文件的 SHA256 哈希值。
        :param suffix: 文件后缀（如 '.pdf', '.txt'）。
        :return: 拼接好的 COS 路径，如 'documents/a1b2c3d4... .pdf'
        """
        # 用 file_hash 作为 key 天然幂等：同文件多次上传命中同一 object，自动覆盖，不会产生冗余文件
        # suffix 保留原扩展名，方便在 COS 控制台直接点开预览（如果没后缀，控制台不知道用什么软件打开）
        return f"documents/{file_hash}{suffix}"

    async def upload(self, *, content: bytes, file_hash: str, suffix: str, mime_type: str) -> str:
        """
        上传文件到 COS。

        :param content: 文件的二进制内容。
        :param file_hash: 文件的哈希值（用于生成唯一路径）。
        :param suffix: 文件后缀。
        :param mime_type: 文件 MIME 类型（如 'application/pdf'），供浏览器识别。
        :return: 上传成功后，该文件在 COS 中的完整 object_key（路径）。
        """
        # 1. 根据 Hash 和后缀生成存储路径
        key = self.build_object_key(file_hash, suffix)
        # 2. 调用底层客户端执行上传（底层已经用 asyncio.to_thread 做了非阻塞处理）
        await self._cos.put_object(key=key, body=content, content_type=mime_type)
        # 3. 返回路径，上层业务通常需要把这个 key 存入数据库
        return key

    async def download(self, object_key: str) -> bytes:
        """
        从 COS 下载文件。

        :param object_key: 文件在 COS 中的完整路径。
        :return: 文件的二进制字节流。
        """
        # 直接透传调用底层客户端的 get_object 方法
        return await self._cos.get_object(object_key)

    async def delete(self, object_key: str) -> None:
        """
        删除存储中的 object。

        :param object_key: 要删除的文件路径。
        """
        try:
            # 尝试调用底层删除接口
            await self._cos.delete_object(object_key)
        except (CosClientError, CosServiceError) as exc:
            # 异常处理策略（重要）：捕获异常，记录警告，但不向上抛出（不中断业务流程）。
            # 为什么这么做？因为删除文件往往是“尽力而为”的操作。
            # 比如用户删除了数据库记录，此时去删 COS 文件失败了，不应该让整个删除接口报错，只需记日志人工排查即可。
            logger.warning("cos delete failed: key=%s, err=%s", object_key, exc)

def get_file_service() -> FileService:
    return FileService()