from __future__ import annotations

from tests.e2e.helpers import (
    answers,
    ask,
    chat_titles,
    overflows_horizontally,
    questions,
    stored_ids,
    wait_for_answer,
    wait_until,
)


def test_message_field_rules(chat):
    send = chat.locator("#send-button")
    counter = chat.locator("#message-counter")
    field = chat.locator("#message-input")

    assert field.bounding_box()["height"] >= 20  # поле видно сразу после входа, а не схлопнуто
    chat.fill("#message-input", "строка\n" * 4)
    assert field.bounding_box()["height"] >= 80  # и растёт вместе с текстом
    chat.fill("#message-input", "")

    assert send.is_disabled()
    chat.fill("#message-input", "   \n  ")
    assert send.is_disabled()  # только пробелы
    chat.fill("#message-input", "я" * 501)
    assert send.is_disabled() and counter.inner_text() == "501 / 500"
    assert "is-over" in counter.get_attribute("class")
    chat.fill("#message-input", "я" * 500)
    assert send.is_enabled()


def test_answer_is_streamed_and_send_is_locked_meanwhile(chat):
    chat.fill("#message-input", "очень долгий ответ, пожалуйста")
    chat.keyboard.press("Enter")

    chat.wait_for_selector(".message.is-streaming")
    assert chat.locator("#send-button").is_disabled()  # кнопка отправки заблокирована на время ответа
    assert chat.input_value("#message-input") == ""
    first = len(chat.inner_text(".message.is-streaming .prose"))
    chat.wait_for_timeout(600)
    assert len(chat.inner_text(".message.is-streaming .prose")) > first  # текст допечатывается

    chat.click("#stop-button")
    chat.wait_for_selector(".message.is-stopped")
    assert "Генерация остановлена" in chat.inner_text(".message__error")
    assert stored_ids(chat) == [] and chat_titles(chat) == []  # остановленный ответ не сохранён


def test_history_has_date_and_time_and_survives_reload(chat):
    ask(chat, "Сколько будет 2 + 2?")

    assert questions(chat) == ["Сколько будет 2 + 2?"]
    assert "Ответ на «Сколько будет 2 + 2?»" in answers(chat)[0]
    assert chat.locator("#messages .katex").count() >= 1  # формула в ответе отрисована
    times = chat.locator("#messages time").all_inner_texts()
    assert len(times) == 2 and all("," in stamp and ":" in stamp for stamp in times)  # «24 ноября, 14:32»

    chat.reload()
    chat.wait_for_selector("#messages .message")
    assert questions(chat) == ["Сколько будет 2 + 2?"]
    assert chat_titles(chat) == ["Сколько будет 2 + 2?"]


def test_model_error_is_shown_and_question_can_be_retried(chat):
    chat.expected_errors.append("502")
    chat.fill("#message-input", "модель недоступна")
    chat.keyboard.press("Enter")

    chat.wait_for_selector(".message.is-failed")
    assert "Модель временно недоступна" in chat.inner_text(".message__error")
    assert stored_ids(chat) == []

    chat.locator(".message__error-actions button", has_text="Изменить").click()
    assert chat.input_value("#message-input") == "модель недоступна"
    ask(chat, "модель снова работает")
    assert questions(chat) == ["модель снова работает"]


def test_several_chats_are_saved_and_can_be_switched(chat):
    ask(chat, "Первый чат")
    chat.click("#new-chat")
    chat.wait_for_selector("#chat-empty:not([hidden])")
    ask(chat, "Второй чат")
    assert chat_titles(chat) == ["Второй чат", "Первый чат"]

    chat.locator(".sidebar__chat", has_text="Первый чат").click()
    wait_until(chat, lambda: questions(chat) == ["Первый чат"])
    ask(chat, "Продолжение первого")
    assert questions(chat) == ["Первый чат", "Продолжение первого"]
    assert chat_titles(chat) == ["Первый чат", "Второй чат"]  # активный чат поднялся наверх

    chat.go_back()  # адрес страницы помнит чаты
    wait_until(chat, lambda: questions(chat) == ["Второй чат"])

    chat.click("#clear-button")
    chat.click("#confirm-dialog button[value=confirm]")
    chat.wait_for_selector("#chat-empty:not([hidden])")
    assert chat_titles(chat) == ["Первый чат"]


def test_regenerate_and_edit_replace_the_last_pair(chat, llm):
    ask(chat, "Первый вопрос")
    ask(chat, "Второй вопрос")
    before = stored_ids(chat)

    chat.locator(".message__actions button", has_text="Ответить заново").click()
    wait_for_answer(chat)
    after = stored_ids(chat)
    assert after[:2] == before[:2] and after[2:] != before[2:] and len(after) == 4

    chat.locator(".message--user .message__actions button", has_text="Изменить").click()
    assert chat.locator("#edit-banner").is_visible()
    assert chat.input_value("#message-input") == "Второй вопрос"
    ask(chat, "Второй вопрос, исправленный")
    assert questions(chat) == ["Первый вопрос", "Второй вопрос, исправленный"]
    assert llm.requests[-1] == "Второй вопрос, исправленный"


def test_formula_preview_and_symbol_buttons(chat):
    chat.fill("#message-input", "Реши (a + b)^2 = a^2 + 2ab + b^2")
    assert chat.locator("#input-preview .katex").count() == 1
    chat.fill("#message-input", "просто текст")
    assert chat.locator("#input-preview").is_hidden()

    chat.click("#symbols-toggle")
    chat.fill("#message-input", "x")
    chat.locator(".composer__symbol", has_text="x²").click()
    chat.locator(".composer__symbol", has_text="√").click()
    chat.keyboard.type("2")
    assert chat.input_value("#message-input") == "x^2sqrt(2)"


def test_layout_fits_a_phone_and_long_chat_titles(chat):
    ask(chat, "Очень длинный вопрос, название которого точно не помещается в колонку со списком чатов")
    assert not overflows_horizontally(chat, "#sidebar")

    chat.set_viewport_size({"width": 390, "height": 800})
    chat.wait_for_timeout(300)
    assert not overflows_horizontally(chat, "html")
    assert not overflows_horizontally(chat, "#chat-scroll")
    assert not chat.locator("#sidebar").is_visible()
    chat.click("#sidebar-toggle")
    chat.wait_for_timeout(300)
    assert chat.locator("#sidebar").is_visible()
    chat.click("#sidebar-backdrop", position={"x": 370, "y": 400})

    # самый тесный случай: идёт ответ, в строке под полем ввода видны все кнопки сразу
    chat.click("#symbols-toggle")
    chat.locator(".mode__button", has_text="Заготовки").click()
    chat.locator(".mode__option", has_text="Проверить моё решение").click()
    chat.fill("#message-input", "очень долгий ответ")
    assert not overflows_horizontally(chat, ".composer__bar")  # выбрана заготовка с длинным названием
    chat.keyboard.press("Enter")
    chat.wait_for_selector(".message.is-streaming")
    assert not overflows_horizontally(chat, ".composer__bar") and not overflows_horizontally(chat, "html")
    bar = chat.locator(".composer__bar").bounding_box()
    send = chat.locator("#send-button").bounding_box()
    assert send["x"] + send["width"] <= bar["x"] + bar["width"] + 1  # кнопка отправки не уехала за край
    chat.click("#stop-button")
