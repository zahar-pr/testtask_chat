"""Сквозные тесты: настоящий сервер приложения + настоящий браузер, модель — подставная.

Запуск: pip install -r requirements-e2e.txt && playwright install chromium && python -m pytest tests/e2e
Без установленного Playwright или браузера эти тесты пропускаются.
"""

from __future__ import annotations

import socket
import threading
import time

import pytest
import uvicorn

from app.config import Settings
from app.main import create_app
from tests.e2e.scripted_llm import ScriptedLLM

playwright_api = pytest.importorskip("playwright.sync_api", reason="Playwright не установлен")

ACCESS_KEY = "e2e-access-key"


@pytest.fixture(scope="session")
def browser():
    with playwright_api.sync_playwright() as playwright:
        try:
            instance = playwright.chromium.launch()
        except playwright_api.Error as error:
            pytest.skip(f"Chromium для Playwright не установлен: {error}")
        yield instance
        instance.close()


@pytest.fixture
def llm() -> ScriptedLLM:
    return ScriptedLLM()


@pytest.fixture
def server(tmp_path, llm):
    """Приложение на свободном порту со своей пустой базой; адрес — в значении фикстуры."""
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    settings = Settings(
        _env_file=None, access_key=ACCESS_KEY, gemini_api_key="unused", database_path=tmp_path / "chat.sqlite3"
    )
    instance = uvicorn.Server(
        uvicorn.Config(create_app(settings, llm), host="127.0.0.1", port=port, log_level="warning")
    )
    thread = threading.Thread(target=instance.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 10
    while not instance.started and time.monotonic() < deadline:
        time.sleep(0.02)
    assert instance.started, "сервер не запустился"
    yield f"http://127.0.0.1:{port}"
    instance.should_exit = True
    thread.join(timeout=5)


@pytest.fixture
def page(browser, server):
    """Страница приложения. В конце теста проверяем, что в консоли браузера не было ошибок."""
    context = browser.new_context(
        viewport={"width": 1280, "height": 800}, locale="ru-RU", timezone_id="Europe/Moscow", base_url=server
    )
    tab = context.new_page()
    tab.set_default_timeout(8000)
    problems: list[str] = []
    tab.on("pageerror", lambda error: problems.append(f"исключение: {error}"))
    tab.on("console", lambda message: message.type == "error" and problems.append(f"консоль: {message.text}"))
    tab.expected_errors = []  # подстроки ошибок, которых тест ждёт (например, 401 при неверном ключе)
    yield tab
    unexpected = [p for p in problems if not any(expected in p for expected in tab.expected_errors)]
    context.close()
    assert not unexpected, f"ошибки в браузере: {unexpected}"


@pytest.fixture
def chat(page):
    """Страница после входа: открыт пустой новый чат."""
    page.goto("/")
    page.fill("#access-key", ACCESS_KEY)
    page.keyboard.press("Enter")
    page.wait_for_selector("#chat-empty:not([hidden])")
    return page
