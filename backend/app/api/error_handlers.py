"""统一异常 -> HTTP 响应转换。"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from app.core.logger import get_logger
from app.core.exceptions import AppException

# 获取当前模块的 logger，__name__ 会自动变成 "app.core.errors" 之类的模块名
logger = get_logger(__name__)


async def _app_exception_handler(_: Request, exc: AppException) -> JSONResponse:
    """
    处理自定义业务异常 AppException。

    - 第一个参数用 _ 表示不关心请求对象，只关心异常本身。
    - 使用异常携带的 http_status 作为响应状态码（如 404、403、503）。
    - 响应体统一为 {"code": ..., "message": ...}，方便前端解析。
    """
    return JSONResponse(
        status_code=exc.http_status,                       # 异常自带的 HTTP 状态码
        content={"code": exc.code, "message": exc.message},  # 业务错误码 + 提示信息
    )


async def _unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """
    兜底异常处理器：捕获所有未被 AppException 覆盖的异常。

    - 用 logger.exception 记录完整异常堆栈，便于线上排查问题。
    - 对外只返回 500 和统一提示，避免把数据库错误、代码路径等敏感信息泄露出去。
    """
    # logger.exception 会自动附带当前异常的堆栈信息
    logger.exception("unhandled exception at %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"code": "internal_error", "message": "服务内部错误"},
    )


def register_error_handlers(app: FastAPI) -> None:
    """
    将所有异常处理器注册到 FastAPI 应用实例。

    一般在应用启动时（如 main.py 创建 app 后）调用一次。
    """
    # 优先级高：AppException 及其子类由专用处理器处理
    app.add_exception_handler(AppException, _app_exception_handler)  # type: ignore[arg-type]
    # 优先级低：Exception 作为兜底，捕获其余所有未处理异常
    app.add_exception_handler(Exception, _unhandled_exception_handler)