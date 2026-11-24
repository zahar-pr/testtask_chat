"""Зависимости FastAPI: достают сервисы из состояния приложения и проверяют сессию."""

from __future__ import annotations

from typing import Annotated

from fastapi import Cookie, Depends, Request

from app.auth.rate_limit import LoginRateLimiter
from app.auth.service import AuthService
from app.errors import NotAuthenticated

SESSION_COOKIE = "epsilon_session"

SessionToken = Annotated[str | None, Cookie(alias=SESSION_COOKIE)]


def get_auth_service(request: Request) -> AuthService:
    return request.app.state.auth_service


def get_login_rate_limiter(request: Request) -> LoginRateLimiter:
    return request.app.state.login_rate_limiter


def require_session(
    auth: Annotated[AuthService, Depends(get_auth_service)], token: SessionToken = None
) -> None:
    if not auth.is_authenticated(token):
        raise NotAuthenticated()
