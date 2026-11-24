"""Правила для ключа доступа — одни и те же при запуске сервера и при входе.

Те же правила показывает пользователю форма входа (static/js/validation.js).
"""

from __future__ import annotations

import re

ACCESS_KEY_MIN_LENGTH = 8
ACCESS_KEY_MAX_LENGTH = 255
_ALLOWED = re.compile(r"[A-Za-z0-9_-]+")


def access_key_problem(key: str) -> str | None:
    """Что не так с ключом; None — ключ записан по правилам."""
    if not ACCESS_KEY_MIN_LENGTH <= len(key) <= ACCESS_KEY_MAX_LENGTH:
        return (
            f"Ключ доступа должен быть длиной от {ACCESS_KEY_MIN_LENGTH} до {ACCESS_KEY_MAX_LENGTH} символов."
        )
    if not _ALLOWED.fullmatch(key):
        return "В ключе допустимы только латинские буквы, цифры, дефис и подчёркивание."
    return None
