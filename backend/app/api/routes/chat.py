from collections.abc import AsyncIterable
from uuid import UUID

from fastapi import APIRouter
from fastapi.responses import EventSourceResponse
from fastapi.sse import ServerSentEvent

from app.api.deps import DbSession
from app.api.schemas.chat import (
    ChatRequest,
    ConversationCreate,
    ConversationDetail,
    ConversationRead,
    MessageRead,
)
from app.services.chat_service import ChatService

# 创建聊天模块的路由实例。
# prefix="/conversations" 表示该模块下所有接口路径都会带上 /conversations 前缀。
# tags=["chat"] 用于在 Swagger 文档中将接口归类。
router = APIRouter(prefix="/conversations", tags=["chat"])


# 注册 POST 请求路由，用于创建一个新会话
@router.post("", response_model=ConversationRead, status_code=201, operation_id="createConversation",)
# 定义异步处理函数，接收请求体和数据库会话
async def create_conversation(payload: ConversationCreate, session: DbSession,) -> ConversationRead:
    # 实例化业务服务层，将数据库会话注入进去
    service = ChatService(session)
    # 调用服务层方法创建会话，传入校验过后的标题
    conversation = await service.create_conversation(title=payload.title)
    # 将数据库 ORM 对象转换为 Pydantic 响应模型，自动返回 JSON 给前端
    return ConversationRead.model_validate(conversation)


# 注册 GET 请求路由，用于获取指定会话的详情
@router.get("/{conversation_id}", response_model=ConversationDetail, operation_id="getConversation",)
# 定义异步处理函数
async def get_conversation(conversation_id: UUID, session: DbSession,) -> ConversationDetail:
    """返回会话本身 + 全部历史消息（含引用）。"""
    # 实例化业务服务层
    service = ChatService(session)
    # 调用服务层方法，获取会话实体和该会话下的所有历史消息（返回一个元组）
    conversation, messages = await service.list_messages(conversation_id)
    # 构造嵌套的响应模型并返回
    return ConversationDetail(
        # 将会话 ORM 对象转为 Pydantic 模型
        conversation=ConversationRead.model_validate(conversation),
        # 使用列表推导式，遍历所有消息 ORM 对象，逐个转为 Pydantic 模型（包含了引用信息）
        messages=[MessageRead.from_orm(m) for m in messages],
    )


# 注册 POST 请求路由，用于流式问答
@router.post("/{conversation_id}/chat", operation_id="streamChat",
    # 指定响应类为 EventSourceResponse，告诉 FastAPI 这是一个 SSE（Server-Sent Events）流式响应
    response_class=EventSourceResponse,
)
async def stream_chat(conversation_id: UUID, payload: ChatRequest, session: DbSession,) -> AsyncIterable[ServerSentEvent]:
    """SSE 流式问答。

    事件协议：message_start -> citations -> token...（多次） -> message_end；
    任何阶段出错改 yield error。前端用 @microsoft/fetch-event-source 接。
    """
    # 实例化业务服务层
    service = ChatService(session)
    # 1. 判断前端有没有传过滤条件（payload.filters 可能是个对象，也可能是 None）
    if payload.filters:
        # 2. 如果传了，就调用 to_domain()，把 API 层的 Pydantic 模型转换为领域层的不可变对象
        filters = payload.filters.to_domain()
    else:
        # 3. 如果没传（为 None），就直接赋值为 None
        filters = None
    # 调用服务层的异步生成器 stream_answer。
    # 它会依次产生 message_start、citations、token 和 message_end 等事件。
    async for sse_event in service.stream_answer(conversation_id, payload.question, filters=filters):
        # 将服务层产出的字典数据，包装成 FastAPI 标准的 SSE 事件对象并推送给前端
        yield ServerSentEvent(
            # 事件携带的数据载荷（通常是 JSON 序列化后的字符串或字典）
            data=sse_event["data"],
            # 事件类型（如 "token", "message_end" 等），前端根据这个字段决定如何处理数据
            event=sse_event["event"],
        )