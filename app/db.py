"""Доступ к SQLite: подключения и применение миграций. О таблицах конкретных возможностей
этот модуль не знает — их описывают миграции (app/migrations.py)."""

from __future__ import annotations

import sqlite3
from collections.abc import Callable, Iterator, Sequence
from contextlib import contextmanager
from pathlib import Path

# Миграция — один шаг изменения схемы. Получает открытое подключение внутри транзакции.
Migration = Callable[[sqlite3.Connection], None]


class Database:
    """Короткоживущие подключения: одно на операцию, транзакция — на блок `with`."""

    def __init__(self, path: Path) -> None:
        self._path = path

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self._path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")  # в SQLite внешние ключи включаются на подключение
        try:
            with connection:  # commit при успехе, rollback при исключении
                yield connection
        finally:
            connection.close()

    def migrate(self, migrations: Sequence[Migration]) -> None:
        """Применить миграции, которых в базе ещё нет.

        Номер последней применённой миграции хранится в самой базе (PRAGMA user_version).
        Каждая миграция идёт в своей транзакции: либо применилась целиком, либо не применилась.
        """
        self._path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self._path, timeout=5, isolation_level=None)  # транзакциями управляем сами
        connection.row_factory = sqlite3.Row
        try:
            connection.execute("PRAGMA journal_mode = WAL")
            applied = connection.execute("PRAGMA user_version").fetchone()[0]
            for number, migration in enumerate(migrations[applied:], start=applied + 1):
                connection.execute("BEGIN")
                try:
                    migration(connection)
                    connection.execute(f"PRAGMA user_version = {number}")
                except BaseException:
                    connection.execute("ROLLBACK")
                    raise
                connection.execute("COMMIT")
        finally:
            connection.close()


def has_column(connection: sqlite3.Connection, table: str, column: str) -> bool:
    return any(row["name"] == column for row in connection.execute(f"PRAGMA table_info({table})"))
