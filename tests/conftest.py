from __future__ import annotations

import json
from collections.abc import Iterator, Sequence

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.llm.base import ChatTurn, LLMError
from app.main import create_app

ACCESS_KEY = "test-key_12345"


class FakeLLM:
    """Подставная модель: запоминает запросы и отдаёт заготовленный ответ по частям либо ошибку."""

    def __init__(self) -> None:
        self.calls: list[list[ChatTurn]] = []
        self.error: LLMError | None = None  # модель не ответила вовсе
        self.error_midway: LLMError | None = None  # ответ обрывается после первой части…
        self.error_midway_times = 99  # …столько раз подряд

    def stream(self, system_prompt: str, turns: Sequence[ChatTurn]) -> Iterator[str]:
        self.calls.append(list(turns))
        if self.error:
            raise self.error
        yield f"Ответ на «{turns[-1].text}»: "
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


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(
        _env_file=None,
        access_key=ACCESS_KEY,
        gemini_api_key="unused",
        database_path=tmp_path / "chat.sqlite3",
        login_max_attempts=3,
        context_exchanges=2,
    )


@pytest.fixture
def llm() -> FakeLLM:
    return FakeLLM()


@pytest.fixture
def client(settings, llm) -> TestClient:
    return TestClient(create_app(settings, llm))


@pytest.fixture
def authed(client) -> TestClient:
    response = client.post("/api/auth/login", json={"access_key": ACCESS_KEY})
    assert response.status_code == 204
    return client
