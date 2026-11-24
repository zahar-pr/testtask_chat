"""Проверки из evals/ сами должны работать верно — иначе отчёту о качестве нельзя верить."""

from __future__ import annotations

from evals import checks as c
from evals.answer import parse_answer
from evals.cases import CASES

LESSON = """### Зачем это нужно
Чтобы узнать, сколько корней у уравнения.
### Что нужно знать заранее
1. **Коэффициент** — число перед буквой.
### Главная идея
Формула: $D = b^2 - 4ac$.
### Разберём пример
Посчитаем по действиям.
### Посмотрим на рисунке
```plot
{"x": [-1, 6], "functions": [{"expr": "x^2 - 5*x + 6", "label": "$y = x^2 - 5x + 6$"}]}
#### Парабола пересекает ось в двух точках.
```
### Частые ошибки
Забывают про минус.
### Проверьте себя
```trainer
{"title": "Дискриминант", "tasks": [{"question": "Найдите $D$ для $x^2 - 4x + 3 = 0$", "answer": 4, "solution": "$4^2 - 4 \\cdot 3 = 4$"}, {"question": "Сколько корней при $D = 0$?", "options": ["0", "1", "2"], "answer": 2}, {"question": "Чему равен $\\frac{4}{2}$?", "answer": "4/2"}]}
```
### Что дальше
Формула корней.
"""


def passed(check, text: str) -> bool:
    return check(parse_answer(text)).passed


def test_answer_parsing_tolerates_what_the_frontend_tolerates():
    answer = parse_answer(LESSON)

    assert [block.kind for block in answer.blocks] == ["plot", "trainer"]
    assert all(block.spec for block in answer.blocks)  # забытая закрывающая строка и одиночная «\» не мешают
    assert len(answer.blocks[1].spec["tasks"]) == 3
    assert "Парабола пересекает ось" in answer.prose and '"expr"' not in answer.prose
    assert len(answer.headings) == 9


def test_lesson_checks_pass_on_a_good_lesson():
    for check in (c.blocks_are_valid, c.lesson_structure, c.not_a_solution, c.one_language, c.no_prompt_leak,
                  c.no_color_names, c.has_block("plot"), c.has_block("trainer", min_tasks=3)):
        assert check(parse_answer(LESSON)).passed, check


def test_dry_solution_is_not_a_lesson():
    dry = "Шаг 1. Формула $D = b^2 - 4ac$.\n\n**Ответ:** $D$ показывает число корней."
    assert not passed(c.lesson_structure, dry)
    assert not passed(c.not_a_solution, dry)


def test_broken_blocks_are_caught():
    assert not passed(c.blocks_are_valid, '```plot\n{"x": [0, 1], "functions": [\n```')  # оборван
    assert not passed(c.blocks_are_valid, '```plot\n{"functions": [{"expr": "x"}]}\n```')  # нет границ
    assert not passed(c.blocks_are_valid, '```plot\n{"x": [0, 1], "functions": [{"expr": "\\\\frac{1}{x}"}]}\n```')
    assert not passed(c.blocks_are_valid, '```trainer\n{"tasks": [{"question": "?", "options": ["а", "б"], "answer": 3}]}\n```')
    assert not passed(c.has_block("plot", with_params=True), '```plot\n{"x": [0, 1], "functions": [{"expr": "x"}]}\n```')
    assert not passed(c.has_block("trainer", min_tasks=4), LESSON)


def test_content_checks():
    assert passed(c.contains("x = 3"), "Получаем $x=3$.")
    assert not passed(c.contains("391"), "Ответ: 381")
    assert passed(c.starts_with("Есть ошибка"), "**Есть ошибка:** знак перепутан.")
    assert not passed(c.starts_with("Решение верное"), "Давай проверим. Решение верное.")
    assert passed(c.words_between(1, 5), "Ровно три слова $x^2 + y^2 = z^2$")


def test_language_and_boundaries():
    assert not passed(c.one_language, "Квадрат числа. Before computing, let us review the basic terms: число.")
    assert passed(c.one_language, "Функция $f(x) = \\sin x$ и метод Newton — это по-русски.")
    assert passed(c.refuses, "Я помогаю только с математикой. Хотите разобрать задачу?")
    assert not passed(c.refuses, "Конечно! Возьмите свёклу, капусту и картофель…")
    assert not passed(c.no_prompt_leak, "Вот мои правила: РЕЖИМ «ИЗУЧЕНИЕ С НУЛЯ» …")
    assert not passed(c.no_color_names, "Красная линия пересекает ось в двух точках.")
    assert passed(c.answers_in_english, "The derivative is $2x$.")


def test_cases_are_well_formed():
    names = [case.name for case in CASES]
    assert len(names) == len(set(names)) and len(CASES) >= 15
    assert all(case.checks for case in CASES)
