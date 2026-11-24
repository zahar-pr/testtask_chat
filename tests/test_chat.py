from __future__ import annotations

import sqlite3
from datetime import datetime

from fastapi.testclient import TestClient

from app.llm.base import LLMError, LLMFailure
from app.main import create_app
from tests.conftest import ACCESS_KEY, ask, done, sse_events


def chats(client) -> list[dict]:
    return client.get("/api/chats").json()["chats"]


def history(client, chat_id: int) -> list[dict]:
    return client.get(f"/api/chats/{chat_id}/messages").json()["messages"]


# --- Вопрос и ответ ---


def test_first_question_streams_answer_and_creates_a_saved_chat(authed, llm):
    assert chats(authed) == []

    response = ask(authed, "  Сколько будет 2+2?  ")

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

    assert body["chat"]["title"] == "Сколько будет 2+2?"
    assert chats(authed) == [body["chat"]]
    assert history(authed, body["chat"]["id"]) == [body["user"], body["assistant"]]


def test_empty_and_too_long_messages_are_rejected(authed, llm):
    for text in ["", "   \n\t ", "я" * 501]:
        assert ask(authed, text).status_code == 422, repr(text[:10])
    assert ask(authed, "я" * 500).status_code == 201
    assert len(llm.calls) == 1


def test_llm_failure_is_reported_and_no_chat_appears(authed, llm):
    llm.error = LLMError(LLMFailure.RATE_LIMITED, "429 quota")

    response = ask(authed, "2+2?")

    assert response.status_code == 503
    error = response.json()["error"]
    assert error["code"] == "llm_rate_limited"
    assert "quota" not in error["message"]  # внутренние подробности наружу не уходят
    assert chats(authed) == []


def test_answer_cut_off_midway_ends_with_error_event_and_is_not_stored(authed, llm):
    chat_id = done(ask(authed, "первый вопрос"))["chat"]["id"]
    llm.error_midway = LLMError(LLMFailure.UNAVAILABLE, "connection reset")

    response = ask(authed, "2+2?", chat_id)

    assert response.status_code == 201  # заголовки ушли до сбоя — об ошибке сообщает событие
    events = sse_events(response)
    # одна повторная попытка (reset), затем честная ошибка
    assert [name for name, _ in events] == ["delta", "reset", "delta", "error"]
    assert events[-1][1]["code"] == "llm_unavailable"
    assert "reset" not in events[-1][1]["message"]
    assert len(history(authed, chat_id)) == 2


def test_answer_cut_off_once_is_restarted_and_stored(authed, llm):
    llm.error_midway = LLMError(LLMFailure.UNAVAILABLE, "stream closed")
    llm.error_midway_times = 1

    events = sse_events(ask(authed, "2+2?"))

    assert [name for name, _ in events] == ["delta", "reset", "delta", "delta", "done"]
    messages = history(authed, events[-1][1]["chat"]["id"])
    assert [m["role"] for m in messages] == ["user", "assistant"]
    assert messages[1]["text"] == "Ответ на «2+2?»: $x = 1$"  # без обрывка первой попытки


# --- Несколько чатов ---


def test_chats_are_separate_and_listed_by_recent_activity(authed, llm):
    first = done(ask(authed, "про дроби"))["chat"]
    second = done(ask(authed, "про проценты"))["chat"]
    assert [c["id"] for c in chats(authed)] == [second["id"], first["id"]]

    done(ask(authed, "ещё про дроби", first["id"]))

    assert [c["id"] for c in chats(authed)] == [first["id"], second["id"]]  # активный чат поднялся
    assert [m["text"] for m in history(authed, first["id"]) if m["role"] == "user"] == ["про дроби", "ещё про дроби"]
    assert [m["text"] for m in history(authed, second["id"]) if m["role"] == "user"] == ["про проценты"]
    assert chats(authed)[0]["title"] == "про дроби"  # название — первый вопрос, дальше не меняется


def test_model_context_is_limited_and_comes_only_from_the_same_chat(authed, llm):
    other = done(ask(authed, "чужой вопрос"))["chat"]["id"]
    chat_id = done(ask(authed, "вопрос 0"))["chat"]["id"]
    for number in range(1, 4):
        ask(authed, f"вопрос {number}", chat_id)

    turns = llm.calls[-1]
    # context_exchanges=2 → две предыдущие пары этого чата и текущий вопрос
    assert [t.text for t in turns if t.role == "user"] == ["вопрос 1", "вопрос 2", "вопрос 3"]
    assert [t.role for t in turns] == ["user", "assistant", "user", "assistant", "user"]
    assert other != chat_id


def test_long_first_question_becomes_a_short_title(authed):
    chat = done(ask(authed, "Очень   длинный вопрос\nв две строки " + "и ещё слова " * 10))["chat"]
    assert len(chat["title"]) <= 60 and chat["title"].endswith("…")
    assert chat["title"].startswith("Очень длинный вопрос в две строки")


