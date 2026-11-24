from __future__ import annotations

import sqlite3


def create_attempts(connection: sqlite3.Connection) -> None:
    """Результаты заданий тренажёров. Вопрос и тема хранятся здесь же, поэтому прогресс
    не пропадает, когда чат с тренажёром удалён."""
    connection.execute(
        "CREATE TABLE IF NOT EXISTS attempts ("
        " id INTEGER PRIMARY KEY AUTOINCREMENT,"
        " message_id INTEGER NOT NULL,"
        " block INTEGER NOT NULL,"
        " task INTEGER NOT NULL,"
        " topic TEXT NOT NULL,"
        " question TEXT NOT NULL,"
        " outcome TEXT NOT NULL CHECK (outcome IN ('first', 'solved', 'revealed')),"
        " created_at TEXT NOT NULL,"
        " UNIQUE (message_id, block, task))"
    )
