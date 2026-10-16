"""FastAPI 依赖项汇总"""

from typing import Annotated
from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_session

# DbSession 是一个可复用的类型别名，用于 FastAPI 依赖注入：
# - Annotated 是 Python 的类型注解工具，语法是 Annotated[主类型, 附加信息]
# - AsyncSession：声明该参数的类型为 SQLAlchemy 的异步数据库会话
# - Depends(get_session)：告诉 FastAPI 在调用路由函数时，自动执行 get_session()
#   获取一个数据库会话并注入到该参数中，无需在每个路由里手动获取连接
DbSession = Annotated[AsyncSession, Depends(get_session)]
