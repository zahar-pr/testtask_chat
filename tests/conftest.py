from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.helpers import ACCESS_KEY, FakeLLM


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
