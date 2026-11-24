from __future__ import annotations

from tests.e2e.conftest import ACCESS_KEY


def test_login_form_validates_key_and_opens_chat(page):
    page.goto("/")
    button = page.locator("#login-button")
    hint = page.locator("#access-key-hint")

    assert button.is_disabled()  # пустое поле
    page.fill("#access-key", "abc")
    assert button.is_disabled() and "Ещё 5 символов" in hint.inner_text()
    page.fill("#access-key", "ключ доступа")
    assert button.is_disabled() and "Нельзя использовать" in hint.inner_text()
    page.fill("#access-key", "a" * 256)
    assert button.is_disabled() and "Слишком длинный" in hint.inner_text()

    page.expected_errors.append("401")
    page.fill("#access-key", "wrong-key-123")
    assert button.is_enabled()
    button.click()
    page.wait_for_selector("#access-key-hint.is-error")
    assert hint.inner_text() == "Неверный ключ доступа."
    assert page.locator("#chat-view").is_hidden()

    page.fill("#access-key", ACCESS_KEY)
    page.keyboard.press("Enter")
    page.wait_for_selector("#chat-view:not([hidden])")
    assert page.locator("#login-view").is_hidden()


def test_access_key_is_not_kept_in_the_browser(chat):
    assert chat.input_value("#access-key") == ""
    assert chat.evaluate("document.cookie") == ""  # cookie сессии недоступна скриптам (HttpOnly)
    stored = chat.evaluate("JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)])")
    assert ACCESS_KEY not in stored
    cookie = next(c for c in chat.context.cookies() if c["name"] == "epsilon_session")
    assert cookie["httpOnly"] and cookie["sameSite"] == "Strict" and cookie["value"] != ACCESS_KEY


def test_session_survives_reload_and_logout_returns_to_login(chat):
    chat.reload()
    chat.wait_for_selector("#chat-view:not([hidden])")

    chat.click("#logout-button")
    chat.wait_for_selector("#login-view:not([hidden])")
    chat.reload()
    chat.wait_for_selector("#login-view:not([hidden])")


def test_expired_session_returns_to_login_with_a_notice(chat):
    chat.expected_errors.append("401")
    chat.context.clear_cookies()
    chat.fill("#message-input", "2 + 2")
    chat.keyboard.press("Enter")

    chat.wait_for_selector("#login-view:not([hidden])")
    assert "Сессия завершилась" in chat.inner_text("#login-notice")
