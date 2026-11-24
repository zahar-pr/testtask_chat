"""Запуск: `python -m evals` — прогнать все контрольные вопросы и записать отчёт.

    python -m evals                      все вопросы, отчёт в evals/report.md
    python -m evals --only урок          только вопросы, в названии которых есть «урок»
    python -m evals --no-report          без записи отчёта
    python -m evals --answers out/       сохранить сами ответы модели — чтобы разобраться, что не так

Нужны те же настройки, что и приложению (GEMINI_API_KEY и модели). Код возврата 1, если
хотя бы одна проверка не прошла, — запуск можно встроить в CI.
"""

from __future__ import annotations

import argparse
import hashlib
import logging
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from app.chat.modes import as_model_input
from app.chat.prompt import SYSTEM_PROMPT
from app.config import get_settings
from app.llm.base import ChatTurn, LLMError
from app.llm.gemini import GeminiClient
from evals.answer import node_command, parse_answer
from evals.cases import CASES, Case
from evals.checks import Result

REPORT = Path(__file__).parent / "report.md"
ATTEMPTS = 3  # бесплатный Gemini часто отвечает 503 — это сбой сервиса, а не качества ответа
PAUSE_SECONDS = 2


@dataclass(frozen=True)
class Outcome:
    case: Case
    results: list[Result]
    seconds: float
    model: str
    error: str = ""
    text: str = ""  # сам ответ модели

    @property
    def passed(self) -> bool:
        return not self.error and all(result.passed for result in self.results)


def run_case(client: GeminiClient, answered_by: list[str], case: Case) -> Outcome:
    """answered_by — список, куда клиент дописывает имя модели каждый раз, когда она начинает отвечать."""
    turns = [ChatTurn("user", as_model_input(case.text, case.mode))]
    error = ""
    for attempt in range(ATTEMPTS):
        started = time.monotonic()
        try:
            text = "".join(client.stream(SYSTEM_PROMPT, turns))
        except LLMError as failure:
            error = f"{failure.failure.value}: {failure}"
            time.sleep(PAUSE_SECONDS * (attempt + 1))
            continue
        answer = parse_answer(text)
        results = [check(answer) for check in case.checks]
        return Outcome(case, results, time.monotonic() - started, answered_by[-1], text=text)
    return Outcome(case, [], 0.0, "—", error=error)


def render_report(outcomes: list[Outcome], models: list[str]) -> str:
    answered = [outcome for outcome in outcomes if not outcome.error]
    checks = [result for outcome in answered for result in outcome.results]
    prompt_version = hashlib.sha256(SYSTEM_PROMPT.encode()).hexdigest()[:8]
    by_primary = sum(outcome.model == models[0] for outcome in answered)
    lines = [
        "# Автопроверка качества ответов",
        "",
        f"Запуск: {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC · версия промпта `{prompt_version}` · "
        f"модели по порядку: {', '.join(f'`{model}`' for model in models)}",
        "",
        f"**Вопросов пройдено: {sum(o.passed for o in outcomes)} из {len(outcomes)}** · "
        f"проверок пройдено: {sum(r.passed for r in checks)} из {len(checks)}"
        + (f" · без ответа модели: {len(outcomes) - len(answered)}" if len(answered) < len(outcomes) else ""),
        "",
        f"Основная модель (`{models[0]}`) ответила на {by_primary} из {len(answered)} вопросов"
        + ("." if by_primary == len(answered) else " — на остальные отвечали запасные; оценка относится и к ним."),
        "",
        "| Вопрос | Заготовка | Итог | Что не прошло | Время | Модель |",
        "|---|---|---|---|---|---|",
    ]
    for outcome in outcomes:
        failed = [f"{r.name}" + (f" ({r.detail})" if r.detail else "") for r in outcome.results if not r.passed]
        problem = "; ".join(failed).replace("|", "\\|")
        if outcome.error:
            problem = f"модель не ответила: {outcome.error[:80]}"
        total = len(outcome.results)
        score = "—" if outcome.error else f"{'✅' if outcome.passed else '❌'} {total - len(failed)}/{total}"
        lines.append(
            f"| {outcome.case.name} | {outcome.case.mode or '—'} | {score} | {problem} | "
            f"{outcome.seconds:.1f} с | {outcome.model} |"
        )
    lines += ["", "Как читать: каждая строка — один вопрос к модели и число пройденных проверок ответа. "
              "Запуск: `python -m evals`. Список вопросов и проверок — в `evals/cases.py`.", ""]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Автопроверка качества ответов модели")
    parser.add_argument("--only", help="запустить только вопросы, в названии которых есть эта строка")
    parser.add_argument("--no-report", action="store_true", help="не записывать evals/report.md")
    parser.add_argument("--answers", type=Path, help="папка, куда сохранить ответы модели")
    args = parser.parse_args()

    # Сообщения клиента о переходе на запасную модель здесь только шум: итог виден в отчёте.
    logging.getLogger("app.llm.gemini").setLevel(logging.ERROR)
    settings = get_settings()
    if node_command() is None:
        print("Для автопроверки нужен Node.js 20+: блоки графиков и тренажёров проверяет код интерфейса.")
        return 2
    answered_by: list[str] = []
    client = GeminiClient(
        settings.gemini_api_key.get_secret_value(),
        settings.gemini_models,
        settings.gemini_timeout_seconds,
        on_model=answered_by.append,
    )
    cases = [case for case in CASES if not args.only or args.only.lower() in case.name.lower()]
    outcomes = []
    for number, case in enumerate(cases, 1):
        outcome = run_case(client, answered_by, case)
        outcomes.append(outcome)
        failed = [result for result in outcome.results if not result.passed]
        status = "нет ответа" if outcome.error else ("ok" if not failed else f"не прошло: {len(failed)}")
        print(f"[{number}/{len(cases)}] {case.name}: {status} ({outcome.seconds:.1f} с, {outcome.model})", flush=True)
        for result in failed:
            print(f"      ✗ {result.name}: {result.detail}", flush=True)
        if args.answers and outcome.text:
            args.answers.mkdir(parents=True, exist_ok=True)
            file = args.answers / f"{number:02d} {case.name.replace(':', ' -')}.md"
            file.write_text(outcome.text, encoding="utf-8")
        time.sleep(PAUSE_SECONDS)
    client.close()

    report = render_report(outcomes, settings.gemini_models)
    if not args.no_report and not args.only:
        REPORT.write_text(report, encoding="utf-8")
        print(f"\nОтчёт: {REPORT}")
    print(f"\nПройдено вопросов: {sum(o.passed for o in outcomes)} из {len(outcomes)}")
    by_primary = sum(outcome.model == settings.gemini_models[0] for outcome in outcomes)
    if by_primary < len(outcomes):
        print(f"ВНИМАНИЕ: основная модель ответила только на {by_primary} из {len(outcomes)} — проверьте квоту.")
    return 0 if all(outcome.passed for outcome in outcomes) else 1


if __name__ == "__main__":
    sys.exit(main())
