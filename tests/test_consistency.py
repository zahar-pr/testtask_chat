"""Одни и те же правила записаны в нескольких местах — на сервере, в интерфейсе и в подсказках.

Сервер проверяет ради безопасности, интерфейс — ради удобства, поэтому дублирование намеренное.
Эти тесты следят, чтобы копии не разошлись: изменил лимит или добавил заготовку в одном месте —
тест напомнит про остальные.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import get_args

from app.auth.rules import ACCESS_KEY_MAX_LENGTH, ACCESS_KEY_MIN_LENGTH
from app.chat import modes
from app.chat.prompt import SYSTEM_PROMPT
from app.chat.schemas import MESSAGE_MAX_LENGTH
from evals.checks import PROMPT_MARKERS

STATIC = Path(__file__).resolve().parent.parent / "static"
VALIDATION_JS = (STATIC / "js" / "validation.js").read_text(encoding="utf-8")
MODES_JS = (STATIC / "js" / "modes.js").read_text(encoding="utf-8")
INDEX_HTML = (STATIC / "index.html").read_text(encoding="utf-8")


def test_field_limits_match_between_server_and_interface():
    key_limits = re.search(r"ACCESS_KEY = \{ min: (\d+), max: (\d+) \}", VALIDATION_JS)
    assert [int(value) for value in key_limits.groups()] == [ACCESS_KEY_MIN_LENGTH, ACCESS_KEY_MAX_LENGTH]
    assert int(re.search(r"MESSAGE = \{ max: (\d+) \}", VALIDATION_JS).group(1)) == MESSAGE_MAX_LENGTH

    assert f"От {ACCESS_KEY_MIN_LENGTH} до {ACCESS_KEY_MAX_LENGTH} символов" in INDEX_HTML  # подсказка под полем
    assert f"0 / {MESSAGE_MAX_LENGTH}" in INDEX_HTML  # счётчик под полем ввода


def test_presets_are_the_same_on_server_and_in_interface():
    server_modes = set(get_args(modes.ModeId))
    interface_modes = set(re.findall(r"^    id: '(\w+)',", MODES_JS, flags=re.MULTILINE))
    assert interface_modes == server_modes
    # у каждого режима есть формулировка запроса для модели и раздел с правилами в промпте
    assert set(modes._REQUESTS) == server_modes
    for request in modes._REQUESTS.values():
        title = re.search(r"Режим «(.+?)»", request).group(1)
        assert f"РЕЖИМ «{title.upper()}»" in SYSTEM_PROMPT, title


def test_prompt_leak_markers_exist_in_the_prompt():
    """Автопроверка ищет в ответах куски промпта; сами куски должны в нём быть."""
    assert all(marker in SYSTEM_PROMPT for marker in PROMPT_MARKERS)
