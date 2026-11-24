"""Короткие действия, из которых складываются сценарии сквозных тестов."""

from __future__ import annotations


def ask(page, text: str) -> None:
    """Отправить вопрос и дождаться, пока ответ будет получен целиком."""
    page.fill("#message-input", text)
    page.keyboard.press("Enter")
    wait_for_answer(page)


def wait_for_answer(page) -> None:
    page.wait_for_selector("#send-button.is-busy", state="detached", timeout=20000)
    page.wait_for_selector("#stop-button", state="hidden")


def questions(page) -> list[str]:
    """Тексты вопросов в ленте — как их набрал пользователь (на экране формулы в них отрисованы)."""
    return page.evaluate(
        "[...document.querySelectorAll('#messages .message--user')]"
        ".map(node => node.message?.text ?? node.querySelector('.message__text').textContent)"
    )


def answers(page) -> list[str]:
    return page.locator("#messages .message--assistant .prose").all_inner_texts()


def chat_titles(page) -> list[str]:
    return page.locator(".sidebar__chat-title").all_inner_texts()


def stored_ids(page) -> list[int]:
    return page.evaluate("[...document.querySelectorAll('#messages .message[data-id]')].map(n => +n.dataset.id)")


def overflows_horizontally(page, selector: str) -> bool:
    """Есть ли у элемента горизонтальная прокрутка (содержимое шире его самого)."""
    width = page.locator(selector).evaluate("node => [node.scrollWidth, node.clientWidth]")
    return width[0] > width[1]


def wait_until(page, condition, timeout: float = 8.0) -> None:
    """Дождаться, пока condition() станет истинным (строки JavaScript для этого не годятся: их запрещает CSP)."""
    waited = 0.0
    while not condition():
        assert waited < timeout, "условие так и не выполнилось"
        page.wait_for_timeout(50)
        waited += 0.05
