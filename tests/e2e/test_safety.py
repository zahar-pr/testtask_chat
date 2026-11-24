"""Ответ модели не может выполнить код в браузере — что бы она ни прислала."""

from __future__ import annotations

from tests.e2e.helpers import ask

FORBIDDEN = "img, script, iframe, object, embed, form, [onerror], [onclick], [onload]"


def test_hostile_model_output_is_shown_as_text_and_never_executed(chat):
    ask(chat, "враждебный ответ")
    answer = chat.locator("#messages .message--assistant").last

    # Разметка из ответа не стала элементами страницы…
    assert answer.locator(FORBIDDEN).count() == 0
    # …а показана как обычный текст: в ответе, в подписях рисунка и в тренажёре.
    assert "<img src=x onerror=" in answer.locator(".prose > p").first.inner_text()
    assert "<img src=x onerror=" in answer.locator(".plot .widget__title").inner_text()
    assert "<script>" in answer.locator(".plot .plot__label").inner_text()
    assert "<img src=x onerror=" in answer.locator(".trainer .trainer__question").inner_text()
    assert "<script>" in answer.locator(".trainer .trainer__option").first.inner_text()

    # Ссылки ведут только на http(s) и открываются без доступа к нашей странице.
    links = answer.locator("a")
    assert links.count() == 1
    assert links.first.get_attribute("href") == "https://example.com/page"
    assert links.first.get_attribute("rel") == "noopener noreferrer"
    assert answer.locator("[href^='javascript:' i], [src^='javascript:' i]").count() == 0

    # Рисунок и тренажёр при этом построены, а не сломаны.
    assert answer.locator(".plot path.plot__curve").count() == 1
    assert answer.locator(".trainer").count() == 1 and answer.locator(".widget--failed").count() == 0

    # И главное: ни один из подложенных обработчиков не сработал.
    answer.locator(".trainer .trainer__option").first.click()
    assert chat.evaluate("window.pwned") is None
