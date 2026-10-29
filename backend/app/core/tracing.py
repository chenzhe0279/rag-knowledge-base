"""LangSmith traceable 的类型化包装。

直接使用 `langsmith.traceable` 时，它的类型签名是
`(*args: Any, **kwargs: Any) -> Union[Callable, Callable[[Callable], Callable]]`，
PyCharm 无法据此推断被装饰方法里 `self` 的类型，导致方法体中的
`self.xxx` 跳转/补全失效（例如 ChatService.stream_answer 里调用
self.get_conversation 会提示 Cannot find declaration）。

这里声明返回 `Callable[[F], F]` —— 一个"恒等装饰器" —— 运行时原样转调
langsmith，类型上保留原函数签名，PyCharm 就能正常解析 self。
"""

from typing import Any, Callable, TypeVar, cast

from langsmith import traceable as _langsmith_traceable

F = TypeVar("F", bound=Callable[..., Any])


def traceable(*args: Any, **kwargs: Any) -> Callable[[F], F]:
    """与 langsmith.traceable 用法完全一致，只是保留被装饰函数的类型。"""
    return cast(Callable[[F], F], _langsmith_traceable(*args, **kwargs))