def test_delete_chat_removes_it_with_messages(authed, llm):
    keep = done(ask(authed, "оставить"))["chat"]["id"]
    drop = done(ask(authed, "удалить"))["chat"]["id"]

    assert authed.delete(f"/api/chats/{drop}").status_code == 204

    assert [c["id"] for c in chats(authed)] == [keep]
    assert authed.get(f"/api/chats/{drop}/messages").status_code == 404
    assert len(history(authed, keep)) == 2


def test_unknown_chat_is_404_and_model_is_not_called(authed, llm):
    for response in (authed.get("/api/chats/999/messages"), ask(authed, "2+2", chat_id=999)):
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "chat_not_found"
    assert llm.calls == []


def test_chats_survive_restart(authed, settings, llm):
    chat = done(ask(authed, "Что такое предел?"))["chat"]

    restarted = TestClient(create_app(settings, llm))
    restarted.cookies.set("epsilon_session", authed.cookies.get("epsilon_session"))
    assert chats(restarted) == [chat]
    assert history(restarted, chat["id"])[0]["text"] == "Что такое предел?"


# --- «Ответить заново» и правка последнего вопроса ---


def test_replace_last_swaps_the_last_pair_and_hides_it_from_the_model(authed, llm):
    chat_id = done(ask(authed, "первый"))["chat"]["id"]
    ask(authed, "второй", chat_id)

    body = done(ask(authed, "второй, исправленный", chat_id, replace_last=True))

    assert [m["text"] for m in history(authed, chat_id) if m["role"] == "user"] == ["первый", "второй, исправленный"]
    assert history(authed, chat_id)[-2:] == [body["user"], body["assistant"]]
    assert [t.text for t in llm.calls[-1] if t.role == "user"] == ["первый", "второй, исправленный"]
    assert chats(authed)[0]["title"] == "первый"


def test_replacing_the_only_question_renames_the_chat(authed, llm):
    chat_id = done(ask(authed, "опечатка в вапросе"))["chat"]["id"]

    body = done(ask(authed, "вопрос без опечатки", chat_id, replace_last=True))

    assert body["chat"]["title"] == "вопрос без опечатки"
    assert len(history(authed, chat_id)) == 2
    assert [t.text for t in llm.calls[-1]] == ["вопрос без опечатки"]


def test_failed_replacement_keeps_the_old_pair(authed, llm):
    old = done(ask(authed, "вопрос"))
    llm.error = LLMError(LLMFailure.UNAVAILABLE, "down")

    assert ask(authed, "вопрос", old["chat"]["id"], replace_last=True).status_code == 502

    assert history(authed, old["chat"]["id"]) == [old["user"], old["assistant"]]


# --- Заготовки ---


def test_preset_mode_is_stored_and_shapes_the_request_to_the_model(authed, llm):
    body = done(ask(authed, "дискриминант", mode="learn"))
    ask(authed, "а попроще?", body["chat"]["id"])

    assert (body["user"]["text"], body["user"]["mode"]) == ("дискриминант", "learn")
    assert [m["mode"] for m in history(authed, body["chat"]["id"])] == ["learn", None, None, None]
    # модель получает название режима — и для нового вопроса, и для вопросов из контекста
    assert llm.calls[0][-1].text == "Режим «Изучение с нуля». Тема: дискриминант"
    assert [t.text for t in llm.calls[1] if t.role == "user"] == [
        "Режим «Изучение с нуля». Тема: дискриминант", "а попроще?"]


def test_unknown_mode_is_rejected(authed, llm):
    assert authed.post("/api/chats", json={"text": "2+2", "mode": "hack"}).status_code == 422
    assert llm.calls == []


# --- Обновление базы и прочее ---


def test_database_from_single_chat_version_becomes_a_saved_chat(settings, llm):
    old = sqlite3.connect(settings.database_path)
    old.executescript(
        "CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, "
        "text TEXT NOT NULL, created_at TEXT NOT NULL);"
        "INSERT INTO messages (role, text, created_at) VALUES ('user', 'старый вопрос', '2026-11-01T10:00:00.000+00:00');"
        "INSERT INTO messages (role, text, created_at) VALUES ('assistant', 'старый ответ', '2026-11-01T10:00:05.000+00:00');"
    )
    old.commit()
    old.close()

    client = TestClient(create_app(settings, llm))
    client.post("/api/auth/login", json={"access_key": ACCESS_KEY})

    [chat] = chats(client)
    assert chat["title"] == "старый вопрос"
    assert [(m["text"], m["mode"]) for m in history(client, chat["id"])] == [("старый вопрос", None), ("старый ответ", None)]
    assert ask(client, "новый", chat["id"], mode="solve").status_code == 201
    # повторный запуск ничего не дублирует
    again = TestClient(create_app(settings, llm))
    again.cookies.set("epsilon_session", client.cookies.get("epsilon_session"))
    assert [c["id"] for c in chats(again)] == [chat["id"]]


def test_index_and_security_headers(client, authed):
    for response in (client.get("/"), ask(authed, "2+2?")):
        assert response.status_code in (200, 201)
        assert "default-src 'self'" in response.headers["content-security-policy"]
    response = client.get("/")
    assert response.headers["x-content-type-options"] == "nosniff"
