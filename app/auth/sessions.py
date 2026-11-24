"""Хранилище сессий. В базе лежит только SHA-256 от токена, сам токен — у браузера."""

from __future__ import annotations

from datetime import datetime

from app.clock import from_storage, to_storage
from app.db import Database


class SessionRepository:
    def __init__(self, database: Database) -> None:
        self._database = database

    def add(self, token_hash: str, created_at: datetime, expires_at: datetime) -> None:
        with self._database.connect() as connection:
            connection.execute(
                "INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)",
                (token_hash, to_storage(created_at), to_storage(expires_at)),
            )

    def get_expiry(self, token_hash: str) -> datetime | None:
        with self._database.connect() as connection:
            row = connection.execute(
                "SELECT expires_at FROM sessions WHERE token_hash = ?", (token_hash,)
            ).fetchone()
        return from_storage(row["expires_at"]) if row else None

    def delete(self, token_hash: str) -> None:
        with self._database.connect() as connection:
            connection.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))

    def delete_expired(self, now: datetime) -> None:
        with self._database.connect() as connection:
            connection.execute("DELETE FROM sessions WHERE expires_at <= ?", (to_storage(now),))
