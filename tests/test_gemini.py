from __future__ import annotations

import json

import httpx
import pytest

from app.llm.base import ChatTurn, LLMError, LLMFailure
from app.llm.gemini import GeminiClient

TURNS = [ChatTurn("user", "2+2?"), ChatTurn("assistant", "4"), ChatTurn("user", "а 3+3?")]


def make_client(handler, models=("primary", "backup")) -> GeminiClient:
    return GeminiClient("secret", models, http_client=httpx.Client(transport=httpx.MockTransport(handler)))


def sse(*events: dict) -> httpx.Response:
    body = "".join(f"data: {json.dumps(event, ensure_ascii=False)}\r\n\r\n" for event in events)
    return httpx.Response(200, content=body.encode(), headers={"content-type": "text/event-stream"})


def part(text: str, **extra) -> dict:
    return {"candidates": [{"content": {"parts": [{"text": text, **extra}]}}]}


def answer(client: GeminiClient) -> str:
    return "".join(client.stream("p", TURNS))


def test_sends_prompt_history_and_key_in_header():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["key"] = request.headers["x-goog-api-key"]
        seen["body"] = json.loads(request.content)
        return sse(part("6"))

    assert "".join(make_client(handler).stream("Ты математик", TURNS)) == "6"
    assert "/models/primary:streamGenerateContent" in seen["url"] and "secret" not in seen["url"]
    assert seen["key"] == "secret"
    assert seen["body"]["system_instruction"]["parts"][0]["text"] == "Ты математик"
    assert [c["role"] for c in seen["body"]["contents"]] == ["user", "model", "user"]


def test_yields_answer_in_parts_and_skips_model_thoughts():
    def handler(request: httpx.Request) -> httpx.Response:
        return sse(part("черновик рассуждений", thought=True), part("x = "), part("3"),
                   {"candidates": [{"finishReason": "STOP"}]})

    assert list(make_client(handler).stream("p", TURNS)) == ["x = ", "3"]


def test_falls_back_to_next_model_when_primary_is_overloaded():
    asked = []

    def handler(request: httpx.Request) -> httpx.Response:
        asked.append(request.url.path.split("/")[-1].split(":")[0])
        if "primary" in request.url.path:
            return httpx.Response(503, json={"error": {"message": "overloaded"}})
        return sse(part("ответ запасной модели"))

    assert answer(make_client(handler)) == "ответ запасной модели"
    assert asked == ["primary", "backup"]


def test_no_fallback_once_answer_has_started():
    asked = []

    def handler(request: httpx.Request) -> httpx.Response:
        asked.append(request.url.path)
        body = f"data: {json.dumps(part('начало'))}\n\ndata: это не JSON\n\n"
        return httpx.Response(200, content=body.encode())

    stream = make_client(handler).stream("p", TURNS)
    assert next(stream) == "начало"
    with pytest.raises(LLMError) as caught:
        next(stream)
    assert caught.value.failure is LLMFailure.UNAVAILABLE
    assert len(asked) == 1  # продолжение от другой модели к начатому ответу не приклеиваем


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
        answer(make_client(handler))
    assert caught.value.failure is failure
    assert len(calls) == attempts  # с неверным ключом запасную модель не дёргаем


def test_timeout_and_blocked_answer():
    def timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    with pytest.raises(LLMError) as caught:
        answer(make_client(timeout))
    assert caught.value.failure is LLMFailure.TIMEOUT

    def blocked(request: httpx.Request) -> httpx.Response:
        return sse({"promptFeedback": {"blockReason": "SAFETY"}})

    with pytest.raises(LLMError) as caught:
        answer(make_client(blocked))
    assert caught.value.failure is LLMFailure.NO_ANSWER
    assert "SAFETY" in str(caught.value)
