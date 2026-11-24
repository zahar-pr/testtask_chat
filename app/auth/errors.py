from __future__ import annotations

from app.errors import AppError


class NotAuthenticated(AppError):
    status_code = 401
    code = "not_authenticated"
    message = "Требуется вход по ключу доступа."


class InvalidAccessKey(AppError):
    status_code = 401
    code = "invalid_access_key"
    message = "Неверный ключ доступа."


class TooManyLoginAttempts(AppError):
    status_code = 429
    code = "too_many_attempts"

    def __init__(self, retry_after_seconds: int) -> None:
        minutes = max(1, round(retry_after_seconds / 60))
        super().__init__(
            f"Слишком много попыток. Попробуйте снова через {minutes} мин.",
            headers={"Retry-After": str(retry_after_seconds)},
        )
