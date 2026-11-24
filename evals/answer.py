"""Ответ модели в виде, удобном для проверок: обычный текст, заголовки, блоки plot и trainer.

Блоки разбирает не Python, а код самого интерфейса (evals/blocks.mjs → static/js/…): правила
одни, и «блок исправен» означает именно «пользователь увидит рисунок». Поэтому для автопроверки
нужен Node.js; команду можно переопределить переменной окружения EVALS_NODE.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import shutil
import subprocess
from dataclasses import dataclass, field
from functools import cached_property
from pathlib import Path

BLOCKS_SCRIPT = Path(__file__).with_name("blocks.mjs")
HEADING = re.compile(r"^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$", re.MULTILINE)
MATH = re.compile(r"\$\$.+?\$\$|\$[^$\n]+?\$", re.DOTALL)


class NodeUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class Block:
    kind: str  # plot или trainer
    error: str | None  # почему интерфейс не сможет показать блок; None — блок исправен
    tasks: int = 0  # заданий в тренажёре
    sliders: int = 0  # ползунков у рисунка


@dataclass(frozen=True)
class Answer:
    text: str
    blocks: list[Block] = field(default_factory=list)
    prose: str = ""  # текст без блоков — то, что человек читает

    @cached_property
    def headings(self) -> list[str]:
        return HEADING.findall(self.prose)

    @cached_property
    def plain(self) -> str:
        """Текст без блоков и формул — для проверок языка и формулировок."""
        return MATH.sub(" ", self.prose)

    @cached_property
    def words(self) -> int:
        return len(self.plain.split())

    def of_kind(self, kind: str) -> list[Block]:
        return [block for block in self.blocks if block.kind == kind]


def node_command() -> list[str] | None:
    """Команда запуска Node.js или None, если его нет."""
    if custom := os.environ.get("EVALS_NODE"):
        return shlex.split(custom)
    return ["node"] if shutil.which("node") else None


def parse_answer(text: str) -> Answer:
    command = node_command()
    if command is None:
        raise NodeUnavailable("Для автопроверки нужен Node.js 20+ (или команда в переменной EVALS_NODE).")
    script = os.environ.get("EVALS_BLOCKS_SCRIPT", str(BLOCKS_SCRIPT))
    result = subprocess.run(  # noqa: S603 — команда задаётся разработчиком, не пользователем
        [*command, script], input=text, capture_output=True, text=True, encoding="utf-8", timeout=60, check=False
    )
    if result.returncode != 0:
        raise RuntimeError(f"Не удалось разобрать ответ: {result.stderr.strip()[:300]}")
    parsed = json.loads(result.stdout)
    return Answer(text=text, blocks=[Block(**block) for block in parsed["blocks"]], prose=parsed["prose"])
