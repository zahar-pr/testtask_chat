"""HTTP-эндпоинты чатов. Все требуют действующей сессии."""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator
from itertools import chain
from typing import Annotated

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import StreamingResponse

from app.auth.dependencies import require_session
from app.chat.errors import ModelFailed
from app.chat.schemas import ChatListResponse, ExchangeResponse, HistoryResponse, MessageRequest
from app.chat.service import AnswerChunk, AnswerRestart, ChatEvent, ChatService
from app.errors import AppError
from app.llm.base import LLMError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chats", tags=["chat"], dependencies=[Depends(require_session)])


def get_chat_service(request: Request) -> ChatService:
    return request.app.state.chat_service


Service = Annotated[ChatService, Depends(get_chat_service)]


@router.get("", response_model=ChatListResponse)
def list_chats(chat: Service):
    return {"chats": chat.chats()}


@router.post("", status_code=status.HTTP_201_CREATED)
def start_chat(payload: MessageRequest, chat: Service) -> StreamingResponse:
    """Начать новый чат вопросом. Чат появится в списке, когда ответ будет сохранён."""
    return _answer_stream(chat.send(payload.text, payload.mode))


@router.get("/{chat_id}/messages", response_model=HistoryResponse)
def list_messages(chat_id: int, chat: Service):
    return {"messages": chat.history(chat_id)}


@router.post("/{chat_id}/messages", status_code=status.HTTP_201_CREATED)
def send_message(chat_id: int, payload: MessageRequest, chat: Service) -> StreamingResponse:
    """Задать вопрос в существующем чате."""
    return _answer_stream(chat.send(payload.text, payload.mode, chat_id, payload.replace_last))


@router.delete("/{chat_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_chat(chat_id: int, chat: Service) -> None:
    chat.delete(chat_id)


def _answer_stream(events: Iterator[ChatEvent]) -> StreamingResponse:
    """Ответ модели потоком событий (Server-Sent Events):

    - `delta` `{"text"}` — очередная часть ответа;
    - `reset` `{}` — ответ оборвался и запрошен заново: показанный текст нужно стереть;
    - `done` `{"chat", "user", "assistant"}` — пара сохранена в чат;
    - `error` `{"code", "message"}` — ответа не будет, в чат ничего не попало.
    """
    # Первую часть ждём до отправки заголовков: если модель не ответила вовсе или чата нет,
    # клиент получит обычную ошибку с HTTP-статусом, а не «успешный» поток.
    try:
        first = next(events)
    except LLMError as error:
        logger.warning("Модель не ответила (%s): %s", error.failure.value, error)
        raise ModelFailed(error) from error
    return StreamingResponse(
        _to_sse(chain([first], events)),
        status_code=status.HTTP_201_CREATED,
        media_type="text/event-stream",
        # no-store — ответ нельзя кэшировать; X-Accel-Buffering — nginx не должен копить поток.
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


def _to_sse(events: Iterator[ChatEvent]) -> Iterator[str]:
    """Заголовки уже ушли, поэтому любая ошибка отсюда сообщается событием `error`, а не статусом."""
    try:
        for event in events:
            if isinstance(event, AnswerChunk):
                yield _sse("delta", {"text": event.text})
            elif isinstance(event, AnswerRestart):
                yield _sse("reset", {})
            else:
                yield _sse("done", ExchangeResponse.model_validate(event).model_dump(mode="json"))
    except LLMError as error:
        logger.warning("Ответ модели оборвался (%s): %s", error.failure.value, error)
        yield _error_event(ModelFailed(error))
    except AppError as error:  # например, чат удалили в другой вкладке, пока шёл ответ
        yield _error_event(error)
    except Exception:
        logger.exception("Сбой при выдаче ответа")
        yield _error_event(AppError())


def _error_event(error: AppError) -> str:
    return _sse("error", {"code": error.code, "message": error.message})


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
