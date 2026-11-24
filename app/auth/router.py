"""HTTP-эндпоинты входа и выхода."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status

from app.auth.dependencies import (
    SESSION_COOKIE,
    SessionToken,
    cookie_must_be_secure,
    get_auth_service,
    get_login_rate_limiter,
)
from app.auth.errors import TooManyLoginAttempts
from app.auth.rate_limit import LoginRateLimiter
from app.auth.schemas import LoginRequest
from app.auth.service import AuthService

router = APIRouter(prefix="/api/auth", tags=["auth"])

Auth = Annotated[AuthService, Depends(get_auth_service)]


@router.post("/login", status_code=status.HTTP_204_NO_CONTENT)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    auth: Auth,
    limiter: Annotated[LoginRateLimiter, Depends(get_login_rate_limiter)],
    secure: Annotated[bool, Depends(cookie_must_be_secure)],
) -> None:
    # Адрес клиента берётся из соединения; за обратным прокси его подставляет uvicorn
    # из X-Forwarded-For — но только от прокси из списка TRUSTED_PROXIES.
    client = request.client.host if request.client else "unknown"
    if wait_seconds := limiter.attempt(client):
        raise TooManyLoginAttempts(wait_seconds)

    session = auth.login(payload.access_key)  # неверный ключ — InvalidAccessKey, попытка уже учтена
    limiter.forgive(client)

    # Ключ доступа в браузере не остаётся: дальше запросы подтверждает случайный токен сессии
    # в cookie, недоступной для JavaScript (HttpOnly) и для чужих сайтов (SameSite=Strict).
    response.set_cookie(
        SESSION_COOKIE,
        session.token,
        max_age=session.max_age_seconds,
        httponly=True,
        samesite="strict",
        secure=secure,
        path="/",
    )


@router.get("/session")
def session_status(auth: Auth, token: SessionToken = None) -> dict[str, bool]:
    """По этому ответу фронтенд выбирает экран: сам он cookie сессии прочитать не может."""
    return {"authenticated": auth.is_authenticated(token)}


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response, auth: Auth, token: SessionToken = None) -> None:
    auth.logout(token)
    response.delete_cookie(SESSION_COOKIE, path="/")
