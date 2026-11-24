"""Сценарии чата: список чатов, история, вопрос → ответ модели по частям → запись пары."""

from __future__ import annotations

import logging
from collections.abc import Generator, Iterator, Sequence
from dataclasses import dataclass
from typing import Protocol

from app.chat.errors import ChatChanged, ChatNotFound, NothingToReview
from app.chat.modes import REVIEW, as_model_input, review_request
from app.chat.prompt import SYSTEM_PROMPT
from app.chat.repository import Chat, ChatRepository, Message, NewMessage
from app.chat.titles import chat_title
from app.clock import utc_now
from app.llm.base import ChatTurn, LLMClient, LLMError, LLMFailure

logger = logging.getLogger(__name__)

# Сколько раз заново запросить ответ, если он оборвался на полуслове (с бесплатным Gemini
# это случается), и какие сбои считаются временными — только их есть смысл повторять.
RESTARTS = 1
TRANSIENT = {LLMFailure.UNAVAILABLE, LLMFailure.TIMEOUT}
# Сколько последних ошибок показывать модели в режиме «работа над ошибками».
REVIEW_TASKS = 6


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


ChatEvent = AnswerChunk | AnswerRestart | Exchange


class MistakeSource(Protocol):
    """Откуда чат берёт задания, в которых ученик ошибся (см. app/progress/service.py)."""

    def recent_mistakes(self, limit: int) -> Sequence[tuple[str, str]]:
        """Пары (тема, текст задания), начиная с самых свежих."""
        ...


class ChatService:
    def __init__(
        self, chats: ChatRepository, llm: LLMClient, context_exchanges: int, mistakes: MistakeSource
    ) -> None:
        self._chats = chats
        self._llm = llm
        self._context_messages = context_exchanges * 2  # пара — это два сообщения
        self._mistakes = mistakes

    def chats(self) -> list[Chat]:
        return self._chats.list_chats()

    def history(self, chat_id: int) -> list[Message]:
        if self._chats.get_chat(chat_id) is None:
            raise ChatNotFound()
        return self._chats.list_messages(chat_id)

    def delete(self, chat_id: int) -> None:
        self._chats.delete_chat(chat_id)

    def send(
        self, text: str, mode: str | None = None, chat_id: int | None = None, replace_last: bool = False
    ) -> Iterator[ChatEvent]:
        """Спросить модель: сначала идут части ответа, последним — сохранённая пара.

        chat_id — чат, в котором задан вопрос; без него вопрос начинает новый чат.
        mode — заготовка: в истории хранится собственный текст пользователя, а модель получает
        запрос с названием режима.
        replace_last — вопрос заменяет последнюю пару чата («ответить заново», правка вопроса).

        В историю попадают только завершённые пары. Если модель не ответила (LLMError),
        в базе ничего не меняется — вопрос можно отправить заново.
        """
        asked_at = utc_now()
        context, replaced = self._context(chat_id, replace_last)
        turns = [ChatTurn(message.role, as_model_input(message.text, message.mode)) for message in context]
        turns.append(ChatTurn("user", self._model_input(text, mode)))

        answer = yield from self._stream_with_restart(turns)

        exchange = [NewMessage("user", text, asked_at, mode), NewMessage("assistant", answer, utc_now())]
        if chat_id is None:
            chat, (user, assistant) = self._chats.create_chat(chat_title(text), exchange)
        elif replaced:
            replaced_ids = [message.id for message in replaced]
            chat, (user, assistant) = self._chats.replace_exchange(chat_id, replaced_ids, chat_title(text), exchange)
        else:
            chat, (user, assistant) = self._chats.append_exchange(chat_id, exchange)
        yield Exchange(chat=chat, user=user, assistant=assistant)

    def _context(self, chat_id: int | None, replace_last: bool) -> tuple[list[Message], list[Message]]:
        """Что модель увидит из прошлой переписки и какую пару новый вопрос заменит.

        В чате лежат только пары «вопрос — ответ», поэтому контекст всегда начинается с вопроса.
        Заменяемую пару модель не видит.
        """
        if chat_id is None:
            return [], []
        if self._chats.get_chat(chat_id) is None:
            raise ChatNotFound()
        if not replace_last:
            return self._chats.list_recent_messages(chat_id, self._context_messages), []

        recent = self._chats.list_recent_messages(chat_id, self._context_messages + 2)
        if len(recent) < 2:
            raise ChatChanged()
        return recent[:-2], recent[-2:]

    def _model_input(self, text: str, mode: str | None) -> str:
        """Новый вопрос в том виде, в каком его получит модель."""
        if mode != REVIEW:
            return as_model_input(text, mode)
        mistakes = self._mistakes.recent_mistakes(REVIEW_TASKS)
        if not mistakes:
            raise NothingToReview()
        return review_request(text, mistakes)

    def _stream_with_restart(self, turns: list[ChatTurn]) -> Generator[AnswerChunk | AnswerRestart, None, str]:
        """Отдавать части ответа по мере генерации; вернуть ответ целиком.

        Если ответ оборвался из-за временного сбоя, он один раз запрашивается заново.
        Сбой до первой части не повторяем: клиент модели к этому моменту уже перебрал запасные модели.
        """
        restarts_left = RESTARTS
        while True:
            chunks: list[str] = []
            try:
                for chunk in self._llm.stream(SYSTEM_PROMPT, turns):
                    chunks.append(chunk)
                    yield AnswerChunk(chunk)
            except LLMError as error:
                if not chunks or not restarts_left or error.failure not in TRANSIENT:
                    raise
                restarts_left -= 1
                logger.warning("Ответ оборвался (%s), запрашиваем заново", error)
                yield AnswerRestart()
                continue

            answer = "".join(chunks).strip()
            if not answer:
                raise LLMError(LLMFailure.NO_ANSWER, "модель вернула пустой текст")
            return answer
