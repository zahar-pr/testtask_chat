"""Хранилище чатов и их сообщений."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from app.clock import from_storage, to_storage
from app.db import Database
from app.llm.base import Role


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


class ChatRepository:
    def __init__(self, database: Database) -> None:
        self._database = database

    def list_chats(self) -> list[Chat]:
        """Все чаты, сначала те, в которых писали недавно."""
        with self._database.connect() as connection:
            rows = connection.execute(
                "SELECT id, title, updated_at FROM chats ORDER BY updated_at DESC, id DESC"
            ).fetchall()
        return [_to_chat(row) for row in rows]

    def get_chat(self, chat_id: int) -> Chat | None:
        with self._database.connect() as connection:
            row = connection.execute(
                "SELECT id, title, updated_at FROM chats WHERE id = ?", (chat_id,)
            ).fetchone()
        return _to_chat(row) if row else None

    def list_messages(self, chat_id: int) -> list[Message]:
        with self._database.connect() as connection:
            rows = connection.execute(
                "SELECT id, role, text, created_at, mode FROM messages WHERE chat_id = ? ORDER BY id",
                (chat_id,),
            ).fetchall()
        return [_to_message(row) for row in rows]

    def list_recent_messages(self, chat_id: int, limit: int) -> list[Message]:
        """Последние `limit` сообщений чата в хронологическом порядке."""
        if limit <= 0:
            return []
        with self._database.connect() as connection:
            rows = connection.execute(
                "SELECT id, role, text, created_at, mode FROM messages WHERE chat_id = ? "
                "ORDER BY id DESC LIMIT ?",
                (chat_id, limit),
            ).fetchall()
        return [_to_message(row) for row in reversed(rows)]

    def save_exchange(
        self, chat_id: int | None, title: str, messages: list[NewMessage], replace_last: bool = False
    ) -> tuple[Chat, list[Message]]:
        """Записать сообщения в чат одной транзакцией: либо все, либо ни одного.

        Если chat_id не задан, в той же транзакции создаётся новый чат с названием `title` —
        поэтому чатов без сообщений в базе не бывает.
        replace_last — новая пара встаёт на место последней («ответить заново», правка вопроса):
        старая пара удаляется в той же транзакции, так что при сбое она остаётся нетронутой.
        """
        moment = messages[-1].created_at
        saved: list[Message] = []
        with self._database.connect() as connection:
            if chat_id is None:
                cursor = connection.execute(
                    "INSERT INTO chats (title, created_at, updated_at) VALUES (?, ?, ?)",
                    (title, to_storage(messages[0].created_at), to_storage(moment)),
                )
                chat = Chat(cursor.lastrowid, title, moment)
            else:
                connection.execute(
                    "UPDATE chats SET updated_at = ? WHERE id = ?", (to_storage(moment), chat_id)
                )
                if replace_last:
                    connection.execute(
                        "DELETE FROM messages WHERE id IN "
                        "(SELECT id FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?)",
                        (chat_id, len(messages)),
                    )
                    remaining = connection.execute(
                        "SELECT COUNT(*) FROM messages WHERE chat_id = ?", (chat_id,)
                    ).fetchone()[0]
                    if remaining == 0:  # заменили первый вопрос чата — меняется и его название
                        connection.execute("UPDATE chats SET title = ? WHERE id = ?", (title, chat_id))
                row = connection.execute("SELECT title FROM chats WHERE id = ?", (chat_id,)).fetchone()
                chat = Chat(chat_id, row["title"], moment)

            for message in messages:
                cursor = connection.execute(
                    "INSERT INTO messages (chat_id, role, text, created_at, mode) VALUES (?, ?, ?, ?, ?)",
                    (chat.id, message.role, message.text, to_storage(message.created_at), message.mode),
                )
                saved.append(
                    Message(cursor.lastrowid, message.role, message.text, message.created_at, message.mode)
                )
        return chat, saved

    def delete_chat(self, chat_id: int) -> None:
        with self._database.connect() as connection:
            connection.execute("DELETE FROM messages WHERE chat_id = ?", (chat_id,))
            connection.execute("DELETE FROM chats WHERE id = ?", (chat_id,))


def _to_chat(row) -> Chat:
    return Chat(row["id"], row["title"], from_storage(row["updated_at"]))


def _to_message(row) -> Message:
    return Message(row["id"], row["role"], row["text"], from_storage(row["created_at"]), row["mode"])
