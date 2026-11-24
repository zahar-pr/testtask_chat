"""Доступность интерфейса: автоматическая проверка axe-core на всех экранах в обеих темах.

Проверяются правила WCAG 2 уровней A и AA (контраст текста, подписи полей и кнопок, порядок
заголовков, области страницы). axe-core ставится командой `npm install`; без него тест пропускается.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from tests.e2e.conftest import ACCESS_KEY
from tests.e2e.helpers import ask

AXE = Path(__file__).resolve().parents[2] / "node_modules" / "axe-core" / "axe.min.js"
RULES = ["wcag2a", "wcag2aa", "best-practice"]

pytestmark = pytest.mark.skipif(not AXE.exists(), reason="axe-core не установлен (npm install)")


def violations(page) -> list[str]:
    if not page.evaluate("typeof axe === 'object'"):
        page.add_script_tag(path=str(AXE))
    result = page.evaluate("rules => axe.run(document, { runOnly: rules })", RULES)
    return [f"{item['id']}: {item['help']} — {item['nodes'][0]['target'][0]}" for item in result["violations"]]


@pytest.mark.parametrize("scheme", ["light", "dark"])
def test_every_screen_passes_the_accessibility_audit(browser, server, scheme):
    # Скрипт проверки подключается к странице извне, поэтому для него (и только в тесте) CSP отключена.
    context = browser.new_context(
        viewport={"width": 1280, "height": 800}, locale="ru-RU", base_url=server, color_scheme=scheme, bypass_csp=True
    )
    page = context.new_page()
    page.set_default_timeout(8000)

    page.goto("/")
    page.fill("#access-key", "ab cd")  # поле с подсказкой об ошибке
    assert violations(page) == [], "экран входа"

    page.fill("#access-key", ACCESS_KEY)
    page.keyboard.press("Enter")
    page.wait_for_selector("#chat-empty:not([hidden])")
    assert violations(page) == [], "пустой чат с заготовками"

    page.locator(".preset", has_text="Изучить тему с нуля").click()
    ask(page, "дискриминант")  # урок: заголовки, формулы, рисунок с ползунком, тренажёр
    page.locator(".plot path.plot__curve").wait_for(state="attached")
    assert violations(page) == [], "чат с уроком"

    page.click("#progress-button")
    page.wait_for_selector("#progress-dialog[open]")
    assert violations(page) == [], "панель прогресса"
    context.close()
