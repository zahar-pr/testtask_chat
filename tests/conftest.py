from __future__ import annotations

from collections.abc import Sequence

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.llm.base import ChatTurn, LLMError
from app.main import create_app

ACCESS_KEY = "test-key_12345"


class FakeLLM:
    """Подставная модель: запоминает запросы и отвечает заготовкой либо ошибкой."""

    def __init__(self) -> None:
        self.calls: list[list[ChatTurn]] = []
        self.error: LLMError | None = None

    def generate(self, system_prompt: str, turns: Sequence[ChatTurn]) -> str:
        self.calls.append(list(turns))
        if self.error:
            raise self.error
        return f"Ответ на «{turns[-1].text}»: $x = 1$"


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
