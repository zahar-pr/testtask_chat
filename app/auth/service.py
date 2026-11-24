"""Вход по ключу доступа и серверные сессии."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta

from app.auth.sessions import SessionRepository
from app.clock import utc_now
from app.errors import InvalidAccessKey


@dataclass(frozen=True)
class IssuedSession:
    token: str
    expires_at: datetime


class AuthService:
    def __init__(self, access_key: str, sessions: SessionRepository, session_ttl: timedelta) -> None:
        self._access_key = access_key.encode()
        self._sessions = sessions
        self._session_ttl = session_ttl

    def login(self, candidate_key: str) -> IssuedSession:
        # Сравнение за постоянное время: по времени ответа нельзя подобрать ключ посимвольно.
        if not hmac.compare_digest(candidate_key.encode(), self._access_key):
            raise InvalidAccessKey()

        now = utc_now()
        self._sessions.delete_expired(now)
        session = IssuedSession(token=secrets.token_urlsafe(32), expires_at=now + self._session_ttl)
        self._sessions.add(_hash(session.token), created_at=now, expires_at=session.expires_at)
        return session

    def is_authenticated(self, token: str | None) -> bool:
        if not token:
            return False
        expires_at = self._sessions.get_expiry(_hash(token))
        return expires_at is not None and expires_at > utc_now()

    def logout(self, token: str | None) -> None:
        if token:
            self._sessions.delete(_hash(token))


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
