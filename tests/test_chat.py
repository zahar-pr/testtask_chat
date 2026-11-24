from __future__ import annotations

from datetime import datetime

from fastapi.testclient import TestClient

from app.llm.base import LLMError, LLMFailure
from app.main import create_app


def test_send_returns_and_stores_question_with_answer(authed, llm):
    response = authed.post("/api/messages", json={"text": "  Сколько будет 2+2?  "})

    assert response.status_code == 201
    body = response.json()
    assert body["user"]["text"] == "Сколько будет 2+2?"
    assert body["assistant"]["role"] == "assistant" and "$x = 1$" in body["assistant"]["text"]
    for message in (body["user"], body["assistant"]):
        assert datetime.fromisoformat(message["created_at"].replace("Z", "+00:00")).tzinfo is not None

    history = authed.get("/api/messages").json()["messages"]
    assert [m["role"] for m in history] == ["user", "assistant"]
    assert history == [body["user"], body["assistant"]]


def test_empty_and_too_long_messages_are_rejected(authed, llm):
    for text in ["", "   \n\t ", "я" * 501]:
        response = authed.post("/api/messages", json={"text": text})
        assert response.status_code == 422, repr(text[:10])
    assert authed.post("/api/messages", json={"text": "я" * 500}).status_code == 201
    assert len(llm.calls) == 1


def test_llm_failure_is_reported_and_leaves_history_untouched(authed, llm):
    llm.error = LLMError(LLMFailure.RATE_LIMITED, "429 quota")

    response = authed.post("/api/messages", json={"text": "2+2?"})

    assert response.status_code == 503
    error = response.json()["error"]
    assert error["code"] == "llm_rate_limited"
    assert "quota" not in error["message"]  # внутренние подробности наружу не уходят
    assert authed.get("/api/messages").json()["messages"] == []


def test_history_survives_restart(authed, settings, llm):
    authed.post("/api/messages", json={"text": "Что такое предел?"})

    restarted = TestClient(create_app(settings, llm))
    restarted.cookies.set("epsilon_session", authed.cookies.get("epsilon_session"))
    history = restarted.get("/api/messages").json()["messages"]
    assert [m["text"] for m in history][0] == "Что такое предел?"


def test_model_receives_limited_context(authed, llm):
    for number in range(4):
        authed.post("/api/messages", json={"text": f"вопрос {number}"})

    turns = llm.calls[-1]
    # context_exchanges=2 → две предыдущие пары и текущий вопрос
    assert [t.text for t in turns if t.role == "user"] == ["вопрос 1", "вопрос 2", "вопрос 3"]
    assert [t.role for t in turns] == ["user", "assistant", "user", "assistant", "user"]


def test_clear_history(authed):
    authed.post("/api/messages", json={"text": "2+2?"})
    assert authed.delete("/api/messages").status_code == 204
    assert authed.get("/api/messages").json()["messages"] == []


def test_index_and_security_headers(client):
    response = client.get("/")
    assert response.status_code == 200
    assert "default-src 'self'" in response.headers["content-security-policy"]
    assert response.headers["x-content-type-options"] == "nosniff"
