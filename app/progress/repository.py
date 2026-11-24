"""Хранилище результатов тренажёров: какое задание и с какой попытки решено."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from app.clock import from_storage, to_storage
from app.db import Database

# first — верно с первой попытки, solved — верно не сразу, revealed — посмотрели решение.
Outcome = Literal["first", "solved", "revealed"]


@dataclass(frozen=True)
class Attempt:
    topic: str
    question: str
    outcome: Outcome
    created_at: datetime


@dataclass(frozen=True)
class TopicProgress:
    topic: str
    tasks: int
    first: int


class ProgressRepository:
    def __init__(self, database: Database) -> None:
        self._database = database

    def save(
        self, message_id: int, block: int, task: int, topic: str, question: str, outcome: Outcome, moment: datetime
    ) -> None:
        """Записать результат задания. Повторное прохождение того же задания заменяет прежний результат."""
        with self._database.connect() as connection:
            connection.execute(
                "INSERT INTO attempts (message_id, block, task, topic, question, outcome, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT (message_id, block, task) DO UPDATE SET "
                "outcome = excluded.outcome, created_at = excluded.created_at",
                (message_id, block, task, topic, question, outcome, to_storage(moment)),
            )

    def totals(self) -> dict[str, int]:
        with self._database.connect() as connection:
            rows = connection.execute("SELECT outcome, COUNT(*) AS count FROM attempts GROUP BY outcome").fetchall()
        counts = {row["outcome"]: row["count"] for row in rows}
        return {outcome: counts.get(outcome, 0) for outcome in ("first", "solved", "revealed")}

    def by_topic(self) -> list[TopicProgress]:
        """Темы (названия тренажёров), начиная с тех, где занимались последними."""
        with self._database.connect() as connection:
            rows = connection.execute(
                "SELECT topic, COUNT(*) AS tasks, SUM(outcome = 'first') AS first FROM attempts "
                "GROUP BY topic ORDER BY MAX(created_at) DESC"
            ).fetchall()
        return [TopicProgress(row["topic"], row["tasks"], row["first"]) for row in rows]

    def mistakes(self, limit: int) -> list[Attempt]:
        """Последние задания, решённые не с первой попытки."""
        with self._database.connect() as connection:
            rows = connection.execute(
                "SELECT topic, question, outcome, created_at FROM attempts WHERE outcome != 'first' "
                "ORDER BY created_at DESC, id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [Attempt(row["topic"], row["question"], row["outcome"], from_storage(row["created_at"])) for row in rows]

    def clear(self) -> None:
        with self._database.connect() as connection:
            connection.execute("DELETE FROM attempts")
