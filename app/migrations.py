"""Порядок миграций базы. Сами шаги лежат рядом с возможностями, которым принадлежат таблицы.

Правило одно: новые миграции дописываются в конец, уже применённые не меняются и не
переставляются — номер миграции в списке и есть версия схемы.
"""

from __future__ import annotations

from app.auth import migrations as auth
from app.chat import migrations as chat
from app.db import Migration
from app.progress import migrations as progress

MIGRATIONS: list[Migration] = [
    auth.create_sessions,
    chat.create_messages,
    chat.add_message_mode,
    chat.create_chats,
    progress.create_attempts,
    chat.require_chat_for_messages,
]
