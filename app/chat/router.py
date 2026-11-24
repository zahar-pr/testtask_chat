"""HTTP-эндпоинты чата. Все требуют действующей сессии."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request, status

from app.auth.dependencies import require_session
from app.chat.schemas import ExchangeResponse, HistoryResponse, MessageRequest
from app.chat.service import ChatService

router = APIRouter(prefix="/api/messages", tags=["chat"], dependencies=[Depends(require_session)])


def get_chat_service(request: Request) -> ChatService:
    return request.app.state.chat_service


Chat = Annotated[ChatService, Depends(get_chat_service)]


@router.get("", response_model=HistoryResponse)
def list_messages(chat: Chat):
    return {"messages": chat.history()}


@router.post("", response_model=ExchangeResponse, status_code=status.HTTP_201_CREATED)
def send_message(payload: MessageRequest, chat: Chat):
    return chat.send(payload.text)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def clear_messages(chat: Chat) -> None:
    chat.clear()
