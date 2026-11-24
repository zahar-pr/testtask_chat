"""Хранилище чатов и их сообщений."""

from __future__ import annotations

import sqlite3
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from app.chat.errors import ChatChanged, ChatNotFound
from app.clock import from_storage, to_storage
from app.db import Database

Role = Literal["user", "assistant"]


@dataclass(frozen=True)
class Chat:
    id: int
    title: str
    updated_at: datetime


@dataclass(frozen=True)
class Message:
    id: int
    role: Role
    text: str
    created_at: datetime
    mode: str | None = None  # заготовка — только у вопросов пользователя


@dataclass(frozen=True)
class NewMessage:
    role: Role
    text: str
    created_at: datetime
    mode: str | None = None


_MESSAGE_COLUMNS = "id, role, text, created_at, mode"


class ChatRepository:
    """Сообщения записываются только парами «вопрос — ответ», каждая пара — одной транзакцией."""

    def __init__(self, database: Database) -> None:
        self._database = database

    # --- Чтение ---

    def list_chats(self) -> list[Chat]:
        """Все чаты, сначала те, в которых писали недавно."""
        with self._database.connect() as connection:
            rows = connection.execute(
                "SELECT id, title, updated_at FROM chats ORDER BY updated_at DESC, id DESC"
            ).fetchall()
        return [_to_chat(row) for row in rows]

    def get_chat(self, chat_id: int) -> Chat | None:
        with self._database.connect() as connection:
            row = connection.execute("SELECT id, title, updated_at FROM chats WHERE id = ?", (chat_id,)).fetchone()
        return _to_chat(row) if row else None

    def list_messages(self, chat_id: int) -> list[Message]:
        with self._database.connect() as connection:
            rows = connection.execute(
                f"SELECT {_MESSAGE_COLUMNS} FROM messages WHERE chat_id = ? ORDER BY id", (chat_id,)
            ).fetchall()
        return [_to_message(row) for row in rows]

    def list_recent_messages(self, chat_id: int, limit: int) -> list[Message]:
        """Последние `limit` сообщений чата в хронологическом порядке."""
        if limit <= 0:
            return []
        with self._database.connect() as connection:
            rows = connection.execute(
                f"SELECT {_MESSAGE_COLUMNS} FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?",
                (chat_id, limit),
            ).fetchall()
        return [_to_message(row) for row in reversed(rows)]

    def get_message(self, message_id: int) -> Message | None:
        with self._database.connect() as connection:
            row = connection.execute(f"SELECT {_MESSAGE_COLUMNS} FROM messages WHERE id = ?", (message_id,)).fetchone()
        return _to_message(row) if row else None

    # --- Запись ---

    def create_chat(self, title: str, exchange: Sequence[NewMessage]) -> tuple[Chat, list[Message]]:
        """Новый чат сразу с первой парой: чатов без сообщений в базе не бывает."""
        with self._database.connect() as connection:
            cursor = connection.execute(
                "INSERT INTO chats (title, created_at, updated_at) VALUES (?, ?, ?)",
                (title, to_storage(exchange[0].created_at), to_storage(exchange[-1].created_at)),
            )
            chat = Chat(cursor.lastrowid, title, exchange[-1].created_at)
            return chat, _insert_messages(connection, chat.id, exchange)

    def append_exchange(self, chat_id: int, exchange: Sequence[NewMessage]) -> tuple[Chat, list[Message]]:
        with self._database.connect() as connection:
            chat = _touch_chat(connection, chat_id, exchange[-1].created_at)
            return chat, _insert_messages(connection, chat_id, exchange)

    def replace_exchange(
        self, chat_id: int, replaced_ids: Sequence[int], title: str, exchange: Sequence[NewMessage]
    ) -> tuple[Chat, list[Message]]:
        """Поставить новую пару на место последней («ответить заново», правка вопроса).

        replaced_ids — сообщения, которые заменяем. Удаляются именно они и только если они всё
        ещё последние в чате: иначе, пока шёл ответ, кто-то дописал чат, и замена стёрла бы чужое.
        Если заменён первый вопрос чата, чат получает новое название `title`.
        """
        with self._database.connect() as connection:
            chat = _touch_chat(connection, chat_id, exchange[-1].created_at)
            last = connection.execute(
                "SELECT id FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?", (chat_id, len(replaced_ids))
            ).fetchall()
            if {row["id"] for row in last} != set(replaced_ids):
                raise ChatChanged()
            connection.executemany("DELETE FROM messages WHERE id = ?", [(message_id,) for message_id in replaced_ids])
            is_first_exchange = connection.execute(
                "SELECT 1 FROM messages WHERE chat_id = ? LIMIT 1", (chat_id,)
            ).fetchone() is None
            if is_first_exchange:
                connection.execute("UPDATE chats SET title = ? WHERE id = ?", (title, chat_id))
                chat = Chat(chat.id, title, chat.updated_at)
            return chat, _insert_messages(connection, chat_id, exchange)

    def delete_chat(self, chat_id: int) -> None:
        """Удалить чат; его сообщения удаляются вместе с ним (ON DELETE CASCADE)."""
        with self._database.connect() as connection:
            connection.execute("DELETE FROM chats WHERE id = ?", (chat_id,))


def _touch_chat(connection: sqlite3.Connection, chat_id: int, moment: datetime) -> Chat:
    """Отметить, что в чате только что писали. Чата уже нет — ChatNotFound."""
    updated = connection.execute("UPDATE chats SET updated_at = ? WHERE id = ?", (to_storage(moment), chat_id))
    if updated.rowcount == 0:
        raise ChatNotFound()
    title = connection.execute("SELECT title FROM chats WHERE id = ?", (chat_id,)).fetchone()["title"]
    return Chat(chat_id, title, moment)


def _insert_messages(connection: sqlite3.Connection, chat_id: int, messages: Sequence[NewMessage]) -> list[Message]:
    saved = []
    for message in messages:
        cursor = connection.execute(
            "INSERT INTO messages (chat_id, role, text, created_at, mode) VALUES (?, ?, ?, ?, ?)",
            (chat_id, message.role, message.text, to_storage(message.created_at), message.mode),
        )
        saved.append(Message(cursor.lastrowid, message.role, message.text, message.created_at, message.mode))
    return saved


def _to_chat(row: sqlite3.Row) -> Chat:
    return Chat(row["id"], row["title"], from_storage(row["updated_at"]))


def _to_message(row: sqlite3.Row) -> Message:
    return Message(row["id"], row["role"], row["text"], from_storage(row["created_at"]), row["mode"])
