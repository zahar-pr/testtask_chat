"""Общее для тестов бэкенда: подставная модель и короткие действия с API."""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator, Sequence

from app.llm.base import ChatTurn, LLMError

ACCESS_KEY = "test-key_12345"


class FakeLLM:
    """Подставная модель: запоминает запросы и отдаёт заготовленный ответ по частям либо ошибку."""

    def __init__(self) -> None:
        self.calls: list[list[ChatTurn]] = []
        self.error: LLMError | None = None  # модель не ответила вовсе
        self.error_midway: LLMError | None = None  # ответ обрывается после первой части…
        self.error_midway_times = 99  # …столько раз подряд
        self.midway: Callable[[], None] | None = None  # что должно случиться, пока идёт ответ

    def stream(self, system_prompt: str, turns: Sequence[ChatTurn]) -> Iterator[str]:
        self.calls.append(list(turns))
        if self.error:
            raise self.error
        yield f"Ответ на «{turns[-1].text}»: "
        if self.midway:
            self.midway()
        if self.error_midway and self.error_midway_times > 0:
            self.error_midway_times -= 1
            raise self.error_midway
        yield "$x = 1$"


def sse_events(response) -> list[tuple[str, dict]]:
    """Разобрать тело ответа text/event-stream в список (событие, данные)."""
    events = []
    for block in response.text.strip().split("\n\n"):
        fields = dict(line.split(": ", 1) for line in block.split("\n"))
        events.append((fields["event"], json.loads(fields["data"])))
    return events


def ask(client, text: str, chat_id: int | None = None, mode: str | None = None, replace_last: bool = False):
    """Задать вопрос: в чате chat_id или, если он не указан, в новом чате."""
    path = "/api/chats" if chat_id is None else f"/api/chats/{chat_id}/messages"
    payload = {"text": text, "replace_last": replace_last}
    return client.post(path, json=payload if mode is None else {**payload, "mode": mode})


def done(response) -> dict:
    """Данные события done: сохранённые чат, вопрос и ответ."""
    name, data = sse_events(response)[-1]
    assert name == "done", (name, data)
    return data
