"""Разбор ответа модели для проверок: заголовки, обычный текст, блоки plot и trainer.

Блоки читаются с той же терпимостью, что и в интерфейсе (static/js/widgets/index.js,
static/js/render/markdown.js): конец блока — по JSON, а не по закрывающей строке; одиночная
обратная черта LaTeX в JSON чинится. Поэтому «блок исправен» здесь значит «интерфейс его покажет».
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from functools import cached_property

BLOCK_START = re.compile(r"```(plot|trainer)[ \t]*\n", re.IGNORECASE)
CLOSING_FENCE = re.compile(r"[ \t]*\n?[ \t]*```")
LONE_BACKSLASH = re.compile(r"(\\+)(?=[A-Za-z]{2}|[{}()\[\],;!|%&_ ])")
HEADING = re.compile(r"^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$", re.MULTILINE)
MATH = re.compile(r"\$\$.+?\$\$|\$[^$\n]+?\$", re.DOTALL)


@dataclass(frozen=True)
class Block:
    kind: str  # plot или trainer
    raw: str
    spec: dict | None  # разобранное описание; None, если JSON испорчен
    error: str = ""


@dataclass(frozen=True)
class Answer:
    text: str
    blocks: list[Block] = field(default_factory=list)
    prose: str = ""  # текст без блоков — то, что человек читает

    @cached_property
    def headings(self) -> list[str]:
        return HEADING.findall(self.prose)

    @cached_property
    def words(self) -> int:
        return len(MATH.sub(" ", self.prose).split())

    @cached_property
    def plain(self) -> str:
        """Текст без блоков и формул — для проверок языка и формулировок."""
        return MATH.sub(" ", self.prose)

    def of_kind(self, kind: str) -> list[Block]:
        return [block for block in self.blocks if block.kind == kind]


def json_object_end(text: str, start: int) -> int:
    """Индекс сразу после JSON-объекта, начинающегося с позиции start; -1, если он не дописан."""
    index = start
    while index < len(text) and text[index].isspace():
        index += 1
    if index >= len(text) or text[index] != "{":
        return -1
    depth, in_string = 0, False
    while index < len(text):
        char = text[index]
        if in_string:
            if char == "\\":
                index += 1
            elif char == '"':
                in_string = False
        elif char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return index + 1
        index += 1
    return -1


def _parse_spec(raw: str) -> tuple[dict | None, str]:
    repaired = LONE_BACKSLASH.sub(lambda m: m.group(1) + ("\\" if len(m.group(1)) % 2 else ""), raw)
    try:
        spec = json.loads(repaired)
    except json.JSONDecodeError as error:
        return None, f"JSON: {error.msg} (позиция {error.pos})"
    return (spec, "") if isinstance(spec, dict) else (None, "описание — не объект")


def parse_answer(text: str) -> Answer:
    blocks: list[Block] = []
    prose: list[str] = []
    cursor = 0
    for match in BLOCK_START.finditer(text):
        if match.start() < cursor:
            continue
        end = json_object_end(text, match.end())
        if end == -1:  # описание оборвано: блок тянется до закрывающей строки или до конца текста
            close = text.find("```", match.end())
            end = len(text) if close == -1 else close
            blocks.append(Block(match.group(1).lower(), text[match.end():end], None, "описание блока не дописано"))
        else:
            spec, error = _parse_spec(text[match.end():end])
            blocks.append(Block(match.group(1).lower(), text[match.end():end], spec, error))
        prose.append(text[cursor:match.start()])
        closing = CLOSING_FENCE.match(text, end)
        cursor = closing.end() if closing else end
    prose.append(text[cursor:])
    return Answer(text=text, blocks=blocks, prose="\n".join(prose))
