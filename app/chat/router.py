"""HTTP-эндпоинты чата. Все требуют действующей сессии."""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator
from itertools import chain
from typing import Annotated

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import StreamingResponse

from app.auth.dependencies import require_session
from app.chat.schemas import ExchangeResponse, HistoryResponse, MessageRequest
from app.chat.service import AnswerChunk, ChatService, Exchange
from app.errors import describe_llm_error
from app.llm.base import LLMError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/messages", tags=["chat"], dependencies=[Depends(require_session)])


def get_chat_service(request: Request) -> ChatService:
    return request.app.state.chat_service


Chat = Annotated[ChatService, Depends(get_chat_service)]


@router.get("", response_model=HistoryResponse)
def list_messages(chat: Chat):
    return {"messages": chat.history()}


@router.post("", status_code=status.HTTP_201_CREATED)
def send_message(payload: MessageRequest, chat: Chat) -> StreamingResponse:
    """Ответ модели приходит потоком событий (Server-Sent Events):

    - `delta` `{"text"}` — очередная часть ответа;
    - `done` `{"user", "assistant"}` — пара сохранена в историю;
    - `error` `{"code", "message"}` — ответ оборвался, в историю ничего не попало.
    """
    events = chat.send(payload.text)
    # Первую часть ждём до отправки заголовков: если модель не ответила вовсе, клиент получит
    # обычную ошибку с HTTP-статусом (её вернёт общий обработчик LLMError), а не «успешный» поток.
    first = next(events)
    return StreamingResponse(
        _to_sse(chain([first], events)),
        status_code=status.HTTP_201_CREATED,
        media_type="text/event-stream",
        # no-store — ответ нельзя кэшировать; X-Accel-Buffering — nginx не должен копить поток.
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def clear_messages(chat: Chat) -> None:
    chat.clear()


def _to_sse(events: Iterator[AnswerChunk | Exchange]) -> Iterator[str]:
    try:
        for event in events:
            if isinstance(event, AnswerChunk):
                yield _sse("delta", {"text": event.text})
            else:
                yield _sse("done", ExchangeResponse.model_validate(event).model_dump(mode="json"))
    except LLMError as error:
        logger.warning("Ответ модели оборвался (%s): %s", error.failure.value, error)
        _, code, message = describe_llm_error(error)
        yield _sse("error", {"code": code, "message": message})


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
