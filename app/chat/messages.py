"""Хранилище сообщений чата."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from app.clock import from_storage, to_storage
from app.db import Database
from app.llm.base import Role


@dataclass(frozen=True)
class Message:
    id: int
    role: Role
    text: str
    created_at: datetime


@dataclass(frozen=True)
class NewMessage:
    role: Role
    text: str
    created_at: datetime


class MessageRepository:
    def __init__(self, database: Database) -> None:
        self._database = database

    def list_all(self) -> list[Message]:
        with self._database.connect() as connection:
            rows = connection.execute(
                "SELECT id, role, text, created_at FROM messages ORDER BY id"
            ).fetchall()
        return [_to_message(row) for row in rows]

    def list_recent(self, limit: int) -> list[Message]:
        """Последние `limit` сообщений в хронологическом порядке."""
        if limit <= 0:
            return []
        with self._database.connect() as connection:
            rows = connection.execute(
                "SELECT id, role, text, created_at FROM messages ORDER BY id DESC LIMIT ?", (limit,)
            ).fetchall()
        return [_to_message(row) for row in reversed(rows)]

    def add_many(self, messages: list[NewMessage]) -> list[Message]:
        """Сохранить сообщения одной транзакцией: либо все, либо ни одного."""
        saved: list[Message] = []
        with self._database.connect() as connection:
            for message in messages:
                cursor = connection.execute(
                    "INSERT INTO messages (role, text, created_at) VALUES (?, ?, ?)",
                    (message.role, message.text, to_storage(message.created_at)),
                )
                saved.append(Message(cursor.lastrowid, message.role, message.text, message.created_at))
        return saved

    def delete_all(self) -> None:
        with self._database.connect() as connection:
            connection.execute("DELETE FROM messages")


def _to_message(row) -> Message:
    return Message(row["id"], row["role"], row["text"], from_storage(row["created_at"]))
