from __future__ import annotations

from app.errors import AppError


class TrainerNotFound(AppError):
    status_code = 404
    code = "trainer_not_found"
    message = "Ответ с этим тренажёром не найден. Возможно, чат был удалён."
