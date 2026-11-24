"""Защита на уровне HTTP: заголовки безопасности и запрет запросов с чужих сайтов.

Оба слоя работают с ASGI-сообщениями напрямую и не трогают тело ответа, поэтому не
задерживают потоковую выдачу ответа модели.
"""

from __future__ import annotations

import json
from urllib.parse import urlsplit

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.errors import error_body

SECURITY_HEADERS = {
    # Скрипты, стили и шрифты — только свои. 'unsafe-inline' для стилей нужен KaTeX:
    # он расставляет размеры и отступы в формулах через атрибут style.
    "Content-Security-Policy": (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; font-src 'self'; connect-src 'self'; "
        "frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    ),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
}

HSTS = "max-age=31536000"  # год: браузер не откроет этот адрес по незащищённому HTTP
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


class SecurityHeadersMiddleware:
    """Добавляет заголовки безопасности ко всем ответам."""

    def __init__(self, app: ASGIApp) -> None:
        self._app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self._app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in SECURITY_HEADERS.items():
                    headers.setdefault(name, value)
                if scope["scheme"] == "https":  # HSTS имеет смысл только там, где HTTPS уже есть
                    headers.setdefault("Strict-Transport-Security", HSTS)
            await send(message)

        await self._app(scope, receive, send_with_headers)


class SameOriginMiddleware:
    """Отклоняет изменяющие запросы, пришедшие с другого сайта.

    Основная защита от CSRF — cookie с SameSite=Strict; это второй рубеж на случай браузера,
    который SameSite не соблюдает. Браузер сам проставляет заголовок Origin, подделать его
    страница не может. Запросы без Origin (curl, тесты) не трогаем: у них нет чужой cookie.
    """

    def __init__(self, app: ASGIApp) -> None:
        self._app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["method"] not in SAFE_METHODS:
            headers = Headers(scope=scope)
            origin = headers.get("origin")
            if origin and urlsplit(origin).netloc != headers.get("host"):
                await _reject(send)
                return
        await self._app(scope, receive, send)


async def _reject(send: Send) -> None:
    body = json.dumps(
        error_body("cross_site_request", "Запрос с другого сайта отклонён."), ensure_ascii=False
    ).encode()
    await send({
        "type": "http.response.start",
        "status": 403,
        "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
    })
    await send({"type": "http.response.body", "body": body})
