from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator

from app.chat.modes import ModeId

MESSAGE_MAX_LENGTH = 500  # то же ограничение показывает счётчик под полем ввода (static/js/validation.js)


class MessageRequest(BaseModel):
    text: str
    mode: ModeId | None = None  # выбранная заготовка; без неё — обычный вопрос
    # Заменить последнюю пару чата этим вопросом: «ответить заново» и правка последнего вопроса.
    replace_last: bool = False

    @field_validator("text")
    @classmethod
    def _check_text(cls, value: str) -> str:
        if len(value) > MESSAGE_MAX_LENGTH:
            raise ValueError(f"Сообщение не должно быть длиннее {MESSAGE_MAX_LENGTH} символов.")
        value = value.strip()
        if not value:
            raise ValueError("Сообщение не может быть пустым.")
        return value


class MessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    role: Literal["user", "assistant"]
    text: str
    created_at: datetime
    mode: str | None = None


class ChatResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    updated_at: datetime


class ChatListResponse(BaseModel):
    chats: list[ChatResponse]


class HistoryResponse(BaseModel):
    messages: list[MessageResponse]


class ExchangeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    chat: ChatResponse
    user: MessageResponse
    assistant: MessageResponse
