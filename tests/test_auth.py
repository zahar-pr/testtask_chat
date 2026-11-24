from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.auth.rate_limit import LoginRateLimiter
from app.config import Settings
from app.main import create_app
from tests.conftest import ACCESS_KEY


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


def test_rate_limiter_window_expires():
    now = [0.0]
    limiter = LoginRateLimiter(max_attempts=2, window_seconds=60, timer=lambda: now[0])
    limiter.record_failure("ip")
    limiter.record_failure("ip")
    assert limiter.retry_after("ip") == 60
    assert limiter.retry_after("other") == 0
    now[0] = 61
    assert limiter.retry_after("ip") == 0


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


def test_expired_session_is_rejected(settings, llm, monkeypatch):
    from datetime import timedelta

    from app.auth import service

    client = TestClient(create_app(settings, llm))
    client.post("/api/auth/login", json={"access_key": ACCESS_KEY})
    real_now = service.utc_now
    monkeypatch.setattr(service, "utc_now", lambda: real_now() + timedelta(hours=settings.session_ttl_hours + 1))
    assert client.get("/api/auth/session").json() == {"authenticated": False}


@pytest.mark.parametrize("key", ["short", "пароль-пароль", "has space 1"])
def test_server_refuses_to_start_with_bad_access_key(key, tmp_path):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, access_key=key, gemini_api_key="x", database_path=tmp_path / "db")
