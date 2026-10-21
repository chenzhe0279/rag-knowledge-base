"""FastAPI 应用入口"""
from fastapi import FastAPI

from app.api.error_handlers import register_error_handlers
from app.api.routes import health, documents, chat
from app.core.config import settings
from app.core.logger import configure_logging, get_logger

from fastapi.middleware.cors import CORSMiddleware


def create_app() -> FastAPI:
    """
    应用工厂函数：负责组装和配置 FastAPI 应用实例。

    使用工厂模式的好处：
    1. 便于测试（每次测试都可以创建一个纯净的 app 实例）。
    2. 避免循环导入。
    3. 可以方便地根据环境（开发、测试、生产）传入不同配置。
    """

    # 1. 初始化日志系统（调用之前写好的日志配置函数）
    configure_logging()

    # 2. 获取当前模块的 logger 实例（__name__ 此时可能是 main 或 app 等入口模块）
    logger = get_logger(__name__)

    # 3. 创建 FastAPI 实例，传入应用名称（会自动展示在 Swagger UI 的文档标题上）
    app = FastAPI(title=settings.app_name)

    # 4. 添加 CORS（跨域资源共享）中间件
    # 因为前端（如 http://localhost:5173）和后端（如 http://localhost:8000）端口不同，
    # 如果不配置 CORS，前端发起的 API 请求会被浏览器拦截。
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,  # 允许的源列表（从环境变量读取并解析的列表）
        allow_credentials=True,  # 允许前端请求携带 Cookie 等凭证信息
        allow_methods=["*"],  # 允许所有 HTTP 方法（GET, POST, PUT, DELETE 等）
        allow_headers=["*"],  # 允许所有请求头（如 Authorization, Content-Type 等）
    )

    # 5. 注册全局异常处理器
    # 接管 FastAPI 的默认异常处理，确保发生错误时返回统一的 JSON 格式（如 400/404/500）
    register_error_handlers(app)

    # 6. 注册路由（将各个模块的 API 挂载到主应用上）
    # 这里将 health.py 中的 router 挂载到 /api 路径下
    # 因此 health.py 中定义的 "/health" 最终访问路径为 "/api/health"
    app.include_router(health.router, prefix="/api")
    app.include_router(documents.router, prefix="/api")
    app.include_router(chat.router, prefix="/api")

    # 7. 记录一条应用初始化成功的日志（使用 %s 占位符延迟字符串拼接，提高性能）
    logger.info("app initialized：%s", settings.app_name)

    # 8. 返回配置组装完毕的 app 实例
    return app

app = create_app()