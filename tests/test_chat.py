from __future__ import annotations

from datetime import datetime

from fastapi.testclient import TestClient

from app.llm.base import LLMError, LLMFailure
from app.main import create_app
from tests.conftest import sse_events


def test_send_streams_answer_then_stores_question_with_answer(authed, llm):
    response = authed.post("/api/messages", json={"text": "  Сколько будет 2+2?  "})

    assert response.status_code == 201
    assert response.headers["content-type"].startswith("text/event-stream")
    events = sse_events(response)
    assert [name for name, _ in events] == ["delta", "delta", "done"]
    body = events[-1][1]
    assert "".join(data["text"] for name, data in events if name == "delta") == body["assistant"]["text"]
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


def test_answer_cut_off_midway_ends_with_error_event_and_is_not_stored(authed, llm):
    llm.error_midway = LLMError(LLMFailure.UNAVAILABLE, "connection reset")

    response = authed.post("/api/messages", json={"text": "2+2?"})

    assert response.status_code == 201  # заголовки ушли до сбоя — об ошибке сообщает событие
    events = sse_events(response)
    # одна повторная попытка (reset), затем честная ошибка
    assert [name for name, _ in events] == ["delta", "reset", "delta", "error"]
    assert len(llm.calls) == 2
    assert events[-1][1]["code"] == "llm_unavailable"
    assert "reset" not in events[-1][1]["message"]
    assert authed.get("/api/messages").json()["messages"] == []


def test_answer_cut_off_once_is_restarted_and_stored(authed, llm):
    llm.error_midway = LLMError(LLMFailure.UNAVAILABLE, "stream closed")
    llm.error_midway_times = 1

    events = sse_events(authed.post("/api/messages", json={"text": "2+2?"}))

    assert [name for name, _ in events] == ["delta", "reset", "delta", "delta", "done"]
    history = authed.get("/api/messages").json()["messages"]
    assert [m["role"] for m in history] == ["user", "assistant"]
    assert history[1]["text"] == "Ответ на «2+2?»: $x = 1$"  # без обрывка первой попытки


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


def test_preset_mode_is_stored_and_shapes_the_request_to_the_model(authed, llm):
    events = sse_events(authed.post("/api/messages", json={"text": "дискриминант", "mode": "learn"}))
    authed.post("/api/messages", json={"text": "а попроще?"})

    assert events[-1][1]["user"] == events[-1][1]["user"] | {"text": "дискриминант", "mode": "learn"}
    history = authed.get("/api/messages").json()["messages"]
    assert [m["mode"] for m in history] == ["learn", None, None, None]
    # модель получает название режима — и для нового вопроса, и для вопросов из контекста
    assert llm.calls[0][-1].text == "Режим «Изучение с нуля». Тема: дискриминант"
    assert [t.text for t in llm.calls[1] if t.role == "user"] == [
        "Режим «Изучение с нуля». Тема: дискриминант", "а попроще?"]


def test_unknown_mode_is_rejected(authed, llm):
    assert authed.post("/api/messages", json={"text": "2+2", "mode": "hack"}).status_code == 422
    assert llm.calls == []


def test_database_created_before_presets_is_upgraded(settings, llm):
    import sqlite3

    from fastapi.testclient import TestClient as Client

    from tests.conftest import ACCESS_KEY

    old = sqlite3.connect(settings.database_path)
    old.executescript(
        "CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, "
        "text TEXT NOT NULL, created_at TEXT NOT NULL);"
        "INSERT INTO messages (role, text, created_at) VALUES ('user', 'старый вопрос', '2026-11-01T10:00:00.000+00:00');"
        "INSERT INTO messages (role, text, created_at) VALUES ('assistant', 'старый ответ', '2026-11-01T10:00:05.000+00:00');"
    )
    old.commit()
    old.close()

    client = Client(create_app(settings, llm))
    client.post("/api/auth/login", json={"access_key": ACCESS_KEY})
    history = client.get("/api/messages").json()["messages"]
    assert [(m["text"], m["mode"]) for m in history] == [("старый вопрос", None), ("старый ответ", None)]
    assert client.post("/api/messages", json={"text": "новый", "mode": "solve"}).status_code == 201


def test_clear_history(authed):
    authed.post("/api/messages", json={"text": "2+2?"})
    assert authed.delete("/api/messages").status_code == 204
    assert authed.get("/api/messages").json()["messages"] == []


def test_index_and_security_headers(client, authed):
    for response in (client.get("/"), authed.post("/api/messages", json={"text": "2+2?"})):
        assert response.status_code in (200, 201)
        assert "default-src 'self'" in response.headers["content-security-policy"]
    response = client.get("/")
    assert "default-src 'self'" in response.headers["content-security-policy"]
    assert response.headers["x-content-type-options"] == "nosniff"
