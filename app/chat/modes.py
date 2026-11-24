"""Заготовки — готовые режимы запроса: «изучить тему с нуля», «потренироваться» и т. д.

Пользователь выбирает заготовку и пишет только суть (тему или условие). Здесь описано, как
такой запрос формулируется для модели; что делать в каждом режиме, сказано в системном промпте
(prompt.py). Названия, описания и примеры для интерфейса лежат в static/js/modes.js —
идентификаторы режимов там и здесь должны совпадать.
"""

from __future__ import annotations

from typing import Literal, get_args

ModeId = Literal["learn", "solve", "practice", "visual", "check", "summary", "review"]

_REQUESTS: dict[str, str] = {
    "learn": "Режим «Изучение с нуля». Тема: {text}",
    "solve": "Режим «Решение задачи». Задача: {text}",
    "practice": "Режим «Тренировка». Тема: {text}",
    "visual": "Режим «Наглядное объяснение». Что показать: {text}",
    "check": "Режим «Проверка решения». Задача и моё решение: {text}",
    "summary": "Режим «Шпаргалка». Тема: {text}",
    "review": "Режим «Работа над ошибками». {text}",
}
assert set(_REQUESTS) == set(get_args(ModeId))


REVIEW = "review"


def as_model_input(text: str, mode: str | None) -> str:
    """Сообщение пользователя в том виде, в каком его получит модель."""
    template = _REQUESTS.get(mode or "")
    return template.format(text=text) if template else text


def review_request(text: str, mistakes: list[tuple[str, str]]) -> str:
    """Запрос «работа над ошибками»: к словам пользователя добавляются задания, где он ошибся.

    mistakes — пары (тема, текст задания) из сохранённого прогресса.
    """
    listed = "\n".join(f"{number}. [{topic}] {question}" for number, (topic, question) in enumerate(mistakes, 1))
    return f"{as_model_input(text, REVIEW)}\nЗадания, в которых ученик ошибся:\n{listed}"
