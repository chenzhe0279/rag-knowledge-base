"""统一日志配置：所有模块通过 get_logger(__name__) 获取 logger。"""

import logging
import sys
from app.core.config import settings

# 日志输出的格式模板。它规定了每条日志打印出来时长什么样。
# 比如：2026-10-16 21:35:12 | INFO     | app.main | 服务启动成功
# %(asctime)s	日志产生的时间	2026-10-16 21:35:12
# %(levelname)s	日志级别，左对齐占 8 个字符宽度	INFO
# %(name)s	产生日志的 logger 名称（通常是模块名）	app.main
# %(message)s	日志正文	服务启动成功
_LOG_FORMAT = "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"

# 定义日志中日期/时间的显示格式：年-月-日 时:分:秒
_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

# 模块级标志变量，用于防止重复配置日志（默认未配置）
_configured = False

# 配置全局日志记录器的函数，返回值为 None
def configure_logging() -> None:
    # 声明使用模块级变量 _configured，允许在函数内修改其值
    global _configured
    # 如果日志已经被配置过，则直接返回，避免重复初始化
    if _configured:
        return
    # 创建一个将日志输出到标准输出（stdout）的流处理器
    handler = logging.StreamHandler(sys.stdout)
    # 为处理器设置格式化器：使用统一的日志格式(_LOG_FORMAT)和日期格式(_DATE_FORMAT)
    handler.setFormatter(logging.Formatter(_LOG_FORMAT, datefmt=_DATE_FORMAT))
    # 获取根日志记录器（所有未命名子 logger 的父级）
    root = logging.getLogger()
    # 清除根记录器上已有的所有处理器（防止重复输出）
    root.handlers.clear()
    # 将上面创建的流处理器添加到根记录器中
    root.addHandler(handler)
    # 将根记录器的日志级别设置为配置文件中的 log_level（转为大写，如 INFO、DEBUG）
    root.setLevel(settings.log_level.upper())
    # 遍历第三方库中可能产生大量日志的 logger 名称
    for noisy in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        # 清除这些第三方 logger 自身的处理器（让它们使用根记录器的处理器）
        logging.getLogger(noisy).handlers.clear()
        # 设置 propagate 为 True，使日志向上传播到根记录器统一处理
        logging.getLogger(noisy).propagate = True
    # 标记日志已成功配置，后续调用 configure_logging 将直接跳过
    _configured = True

# 根据名称获取一个日志记录器实例的便捷函数
def get_logger(name: str) -> logging.Logger:
    # 调用标准库的 getLogger，返回对应名称的 Logger 实例（同一名称返回同一实例）
    return logging.getLogger(name)