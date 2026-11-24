from __future__ import annotations

import json

import httpx
import pytest

from app.llm.base import ChatTurn, LLMError, LLMFailure
from app.llm.gemini import GeminiClient

TURNS = [ChatTurn("user", "2+2?"), ChatTurn("assistant", "4"), ChatTurn("user", "а 3+3?")]


def make_client(handler, models=("primary", "backup")) -> GeminiClient:
    return GeminiClient("secret", models, http_client=httpx.Client(transport=httpx.MockTransport(handler)))


def ok(text: str) -> httpx.Response:
    return httpx.Response(200, json={"candidates": [{"content": {"parts": [
        {"text": "черновик рассуждений", "thought": True}, {"text": text}]}, "finishReason": "STOP"}]})


def test_sends_prompt_history_and_key_in_header():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["key"] = request.headers["x-goog-api-key"]
        seen["body"] = json.loads(request.content)
        return ok("6")

    assert make_client(handler).generate("Ты математик", TURNS) == "6"
    assert seen["url"].endswith("/models/primary:generateContent") and "secret" not in seen["url"]
    assert seen["key"] == "secret"
    assert seen["body"]["system_instruction"]["parts"][0]["text"] == "Ты математик"
    assert [c["role"] for c in seen["body"]["contents"]] == ["user", "model", "user"]


def test_falls_back_to_next_model_when_primary_is_overloaded():
    asked = []

    def handler(request: httpx.Request) -> httpx.Response:
        asked.append(request.url.path.split("/")[-1])
        if "primary" in request.url.path:
            return httpx.Response(503, json={"error": {"message": "overloaded"}})
        return ok("ответ запасной модели")

    assert make_client(handler).generate("p", TURNS) == "ответ запасной модели"
    assert asked == ["primary:generateContent", "backup:generateContent"]


@pytest.mark.parametrize(
    ("status", "failure", "attempts"),
    [(429, LLMFailure.RATE_LIMITED, 2), (500, LLMFailure.UNAVAILABLE, 2), (403, LLMFailure.MISCONFIGURED, 1)],
)
def test_http_errors_are_classified(status, failure, attempts):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(status, json={"error": {"message": "nope"}})

    with pytest.raises(LLMError) as caught:
        make_client(handler).generate("p", TURNS)
    assert caught.value.failure is failure
    assert len(calls) == attempts  # с неверным ключом запасную модель не дёргаем


def test_timeout_and_blocked_answer():
    def timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    with pytest.raises(LLMError) as caught:
        make_client(timeout).generate("p", TURNS)
    assert caught.value.failure is LLMFailure.TIMEOUT

    def blocked(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"promptFeedback": {"blockReason": "SAFETY"}})

    with pytest.raises(LLMError) as caught:
        make_client(blocked).generate("p", TURNS)
    assert caught.value.failure is LLMFailure.NO_ANSWER
