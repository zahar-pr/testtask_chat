"""Основа для ошибок приложения и их единый JSON-формат: {"error": {"code", "message"}}.

Сами ошибки объявлены рядом с тем, к чему относятся: app/auth/errors.py, app/chat/errors.py,
app/progress/errors.py. Этот модуль ничего не знает о конкретных возможностях.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)


class AppError(Exception):
    """Ожидаемая ошибка с понятным пользователю сообщением."""

    status_code = 500
    code = "internal_error"
    message = "Что-то пошло не так. Попробуйте ещё раз."

    def __init__(self, message: str | None = None, *, headers: dict[str, str] | None = None) -> None:
        super().__init__(message or self.message)
        if message:
            self.message = message
        self.headers = headers


def error_body(code: str, message: str) -> dict:
    return {"error": {"code": code, "message": message}}


def _response(status_code: int, code: str, message: str, headers: dict[str, str] | None = None) -> JSONResponse:
    return JSONResponse(error_body(code, message), status_code=status_code, headers=headers)


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(_: Request, error: AppError) -> JSONResponse:
        return _response(error.status_code, error.code, error.message, error.headers)

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(_: Request, error: RequestValidationError) -> JSONResponse:
        first = error.errors()[0] if error.errors() else {}
        message = str(first.get("msg", "Некорректный запрос.")).removeprefix("Value error, ")
        return _response(422, "validation_error", message)

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(_: Request, error: StarletteHTTPException) -> JSONResponse:
        return _response(error.status_code, "http_error", str(error.detail), getattr(error, "headers", None))

    @app.exception_handler(Exception)
    async def handle_unexpected(_: Request, error: Exception) -> JSONResponse:
        logger.exception("Необработанная ошибка", exc_info=error)
        return _response(500, AppError.code, AppError.message)
