"""Вход по ключу доступа и серверные сессии."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

from app.auth.errors import InvalidAccessKey
from app.auth.sessions import SessionRepository
from app.clock import utc_now


@dataclass(frozen=True)
class IssuedSession:
    token: str
    expires_at: datetime
    max_age_seconds: int


class AuthService:
    def __init__(
        self,
        access_key: str,
        sessions: SessionRepository,
        session_ttl: timedelta,
        now: Callable[[], datetime] = utc_now,
    ) -> None:
        self._access_key_hash = _digest(access_key)
        self._sessions = sessions
        self._session_ttl = session_ttl
        self._now = now

    def login(self, candidate_key: str) -> IssuedSession:
        # Сравниваем хеши одинаковой длины за постоянное время: по времени ответа нельзя
        # ни подобрать ключ посимвольно, ни узнать его длину.
        if not hmac.compare_digest(_digest(candidate_key), self._access_key_hash):
            raise InvalidAccessKey()

        now = self._now()
        self._sessions.delete_expired(now)
        session = IssuedSession(
            token=secrets.token_urlsafe(32),
            expires_at=now + self._session_ttl,
            max_age_seconds=round(self._session_ttl.total_seconds()),
        )
        self._sessions.add(_hash(session.token), created_at=now, expires_at=session.expires_at)
        return session

    def is_authenticated(self, token: str | None) -> bool:
        if not token:
            return False
        expires_at = self._sessions.get_expiry(_hash(token))
        return expires_at is not None and expires_at > self._now()

    def logout(self, token: str | None) -> None:
        if token:
            self._sessions.delete(_hash(token))


def _digest(secret: str) -> bytes:
    return hashlib.sha256(secret.encode()).digest()


def _hash(token: str) -> str:
    """Под этим значением сессия хранится в базе: сам токен есть только у браузера."""
    return hashlib.sha256(token.encode()).hexdigest()
