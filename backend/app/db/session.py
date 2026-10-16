"""异步数据库 engine / session 工厂"""
from collections.abc import AsyncIterator
from app.core.config import settings
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    create_async_engine,
    async_sessionmaker,
    AsyncSession
)

# 创建异步 SQLAlchemy 引擎实例，用于管理与数据库的异步连接池
engine: AsyncEngine = create_async_engine(
    # 从应用配置中读取数据库连接 URL（如 postgresql+asyncpg://...）
    settings.database_url,
    # 关闭 SQL 语句回显，避免将每条 SQL 打印到控制台（生产环境建议关闭）
    echo=False,
    # 启用连接池预检测：每次从池中取出连接前先 ping 数据库，确保连接可用
    pool_pre_ping=True
)

# 定义异步会话工厂，用于创建与数据库交互的 AsyncSession 实例
AsyncSessionLocal: async_sessionmaker[AsyncSession] = async_sessionmaker(
    # 绑定上面创建的异步引擎，所有会话共享同一连接池
    bind=engine,
    # 提交后不过期对象属性，使会话提交后仍可读取已加载的数据
    expire_on_commit=False,
    # 关闭自动刷新，避免在查询时自动将未持久化的脏数据写入数据库
    autoflush=False
)

# 定义 FastAPI 依赖注入函数，为每个 HTTP 请求提供一个独立的异步数据库会话
async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI 依赖：提供请求级 AsyncSession"""
    # 通过异步上下文管理器创建会话，离开作用域时自动 commit/rollback 并关闭
    async with AsyncSessionLocal() as session:
        # 将当前会话 yield 给 FastAPI 依赖系统，供路由处理函数使用
        yield session