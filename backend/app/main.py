"""FastAPI 应用入口"""
from fastapi import FastAPI

from app.api.error_handlers import register_error_handlers
from app.api.routes import health, documents, chat, evaluations
from app.core.config import settings
from app.core.logger import configure_logging, get_logger

from fastapi.middleware.cors import CORSMiddleware

from app.core.observability import configure_observability
from app.db.seed import seed_default_admin
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager



# =====================================================================
# 函数作用：FastAPI 的“应用生命周期钩子”（Lifespan）。
# 这里集中处理应用启动前（如初始化数据库）和关闭后（如释放连接池）的逻辑。
# =====================================================================
# 装饰器：将异步生成器函数转换为 FastAPI 可识别的异步上下文管理器
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """应用生命周期钩子：启动时做种子初始化。"""
    # 获取当前模块的日志记录器
    logger = get_logger(__name__)

    # 检查核心安全配置：如果没有配置 JWT 密钥
    if not settings.jwt_secret:
        # 教学场景刻意不阻断启动，但提示学员补配
        # 记录 ERROR 日志提醒开发者，但不 raise 异常（防止新手跑不起来项目直接放弃）
        logger.error("JWT_SECRET 未配置，登录功能将不可用。请在 .env 中设置 JWT_SECRET")

    try:
        # 【核心动作】调用种子数据初始化函数（创建 admin 用户和内置角色）
        await seed_default_admin()
    except Exception:
        # 【容错处理】如果初始化失败（比如数据库没启动好），记录异常日志。
        # 同样不阻断应用启动，后续重启应用时会再次尝试
        logger.exception("种子初始化失败；后续可重新启动重试")

    # 【分界线】yield 之前是启动时执行的代码。
    # yield 会交出控制权，此时 FastAPI 开始接收 HTTP 请求，应用处于运行状态。
    # 如果有 yield 之后的代码，则会在应用关闭（Shutdown）时执行。
    yield


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

    # 2. 初始化可观测性系统（调用之前写好的可观测性配置函数）
    configure_observability()

    # 2. 获取当前模块的 logger 实例（__name__ 此时可能是 main 或 app 等入口模块）
    logger = get_logger(__name__)

    # 3. 创建 FastAPI 实例，传入应用名称（会自动展示在 Swagger UI 的文档标题上）
    #    lifespan：告诉 FastAPI在启动前先跑一遍 seed_default_admin 初始化数据，关闭时再处理收尾工作
    app = FastAPI(title=settings.app_name, lifespan=lifespan)

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
    app.include_router(evaluations.router, prefix="/api")
    # 7. 记录一条应用初始化成功的日志（使用 %s 占位符延迟字符串拼接，提高性能）
    logger.info("app initialized：%s", settings.app_name)

    # 8. 返回配置组装完毕的 app 实例
    return app

app = create_app()