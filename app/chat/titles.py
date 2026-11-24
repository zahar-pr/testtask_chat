"""Название чата — начало первого вопроса."""

from __future__ import annotations

TITLE_MAX_LENGTH = 60


def chat_title(first_question: str) -> str:
    title = " ".join(first_question.split())
    return title if len(title) <= TITLE_MAX_LENGTH else title[: TITLE_MAX_LENGTH - 1].rstrip() + "…"
