"""业务异常基类与常用异常。"""
from http import HTTPStatus


class AppException(Exception):
    """业务异常基类。"""

    code: str = "internal_error"
    message: str = "服务内部错误"
    http_status: int = HTTPStatus.INTERNAL_SERVER_ERROR

    def __init__(self, message: str | None = None, *, code: str | None = None) -> None:
        """
        初始化业务异常实例。

        :param message: 异常消息。若为 None，则使用类属性中定义的默认 message。
        :param code: 异常错误码（仅关键字参数）。若为 None，则使用类属性中定义的默认 code。
        """
        # 如果调用者传入了非 None 的 message，则覆盖实例的 message 属性
        if message is not None:
            self.message = message
        # 如果调用者传入了非 None 的 code，则覆盖实例的 code 属性
        if code is not None:
            self.code = code
        # 调用父类 Exception 的构造方法，将最终的 message 作为异常信息
        # 这样 str(异常对象) 或打印异常时就会显示 self.message
        super().__init__(self.message)


class NotFoundError(AppException):
    code = "not_found"
    message = "资源不存在"
    http_status = HTTPStatus.NOT_FOUND


class PermissionDeniedError(AppException):
    code = "permission_denied"
    message = "无权访问该资源"
    http_status = HTTPStatus.FORBIDDEN


class ConfigurationError(AppException):
    code = "configuration_error"
    message = "服务配置缺失"
    http_status = HTTPStatus.SERVICE_UNAVAILABLE