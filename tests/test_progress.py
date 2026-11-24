from __future__ import annotations

from tests.conftest import ask, done


def attempt(
    client, task: int, outcome: str, *, message_id: int = 10, topic: str = "Проценты", question: str | None = None
):
    return client.post("/api/progress/attempts", json={
        "message_id": message_id, "block": 0, "task": task, "topic": topic,
        "question": question or f"Задание {task}", "outcome": outcome,
    })


def test_progress_requires_session(client):
    assert client.get("/api/progress").status_code == 401
    assert attempt(client, 0, "first").status_code == 401


def test_summary_counts_outcomes_topics_and_mistakes(authed):
    assert authed.get("/api/progress").json() == {
        "totals": {"first": 0, "solved": 0, "revealed": 0}, "topics": [], "mistakes": []}

    assert attempt(authed, 0, "first").status_code == 204
    attempt(authed, 1, "solved")
    attempt(authed, 2, "revealed", question="Найдите $20\\%$ от 150")
    attempt(authed, 0, "first", message_id=11, topic="Дроби")

    summary = authed.get("/api/progress").json()
    assert summary["totals"] == {"first": 2, "solved": 1, "revealed": 1}
    assert {(t["topic"], t["tasks"], t["first"]) for t in summary["topics"]} == {("Проценты", 3, 1), ("Дроби", 1, 1)}
    assert [(m["question"], m["outcome"]) for m in summary["mistakes"]] == [
        ("Найдите $20\\%$ от 150", "revealed"), ("Задание 1", "solved")]


def test_repeating_a_task_replaces_its_result(authed):
    attempt(authed, 0, "revealed")
    attempt(authed, 0, "first")  # прошли тот же тренажёр ещё раз

    summary = authed.get("/api/progress").json()
    assert summary["totals"] == {"first": 1, "solved": 0, "revealed": 0}
    assert summary["mistakes"] == []


def test_invalid_attempt_is_rejected(authed):
    assert attempt(authed, 0, "cheated").status_code == 422
    assert attempt(authed, 0, "first", topic="").status_code == 422


def test_reset_clears_progress(authed):
    attempt(authed, 0, "solved")
    assert authed.delete("/api/progress").status_code == 204
    assert authed.get("/api/progress").json()["mistakes"] == []


def test_review_mode_gives_the_model_recent_mistakes(authed, llm):
    attempt(authed, 0, "first", question="лёгкое")
    attempt(authed, 1, "revealed", question="Найдите 15% от 80")
    attempt(authed, 2, "solved", topic="Дроби", question="Сложите 1/2 и 1/3")

    body = done(ask(authed, "Потренируй меня на моих ошибках", mode="review"))

    assert (body["user"]["text"], body["user"]["mode"]) == ("Потренируй меня на моих ошибках", "review")
    request = llm.calls[-1][-1].text
    assert request.startswith("Режим «Работа над ошибками». Потренируй меня на моих ошибках")
    assert "[Дроби] Сложите 1/2 и 1/3" in request and "[Проценты] Найдите 15% от 80" in request
    assert "лёгкое" not in request  # решённое с первой попытки в повторение не идёт


def test_review_without_mistakes_is_refused_before_calling_the_model(authed, llm):
    response = ask(authed, "Потренируй меня на моих ошибках", mode="review")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "nothing_to_review"
    assert llm.calls == []
