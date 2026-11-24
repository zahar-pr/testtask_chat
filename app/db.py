"""Доступ к SQLite: подключение и создание схемы."""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    text       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    mode       TEXT              -- заготовка, с которой отправлен вопрос (см. chat/modes.py)
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
"""


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
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(SCHEMA)
            # База, созданная до появления заготовок: дополняем таблицу, данные не трогаем.
            columns = {row["name"] for row in connection.execute("PRAGMA table_info(messages)")}
            if "mode" not in columns:
                connection.execute("ALTER TABLE messages ADD COLUMN mode TEXT")
