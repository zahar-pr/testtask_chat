from __future__ import annotations

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.auth.rate_limit import LoginRateLimiter
from app.auth.service import AuthService
from app.auth.sessions import SessionRepository
from app.clock import utc_now
from app.config import Settings
from app.db import Database
from app.main import create_app
from app.migrations import MIGRATIONS
from tests.helpers import ACCESS_KEY


def test_protected_endpoints_require_session(client):
    for method, path in [("GET", "/api/chats"), ("POST", "/api/chats"), ("GET", "/api/chats/1/messages"),
                         ("POST", "/api/chats/1/messages"), ("DELETE", "/api/chats/1")]:
        response = client.request(method, path, json={"text": "2+2"} if method == "POST" else None)
        assert response.status_code == 401, (method, path)
        assert response.json()["error"]["code"] == "not_authenticated"
    assert client.get("/api/auth/session").json() == {"authenticated": False}


def test_login_sets_http_only_cookie_and_opens_chat(client):
    response = client.post("/api/auth/login", json={"access_key": ACCESS_KEY})

    assert response.status_code == 204
    cookie = response.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie
    assert ACCESS_KEY not in response.headers["set-cookie"]
    assert client.get("/api/auth/session").json() == {"authenticated": True}


def test_wrong_key_is_rejected(client):
    response = client.post("/api/auth/login", json={"access_key": "wrong-key-000"})

    assert response.status_code == 401
    assert response.json()["error"] == {"code": "invalid_access_key", "message": "Неверный ключ доступа."}
    assert "set-cookie" not in response.headers


@pytest.mark.parametrize("key", ["short", "a" * 256, "ключ-доступа", "with space1", "semi;colon1"])
def test_malformed_key_fails_validation(client, key):
    response = client.post("/api/auth/login", json={"access_key": key})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_login_attempts_are_rate_limited(client):
    for _ in range(3):
        assert client.post("/api/auth/login", json={"access_key": "wrong-key-000"}).status_code == 401

    blocked = client.post("/api/auth/login", json={"access_key": ACCESS_KEY})
    assert blocked.status_code == 429
    assert int(blocked.headers["retry-after"]) > 0


def test_rate_limiter_counts_attempts_per_client_within_a_window():
    now = [0.0]
    limiter = LoginRateLimiter(max_attempts=2, window_seconds=60, timer=lambda: now[0])

    assert limiter.attempt("ip") == 0
    assert limiter.attempt("ip") == 0
    assert limiter.attempt("ip") == 60  # третья попытка — ждать до конца окна
    assert limiter.attempt("other") == 0  # у другого адреса свой счёт
    now[0] = 61
    assert limiter.attempt("ip") == 0  # окно истекло


def test_rate_limiter_forgets_clients_it_no_longer_needs():
    now = [0.0]
    limiter = LoginRateLimiter(max_attempts=2, window_seconds=60, timer=lambda: now[0])
    for number in range(1000):
        limiter.attempt(f"ip-{number}")
    limiter.attempt("winner")
    limiter.forgive("winner")  # вошёл — попытки больше не считаются

    now[0] = 61
    for number in range(1000):
        limiter.attempt(f"ip-{number}")  # старые попытки вытесняются, а не копятся
    assert all(len(attempts) == 1 for attempts in limiter._attempts.values())
    assert "winner" not in limiter._attempts


def test_successful_login_does_not_use_up_attempts(client):
    for _ in range(10):  # лимит в тестах — 3 попытки; удачные входы его не расходуют
        assert client.post("/api/auth/login", json={"access_key": ACCESS_KEY}).status_code == 204


def test_requests_from_another_site_are_rejected(client):
    """Второй рубеж защиты от CSRF: изменяющий запрос с чужим Origin не проходит."""
    foreign = client.post(
        "/api/auth/login", json={"access_key": ACCESS_KEY}, headers={"Origin": "https://evil.example"}
    )
    assert foreign.status_code == 403
    assert foreign.json()["error"]["code"] == "cross_site_request"
    assert "set-cookie" not in foreign.headers
    assert "default-src 'self'" in foreign.headers["content-security-policy"]  # и у отказа есть заголовки

    own = client.post("/api/auth/login", json={"access_key": ACCESS_KEY}, headers={"Origin": "http://testserver"})
    assert own.status_code == 204
    # читать с чужого сайта можно пытаться — ответ браузер всё равно не отдаст (нет CORS-заголовков)
    assert "access-control-allow-origin" not in client.get("/api/chats", headers={"Origin": "https://evil.example"}).headers


def test_logout_revokes_session(authed):
    token = authed.cookies.get("session")
    assert authed.post("/api/auth/logout").status_code == 204

    authed.cookies.set("session", token)  # украденный токен после выхода бесполезен
    assert authed.get("/api/auth/session").json() == {"authenticated": False}
    assert authed.get("/api/chats").status_code == 401


def test_session_survives_restart(authed, settings, llm):
    restarted = TestClient(create_app(settings, llm))
    restarted.cookies.set("session", authed.cookies.get("session"))
    assert restarted.get("/api/auth/session").json() == {"authenticated": True}


def test_session_expires_after_its_lifetime(settings):
    clock = [utc_now()]
    database = Database(settings.database_path)
    database.migrate(MIGRATIONS)
    auth = AuthService(ACCESS_KEY, SessionRepository(database), timedelta(hours=1), now=lambda: clock[0])

    session = auth.login(ACCESS_KEY)
    assert auth.is_authenticated(session.token) and session.max_age_seconds == 3600
    clock[0] += timedelta(minutes=61)
    assert not auth.is_authenticated(session.token)


def test_cookie_secure_flag_follows_scheme_and_setting(settings, llm):
    def cookie_after_login(base_url: str, policy: str) -> str:
        app = create_app(settings.model_copy(update={"cookie_secure": policy}), llm)
        response = TestClient(app, base_url=base_url).post("/api/auth/login", json={"access_key": ACCESS_KEY})
        return response.headers["set-cookie"].lower()

    assert "secure" not in cookie_after_login("http://testserver", "auto")
    assert "secure" in cookie_after_login("https://testserver", "auto")
    assert "secure" in cookie_after_login("http://testserver", "always")  # HTTPS завершается на прокси
    assert "secure" not in cookie_after_login("https://testserver", "never")


def test_hsts_is_sent_only_over_https(settings, llm):
    app = create_app(settings, llm)
    assert "strict-transport-security" not in TestClient(app).get("/api/health").headers
    assert "strict-transport-security" in TestClient(app, base_url="https://testserver").get("/api/health").headers


@pytest.mark.parametrize("key", ["short", "пароль-пароль", "has space 1"])
def test_server_refuses_to_start_with_bad_access_key(key, tmp_path):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, access_key=key, gemini_api_key="x", database_path=tmp_path / "db")
