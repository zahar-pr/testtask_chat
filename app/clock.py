"""Время в одном формате для всего приложения: UTC, ISO 8601."""

from __future__ import annotations

from datetime import datetime, timezone


def utc_now() -> datetime:
    # Точность — миллисекунды: ровно столько хранит база, так что время в ответе API
    # совпадает с тем, что вернётся из истории после перезагрузки.
    now = datetime.now(timezone.utc)
    return now.replace(microsecond=now.microsecond // 1000 * 1000)


def to_storage(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat(timespec="milliseconds")


def from_storage(value: str) -> datetime:
    return datetime.fromisoformat(value)
