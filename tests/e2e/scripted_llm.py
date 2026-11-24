"""Подставная модель для сквозных тестов: отвечает заготовками и по частям, как настоящая."""

from __future__ import annotations

import time
from collections.abc import Iterator, Sequence

from app.llm.base import ChatTurn, LLMError, LLMFailure

LESSON = """### Зачем это нужно
Чтобы узнать, сколько корней у уравнения $x^2 - 5x + 6 = 0$.

### Что нужно знать заранее
1. **Коэффициент** — число перед буквой.

### Главная идея
Формула: $$D = b^2 - 4ac$$

### Разберём пример
Для нашего уравнения $D = 25 - 24 = 1$.

### Посмотрим на рисунке
```plot
{"title": "Парабола", "x": [-1, 6], "params": [{"name": "c", "min": 0, "max": 8, "value": 6, "step": 0.5}], "functions": [{"expr": "x^2 - 5*x + c", "label": "$y = x^2 - 5x + c$"}], "readouts": [{"label": "$D$", "expr": "25 - 4*c"}]}
```

### Частые ошибки
Забывают про знак минус.

### Проверьте себя
""" + """```trainer
{"title": "Дискриминант", "tasks": [{"question": "Найдите $D$ для $x^2 - 4x + 3 = 0$.", "answer": 4, "hint": "Формула $b^2 - 4ac$.", "solution": "$16 - 12 = 4$."}, {"question": "Сколько корней при $D = 0$?", "options": ["Ни одного", "Один", "Два"], "answer": 2, "solution": "Один корень."}]}
```

### Что дальше
Формула корней.
"""

TRAINER = """Потренируемся.

```trainer
{"title": "Проценты", "tasks": [{"question": "Найдите $20\\%$ от $150$.", "answer": 30, "hint": "Умножьте на $0{,}2$.", "solution": "$150 \\cdot 0{,}2 = 30$."}, {"question": "Сколько будет $50\\%$ от $8$?", "answer": 4}]}
```
"""


# Ответ, в котором модель (например, после удачной атаки на промпт) пытается протащить
# исполняемую разметку всеми путями: в тексте, в ссылке, в формуле, в подписях рисунка и в тренажёре.
HOSTILE = """Обычный текст <img src=x onerror="window.pwned = 1"> и <script>window.pwned = 1</script>.

[опасная ссылка](javascript:window.pwned=1) и [обычная ссылка](https://example.com/page).

Формула со ссылкой: $\\href{javascript:window.pwned=1}{x}$ и <iframe src="https://example.com"></iframe>.

```plot
{"title": "<img src=x onerror='window.pwned = 1'>", "x": [0, 1], "functions": [{"expr": "x", "label": "<b onclick='window.pwned = 1'>жирный</b>"}], "points": [{"x": 0.5, "y": 0.5, "label": "<script>window.pwned = 1</script>"}], "caption": "<a href='javascript:window.pwned=1'>подпись</a>"}
```

```trainer
{"title": "<img src=x onerror='window.pwned = 1'>", "tasks": [{"question": "<img src=x onerror='window.pwned = 1'> Сколько будет 2 + 2?", "options": ["<script>window.pwned = 1</script>", "4"], "answer": 2, "hint": "<svg onload='window.pwned = 1'></svg>"}]}
```
"""


class ScriptedLLM:
    """Что ответить, решает текст последнего вопроса — так тест управляет «моделью» словами."""

    def __init__(self) -> None:
        self.requests: list[str] = []

    def stream(self, system_prompt: str, turns: Sequence[ChatTurn]) -> Iterator[str]:
        question = turns[-1].text
        self.requests.append(question)
        lowered = question.lower()

        if "модель недоступна" in lowered:
            raise LLMError(LLMFailure.UNAVAILABLE, "scripted failure")

        if "очень долгий ответ" in lowered:  # чтобы успеть нажать «Остановить»
            for number in range(200):
                yield f"Часть {number}. "
                time.sleep(0.05)
            return

        if "враждебный ответ" in lowered:
            answer = HOSTILE
        elif "изучение с нуля" in lowered:
            answer = LESSON
        elif "тренировка" in lowered or "работа над ошибками" in lowered:
            answer = TRAINER
        else:
            answer = f"Ответ на «{question}»: $x = 1$."

        for start in range(0, len(answer), 40):
            yield answer[start:start + 40]
            time.sleep(0.005)
