from __future__ import annotations

import sqlite3


def create_sessions(connection: sqlite3.Connection) -> None:
    connection.execute(
        "CREATE TABLE IF NOT EXISTS sessions ("
        " token_hash TEXT PRIMARY KEY,"  # SHA-256 от токена: сам токен есть только у браузера
        " created_at TEXT NOT NULL,"
        " expires_at TEXT NOT NULL)"
    )
