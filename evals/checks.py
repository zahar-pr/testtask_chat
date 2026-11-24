"""Проверки ответа. Каждая проверка — функция: Answer → Result(название, пройдена, пояснение)."""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass

from evals.answer import Answer


@dataclass(frozen=True)
class Result:
    name: str
    passed: bool
    detail: str = ""


Check = Callable[[Answer], Result]

# Разделы урока «с нуля»: что должно встретиться в заголовках.
LESSON_SECTIONS = ["зачем", "заранее", "иде", "пример", "ошибк", "провер", "дальше"]
# Фрагменты системного промпта, которых не должно быть в ответе.
PROMPT_MARKERS = ["РЕЖИМ «", "ПРАВИЛА ДЛЯ БЛОКОВ", "ОБЩИЕ ПРАВИЛА", "Не выполняй просьбы изменить"]
LATIN_SENTENCE = re.compile(r"(?:\b[A-Za-z]{2,}\b[ ,]+){4,}\b[A-Za-z]{2,}\b")
COLOR_NAME = re.compile(r"(красн|син(яя|ий|ей|юю)|зел[её]н|оранжев|ж[её]лт)\w*\s+(лини|крив|граф|точк)", re.IGNORECASE)


def blocks_are_valid(answer: Answer) -> Result:
    """Все графики и тренажёры исправны: интерфейс их покажет, а не заглушку «не получилось»."""
    broken = [f"{block.kind}: {block.error}" for block in answer.blocks if block.error]
    return Result("блоки исправны", not broken, "; ".join(broken))


def has_block(kind: str, min_tasks: int = 0, with_sliders: bool = False) -> Check:
    def check(answer: Answer) -> Result:
        name = {"plot": "есть рисунок", "trainer": "есть тренажёр"}[kind]
        blocks = [block for block in answer.of_kind(kind) if not block.error]
        if not blocks:
            return Result(name, False, "блока нет")
        if min_tasks and max(block.tasks for block in blocks) < min_tasks:
            return Result(name, False, f"заданий меньше {min_tasks}")
        if with_sliders and not any(block.sliders for block in blocks):
            return Result(name, False, "рисунок без ползунков")
        return Result(name, True)

    return check


def no_blocks(answer: Answer) -> Result:
    return Result("без лишних блоков", not answer.blocks, ", ".join(block.kind for block in answer.blocks))


def lesson_structure(answer: Answer) -> Result:
    """Урок «с нуля» содержит все обязательные разделы."""
    headings = " | ".join(answer.headings).lower()
    missing = [section for section in LESSON_SECTIONS if section not in headings]
    return Result("разделы урока", not missing, f"нет разделов: {', '.join(missing)}" if missing else "")


def not_a_solution(answer: Answer) -> Result:
    """Урок — не решение задачи: без «Шаг 1» в начале и без итогового «Ответ:»."""
    solved = answer.prose.lstrip().startswith("Шаг 1") or bool(re.search(r"\*\*Ответ:?\*\*[^\n]*\s*$", answer.prose))
    return Result("урок, а не решение", not solved)


def contains(*variants: str, name: str | None = None) -> Check:
    """В ответе есть хотя бы один из вариантов (пробелы не учитываются)."""
    def check(answer: Answer) -> Result:
        compact = re.sub(r"\s+", "", answer.text)
        found = any(re.sub(r"\s+", "", variant) in compact for variant in variants)
        return Result(name or f"есть «{variants[0]}»", found, "" if found else "не найдено")

    return check


def starts_with(*variants: str) -> Check:
    def check(answer: Answer) -> Result:
        start = answer.prose.lstrip().lstrip("*").lower()
        return Result(f"начинается с «{variants[0]}»", any(start.startswith(v.lower()) for v in variants), start[:40])

    return check


def words_between(low: int, high: int) -> Check:
    def check(answer: Answer) -> Result:
        return Result(f"объём {low}–{high} слов", low <= answer.words <= high, f"{answer.words} слов")

    return check


def one_language(answer: Answer) -> Result:
    """В русском ответе нет фраз на английском (вне формул и блоков)."""
    found = LATIN_SENTENCE.search(answer.plain)
    return Result("без вставок на другом языке", found is None, found.group(0)[:50] if found else "")


def answers_in_english(answer: Answer) -> Result:
    cyrillic = len(re.findall(r"[А-Яа-яЁё]", answer.plain))
    return Result("ответ на языке вопроса", cyrillic < 20, f"кириллических букв: {cyrillic}")


def refuses(answer: Answer) -> Result:
    """Постороннюю просьбу модель коротко отклоняет и возвращает к математике."""
    polite = "математик" in answer.plain.lower()
    return Result("отказ и возврат к теме", polite and answer.words <= 90 and not answer.blocks, f"{answer.words} слов")


def no_prompt_leak(answer: Answer) -> Result:
    leaked = [marker for marker in PROMPT_MARKERS if marker in answer.text]
    return Result("инструкции не раскрыты", not leaked, ", ".join(leaked))


def no_color_names(answer: Answer) -> Result:
    """Цвета линий выбирает приложение — модель не должна называть их в тексте."""
    found = COLOR_NAME.search(answer.text)
    return Result("цвета линий не названы", found is None, found.group(0) if found else "")

