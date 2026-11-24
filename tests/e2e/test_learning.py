from __future__ import annotations

from tests.e2e.helpers import ask, wait_for_answer


def test_preset_lesson_has_sections_plot_and_trainer(chat, llm):
    chat.locator(".preset", has_text="Изучить тему с нуля").click()
    assert "Какую тему изучаем" in chat.get_attribute("#message-input", "placeholder")
    ask(chat, "дискриминант")

    assert llm.requests[-1] == "Режим «Изучение с нуля». Тема: дискриминант"
    assert chat.inner_text(".message__mode") == "Изучение с нуля"
    lesson = chat.locator("#messages .message--assistant").last
    assert lesson.locator("h4").count() == 8
    assert lesson.locator(".plot path.plot__curve").count() == 1
    assert lesson.locator(".trainer").count() == 1
    assert lesson.locator(".widget--failed, .math-error").count() == 0
    assert chat.inner_text("#mode-label") == "Заготовки"  # заготовка действует на одно сообщение

    chips = lesson.locator(".message__actions .chip").all_inner_texts()
    assert chips == ["Объясни проще", "Ещё пример", "Потренироваться", "Что дальше?"]


def test_plot_slider_redraws_curve_and_readout(chat):
    chat.locator(".preset", has_text="Изучить тему с нуля").click()
    ask(chat, "дискриминант")
    plot = chat.locator(".plot").first

    before = plot.locator("path.plot__curve").get_attribute("d")
    plot.locator("input[type=range]").fill("2")
    chat.wait_for_timeout(200)
    assert plot.locator("path.plot__curve").get_attribute("d") != before
    assert plot.locator(".plot__readout-value").inner_text() == "17"  # D = 25 − 4·2


def test_trainer_results_go_to_progress_and_mistakes_can_be_practiced(chat, llm):
    chat.locator(".preset", has_text="Потренироваться").click()
    ask(chat, "проценты")
    trainer = chat.locator(".trainer").first

    trainer.locator(".trainer__input").fill("30")  # верно с первой попытки
    trainer.locator(".trainer__input").press("Enter")
    assert "Верно" in trainer.locator(".trainer__feedback").inner_text()
    trainer.locator("button", has_text="Дальше").click()
    trainer.locator(".trainer__input").fill("5")  # ошибка
    trainer.locator(".trainer__input").press("Enter")
    assert "неверно" in trainer.locator(".trainer__feedback").inner_text()
    trainer.locator(".trainer__input").fill("4")
    trainer.locator(".trainer__input").press("Enter")
    trainer.locator("button", has_text="К итогам").click()
    assert "С первой попытки: 1 из 2" in trainer.inner_text()

    chat.click("#progress-button")
    chat.wait_for_selector(".stat")
    stats = [text.replace("\n", " ") for text in chat.locator(".stat").all_inner_texts()]
    assert stats == ["2 заданий решено", "50% с первой попытки", "1 стоит повторить"]
    assert chat.locator(".progress__mistake").count() == 1

    chat.click("#progress-review")
    wait_for_answer(chat)
    assert chat.inner_text(".message__mode") == "Работа над ошибками"
    assert "Сколько будет" in llm.requests[-1]  # модель получила задание, в котором была ошибка
