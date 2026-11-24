"""Контракт языковой модели. Чат зависит только от него, а не от конкретного провайдера."""

from __future__ import annotations

from collections.abc import Sequence
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


class LLMError(Exception):
    def __init__(self, failure: LLMFailure, detail: str = "") -> None:
        super().__init__(detail or failure.value)
        self.failure = failure


class LLMClient(Protocol):
    def generate(self, system_prompt: str, turns: Sequence[ChatTurn]) -> str:
        """Вернуть ответ модели на диалог `turns` или бросить LLMError."""
        ...
