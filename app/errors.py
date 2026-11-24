"""Ошибки приложения и их единый JSON-формат: {"error": {"code", "message"}}."""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.llm.base import LLMError, LLMFailure

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


class NotAuthenticated(AppError):
    status_code = 401
    code = "not_authenticated"
    message = "Требуется вход по ключу доступа."


class InvalidAccessKey(AppError):
    status_code = 401
    code = "invalid_access_key"
    message = "Неверный ключ доступа."


class ChatNotFound(AppError):
    status_code = 404
    code = "chat_not_found"
    message = "Чат не найден. Возможно, он был удалён."


class NothingToReplace(AppError):
    status_code = 409
    code = "nothing_to_replace"
    message = "В этом чате ещё нет вопроса, который можно заменить."


class TooManyLoginAttempts(AppError):
    status_code = 429
    code = "too_many_attempts"

    def __init__(self, retry_after_seconds: int) -> None:
        minutes = max(1, round(retry_after_seconds / 60))
        super().__init__(
            f"Слишком много попыток. Попробуйте снова через {minutes} мин.",
            headers={"Retry-After": str(retry_after_seconds)},
        )


# Как сбои языковой модели выглядят для пользователя. Подробности — только в логах.
_LLM_RESPONSES: dict[LLMFailure, tuple[int, str]] = {
    LLMFailure.RATE_LIMITED: (503, "Модель сейчас перегружена запросами. Попробуйте через минуту."),
    LLMFailure.UNAVAILABLE: (502, "Модель временно недоступна. Попробуйте ещё раз чуть позже."),
    LLMFailure.TIMEOUT: (504, "Модель не успела ответить. Попробуйте ещё раз."),
    LLMFailure.MISCONFIGURED: (502, "Сервис ответов настроен неверно. Сообщите администратору."),
    LLMFailure.NO_ANSWER: (502, "Модель не смогла ответить на этот вопрос. Попробуйте переформулировать."),
}


def describe_llm_error(error: LLMError) -> tuple[int, str, str]:
    """HTTP-статус, код и текст для пользователя по сбою модели."""
    status_code, message = _LLM_RESPONSES[error.failure]
    return status_code, f"llm_{error.failure.value}", message


def _error_response(status_code: int, code: str, message: str, headers: dict[str, str] | None = None) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status_code, headers=headers)


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(_: Request, error: AppError) -> JSONResponse:
        return _error_response(error.status_code, error.code, error.message, error.headers)

    @app.exception_handler(LLMError)
    async def handle_llm_error(_: Request, error: LLMError) -> JSONResponse:
        logger.warning("Сбой языковой модели (%s): %s", error.failure.value, error)
        status_code, code, message = describe_llm_error(error)
        return _error_response(status_code, code, message)

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(_: Request, error: RequestValidationError) -> JSONResponse:
        first = error.errors()[0] if error.errors() else {}
        message = str(first.get("msg", "Некорректный запрос.")).removeprefix("Value error, ")
        return _error_response(422, "validation_error", message)

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(_: Request, error: StarletteHTTPException) -> JSONResponse:
        return _error_response(error.status_code, "http_error", str(error.detail), getattr(error, "headers", None))

    @app.exception_handler(Exception)
    async def handle_unexpected(_: Request, error: Exception) -> JSONResponse:
        logger.exception("Необработанная ошибка", exc_info=error)
        return _error_response(500, AppError.code, AppError.message)
