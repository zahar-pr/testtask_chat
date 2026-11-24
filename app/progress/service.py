"""Прогресс ученика: результаты заданий тренажёров и сводка по ним."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from app.clock import utc_now
from app.progress.errors import TrainerNotFound
from app.progress.repository import Attempt, Outcome, ProgressRepository, TopicProgress

MISTAKES_SHOWN = 20


class StoredMessage(Protocol):
    role: str


@dataclass(frozen=True)
class Summary:
    totals: dict[str, int]
    topics: list[TopicProgress]
    mistakes: list[Attempt]


class ProgressService:
    """find_message — как найти сообщение чата по номеру: тренажёры живут в ответах модели,
    и результат принимается только для существующего ответа."""

    def __init__(
        self, attempts: ProgressRepository, find_message: Callable[[int], StoredMessage | None]
    ) -> None:
        self._attempts = attempts
        self._find_message = find_message

    def record_attempt(
        self, message_id: int, block: int, task: int, topic: str, question: str, outcome: Outcome
    ) -> None:
        message = self._find_message(message_id)
        if message is None or message.role != "assistant":
            raise TrainerNotFound()
        self._attempts.save(message_id, block, task, topic.strip(), question.strip(), outcome, utc_now())

    def summary(self) -> Summary:
        return Summary(
            totals=self._attempts.totals(),
            topics=self._attempts.by_topic(),
            mistakes=self._attempts.mistakes(MISTAKES_SHOWN),
        )

    def recent_mistakes(self, limit: int) -> list[tuple[str, str]]:
        """Пары (тема, текст задания) для режима «работа над ошибками» (см. ChatService)."""
        return [(attempt.topic, attempt.question) for attempt in self._attempts.mistakes(limit)]

    def reset(self) -> None:
        self._attempts.clear()
