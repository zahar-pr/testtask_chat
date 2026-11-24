"""Доступ к SQLite: подключение, схема и её обновление."""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS chats (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id    INTEGER REFERENCES chats(id),
    role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    text       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    mode       TEXT              -- заготовка, с которой отправлен вопрос (см. chat/modes.py)
);

-- Результаты заданий тренажёров. Вопрос и тема хранятся здесь же, поэтому прогресс
-- не пропадает, когда чат с тренажёром удалён.
CREATE TABLE IF NOT EXISTS attempts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    block      INTEGER NOT NULL,
    task       INTEGER NOT NULL,
    topic      TEXT NOT NULL,
    question   TEXT NOT NULL,
    outcome    TEXT NOT NULL CHECK (outcome IN ('first', 'solved', 'revealed')),
    created_at TEXT NOT NULL,
    UNIQUE (message_id, block, task)
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
"""

TITLE_MAX_LENGTH = 60


def chat_title(first_question: str) -> str:
    """Название чата — начало первого вопроса."""
    title = " ".join(first_question.split())
    return title if len(title) <= TITLE_MAX_LENGTH else title[: TITLE_MAX_LENGTH - 1].rstrip() + "…"


class Database:
    """Короткоживущие подключения: одно на операцию, транзакция — на блок `with`."""

    def __init__(self, path: Path) -> None:
        self._path = path

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self._path, timeout=5)
        connection.row_factory = sqlite3.Row
        try:
            with connection:  # commit при успехе, rollback при исключении
                yield connection
        finally:
            connection.close()

    def migrate(self) -> None:
        """Создать таблицы; базу от прежних версий дополнить, не трогая данные."""
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(SCHEMA)

            columns = {row["name"] for row in connection.execute("PRAGMA table_info(messages)")}
            if "mode" not in columns:  # база до появления заготовок
                connection.execute("ALTER TABLE messages ADD COLUMN mode TEXT")
            if "chat_id" not in columns:  # база времён единственного чата
                connection.execute("ALTER TABLE messages ADD COLUMN chat_id INTEGER REFERENCES chats(id)")
            _adopt_orphan_messages(connection)
            connection.execute("CREATE INDEX IF NOT EXISTS messages_by_chat ON messages (chat_id, id)")


def _adopt_orphan_messages(connection: sqlite3.Connection) -> None:
    """Переписка из единственного чата прежних версий становится первым сохранённым чатом."""
    orphans = connection.execute(
        "SELECT role, text, created_at FROM messages WHERE chat_id IS NULL ORDER BY id"
    ).fetchall()
    if not orphans:
        return
    first_question = next((row["text"] for row in orphans if row["role"] == "user"), "Первый чат")
    cursor = connection.execute(
        "INSERT INTO chats (title, created_at, updated_at) VALUES (?, ?, ?)",
        (chat_title(first_question), orphans[0]["created_at"], orphans[-1]["created_at"]),
    )
    connection.execute("UPDATE messages SET chat_id = ? WHERE chat_id IS NULL", (cursor.lastrowid,))
