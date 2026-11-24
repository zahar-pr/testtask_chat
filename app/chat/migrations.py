"""Как менялось хранение переписки: один чат → заготовки → несколько чатов."""

from __future__ import annotations

import sqlite3

from app.chat.titles import chat_title
from app.db import has_column


def create_messages(connection: sqlite3.Connection) -> None:
    connection.execute(
        "CREATE TABLE IF NOT EXISTS messages ("
        " id INTEGER PRIMARY KEY AUTOINCREMENT,"
        " role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),"
        " text TEXT NOT NULL,"
        " created_at TEXT NOT NULL)"
    )


def add_message_mode(connection: sqlite3.Connection) -> None:
    """Заготовка, с которой отправлен вопрос (см. modes.py)."""
    if not has_column(connection, "messages", "mode"):
        connection.execute("ALTER TABLE messages ADD COLUMN mode TEXT")


def create_chats(connection: sqlite3.Connection) -> None:
    """Несколько чатов. Переписка из времён единственного чата становится первым сохранённым чатом."""
    connection.execute(
        "CREATE TABLE IF NOT EXISTS chats ("
        " id INTEGER PRIMARY KEY AUTOINCREMENT,"
        " title TEXT NOT NULL,"
        " created_at TEXT NOT NULL,"
        " updated_at TEXT NOT NULL)"
    )
    if not has_column(connection, "messages", "chat_id"):
        connection.execute("ALTER TABLE messages ADD COLUMN chat_id INTEGER REFERENCES chats(id)")

    orphans = connection.execute(
        "SELECT role, text, created_at FROM messages WHERE chat_id IS NULL ORDER BY id"
    ).fetchall()
    if orphans:
        first_question = next((row["text"] for row in orphans if row["role"] == "user"), "Первый чат")
        cursor = connection.execute(
            "INSERT INTO chats (title, created_at, updated_at) VALUES (?, ?, ?)",
            (chat_title(first_question), orphans[0]["created_at"], orphans[-1]["created_at"]),
        )
        connection.execute("UPDATE messages SET chat_id = ? WHERE chat_id IS NULL", (cursor.lastrowid,))


def require_chat_for_messages(connection: sqlite3.Connection) -> None:
    """Сообщение не существует без чата: chat_id обязателен, сообщения удаляются вместе с чатом.

    SQLite не умеет менять ограничения столбца, поэтому таблица пересобирается.
    """
    connection.execute(
        "CREATE TABLE messages_strict ("
        " id INTEGER PRIMARY KEY AUTOINCREMENT,"
        " chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,"
        " role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),"
        " text TEXT NOT NULL,"
        " created_at TEXT NOT NULL,"
        " mode TEXT)"
    )
    connection.execute(
        "INSERT INTO messages_strict (id, chat_id, role, text, created_at, mode)"
        " SELECT id, chat_id, role, text, created_at, mode FROM messages"
    )
    connection.execute("DROP TABLE messages")
    connection.execute("ALTER TABLE messages_strict RENAME TO messages")
    connection.execute("CREATE INDEX messages_by_chat ON messages (chat_id, id)")
