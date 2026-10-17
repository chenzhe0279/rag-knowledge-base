"""健康检查接口：验证后端、数据库、COS 连通性"""
from sqlalchemy import text
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

from app.api.deps import DbSession
from app.core.config import settings
from app.core.logger import get_logger
from app.storage.cos_client import get_cos_client

# 获取当前模块的 logger，__name__ 会自动变成当前模块名
logger = get_logger(__name__)

# 创建健康检查相关的路由实例
# prefix="/health"：该路由下的所有接口路径都会自动带上 /health 前缀
# tags=["health"]：在生成的 API 文档（Swagger UI）中，这些接口会被归类到 "health" 标签下
router = APIRouter(prefix="/health", tags=["health"])

# 定义健康状态的枚举值（字面量类型）
# 限制 status 字段只能接受 "ok"、"error" 或 "not_configured" 这三个字符串，防止传入无效状态
HealthStatusValue = Literal["ok", "error", "not_configured"]


class HealthStatus(BaseModel):
    """
    健康状态响应模型 (Pydantic Model)。
    用于规范健康检查接口返回的 JSON 数据结构，并提供自动的数据校验。
    """

    # 必填字段：当前系统的健康状态
    status: HealthStatusValue

    # 可选字段：详细的附加信息（例如：错误原因、未配置的提示等）
    # str | None 表示类型可以是字符串或空值
    # = None 表示该字段为可选，如果接口没有返回该字段，默认为 None
    detail: str | None = None

@router.get("", response_model=HealthStatus, operation_id="healthApp")
async def health() -> HealthStatus:
    return HealthStatus(status="ok",detail="health接口测试成功")


@router.get("/db", response_model=HealthStatus, operation_id="healthDb")
async def health_db(session: DbSession) -> HealthStatus:
    try:
        # 执行最简 SQL 查询（SELECT 1），用于验证数据库连接是否可用
        result = await session.execute(text("SELECT 1"))
        # 从结果集中取出第一行第一列的值，若连接异常或无返回值则抛出异常，由外层 except 捕获
        result.scalar_one()
        return HealthStatus(status="ok",detail="healthDb接口测试成功")
    except Exception as exc:
        logger.exception("db health check failed")
        return HealthStatus(status="error", detail=str(exc))

@router.get("/cos", response_model=HealthStatus, operation_id="healthCos")
async def health_cos() -> HealthStatus:
    if not settings.cos_configured:
        return HealthStatus(status="not_configured", detail="COS 凭据未在 .env 中配置")

    try:
        ok = await get_cos_client().ping()
    except Exception as exc:
        logger.exception("cos health check failed")
        return HealthStatus(status="error", detail=str(exc))
    if ok:
        return HealthStatus(status="ok")
    else:
        return HealthStatus(status="error", detail="health_bucket 失败")