"""Контракт языковой модели. Чат зависит только от него, а не от конкретного провайдера."""

from __future__ import annotations

from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from enum import Enum
from typing import Literal, Protocol

Role = Literal["user", "assistant"]


@dataclass(frozen=True)
class ChatTurn:
    role: Role
    text: str


class LLMFailure(str, Enum):
    RATE_LIMITED = "rate_limited"
    UNAVAILABLE = "unavailable"
    TIMEOUT = "timeout"
    MISCONFIGURED = "misconfigured"
    NO_ANSWER = "no_answer"
    TRUNCATED = "truncated"  # ответ упёрся в лимит длины
    BLOCKED = "blocked"  # модель отказалась отвечать (фильтры безопасности и т. п.)


class LLMError(Exception):
    def __init__(self, failure: LLMFailure, detail: str = "") -> None:
        super().__init__(detail or failure.value)
        self.failure = failure


class LLMClient(Protocol):
    def stream(self, system_prompt: str, turns: Sequence[ChatTurn]) -> Iterator[str]:
        """Отдавать ответ модели на диалог `turns` по частям, по мере генерации.

        Бросает LLMError — до первой части, если модель не ответила вовсе,
        или посреди потока, если ответ оборвался.
        """
        ...
