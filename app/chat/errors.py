from __future__ import annotations

from app.errors import AppError
from app.llm.base import LLMError, LLMFailure


class ChatNotFound(AppError):
    status_code = 404
    code = "chat_not_found"
    message = "Чат не найден. Возможно, он был удалён."


class ChatChanged(AppError):
    """Заменить последнюю пару не вышло: пока шёл ответ, в чате появились другие сообщения."""

    status_code = 409
    code = "chat_changed"
    message = "Чат изменился в другой вкладке. Обновите страницу и попробуйте ещё раз."


class NothingToReview(AppError):
    status_code = 409
    code = "nothing_to_review"
    message = "Ошибок пока нет: сначала пройдите тренажёр."


# Как сбои языковой модели выглядят для пользователя. Подробности — только в логах.
_MODEL_FAILURES: dict[LLMFailure, tuple[int, str]] = {
    LLMFailure.RATE_LIMITED: (503, "Модель сейчас перегружена запросами. Попробуйте через минуту."),
    LLMFailure.UNAVAILABLE: (502, "Модель временно недоступна. Попробуйте ещё раз чуть позже."),
    LLMFailure.TIMEOUT: (504, "Модель не успела ответить. Попробуйте ещё раз."),
    LLMFailure.MISCONFIGURED: (502, "Сервис ответов настроен неверно. Сообщите администратору."),
    LLMFailure.NO_ANSWER: (502, "Модель не смогла ответить на этот вопрос. Попробуйте переформулировать."),
    LLMFailure.TRUNCATED: (502, "Ответ получился слишком длинным и оборвался. Попросите короче или по частям."),
    LLMFailure.BLOCKED: (502, "Модель отказалась отвечать на этот вопрос. Попробуйте переформулировать."),
}


class ModelFailed(AppError):
    """Сбой языковой модели в том виде, в каком его видит пользователь."""

    def __init__(self, error: LLMError) -> None:
        self.status_code, message = _MODEL_FAILURES[error.failure]
        self.code = f"llm_{error.failure.value}"
        super().__init__(message)
