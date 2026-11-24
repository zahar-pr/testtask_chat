"""Сценарии чата: список чатов, история, вопрос → ответ модели по частям → запись пары."""

from __future__ import annotations

import logging
from collections.abc import Iterator
from dataclasses import dataclass

from app.chat.repository import Chat, ChatRepository, Message, NewMessage
from app.chat.modes import as_model_input
from app.chat.prompt import SYSTEM_PROMPT
from app.clock import utc_now
from app.db import chat_title
from app.errors import ChatNotFound, NothingToReplace
from app.llm.base import ChatTurn, LLMClient, LLMError, LLMFailure


@dataclass(frozen=True)
class AnswerChunk:
    """Очередная часть ответа, только что полученная от модели."""

    text: str


@dataclass(frozen=True)
class AnswerRestart:
    """Ответ оборвался и запрошен заново: всё показанное до этого нужно стереть."""


@dataclass(frozen=True)
class Exchange:
    """Завершённая и сохранённая пара «вопрос — ответ» и чат, в который она записана."""

    chat: Chat
    user: Message
    assistant: Message


logger = logging.getLogger(__name__)

# Сколько раз заново запросить ответ, если он оборвался на полуслове (с бесплатным Gemini
# это случается), и какие сбои считаются временными.
RESTARTS = 1
TRANSIENT = {LLMFailure.UNAVAILABLE, LLMFailure.TIMEOUT}

ChatEvent = AnswerChunk | AnswerRestart | Exchange


class ChatService:
    def __init__(self, chats: ChatRepository, llm: LLMClient, context_exchanges: int) -> None:
        self._chats = chats
        self._llm = llm
        self._context_exchanges = context_exchanges

    def chats(self) -> list[Chat]:
        return self._chats.list_chats()

    def history(self, chat_id: int) -> list[Message]:
        self._require(chat_id)
        return self._chats.list_messages(chat_id)

    def delete(self, chat_id: int) -> None:
        self._chats.delete_chat(chat_id)

    def send(
        self, text: str, mode: str | None = None, chat_id: int | None = None, replace_last: bool = False
    ) -> Iterator[ChatEvent]:
        """Спросить модель: сначала идут части ответа, последним — сохранённая пара.

        chat_id — чат, в котором задан вопрос; без него вопрос начинает новый чат. Чат создаётся
        вместе с первой сохранённой парой, поэтому пустых чатов не бывает.
        replace_last — вопрос заменяет последнюю пару чата: так работают «ответить заново»
        и правка последнего вопроса. Модель при этом заменяемую пару не видит.
        mode — заготовка, выбранная пользователем: в истории хранится его собственный текст,
        а модель получает запрос с названием режима (и видит режимы прошлых вопросов).

        В историю попадают только завершённые пары. Если модель не ответила или ответ
        оборвался и повторная попытка не помогла (LLMError), в базе ничего не меняется —
        вопрос можно отправить заново.
        """
        asked_at = utc_now()
        context: list[Message] = []
        if chat_id is not None:
            self._require(chat_id)
            # В чате лежат только пары «вопрос — ответ», поэтому контекст всегда начинается с вопроса.
            skipped = 2 if replace_last else 0  # заменяемую пару модель видеть не должна
            recent = self._chats.list_recent_messages(chat_id, self._context_exchanges * 2 + skipped)
            if len(recent) < skipped:
                raise NothingToReplace()
            context = recent[: len(recent) - skipped]
        turns = [ChatTurn(message.role, as_model_input(message.text, message.mode)) for message in context]
        turns.append(ChatTurn("user", as_model_input(text, mode)))

        chunks: list[str] = []
        for restarts_left in range(RESTARTS, -1, -1):
            chunks = []
            try:
                for chunk in self._llm.stream(SYSTEM_PROMPT, turns):
                    chunks.append(chunk)
                    yield AnswerChunk(chunk)
                break
            except LLMError as error:
                # Если не пришло ни одной части, клиент модели уже перебрал запасные модели сам.
                if not chunks or not restarts_left or error.failure not in TRANSIENT:
                    raise
                logger.warning("Ответ оборвался (%s), запрашиваем заново", error)
                yield AnswerRestart()

        answer = "".join(chunks).strip()
        if not answer:
            raise LLMError(LLMFailure.NO_ANSWER, "модель вернула пустой текст")

        chat, (user, assistant) = self._chats.save_exchange(
            chat_id,
            chat_title(text),
            [NewMessage("user", text, asked_at, mode), NewMessage("assistant", answer, utc_now())],
            replace_last=replace_last and chat_id is not None,
        )
        yield Exchange(chat=chat, user=user, assistant=assistant)

    def _require(self, chat_id: int) -> Chat:
        chat = self._chats.get_chat(chat_id)
        if chat is None:
            raise ChatNotFound()
        return chat
