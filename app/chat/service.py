"""Сценарий чата: вопрос пользователя → ответ модели по частям → запись пары в историю."""

from __future__ import annotations

import logging
from collections.abc import Iterator
from dataclasses import dataclass

from app.chat.messages import Message, MessageRepository, NewMessage
from app.chat.prompt import SYSTEM_PROMPT
from app.clock import utc_now
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
    """Завершённая и сохранённая пара «вопрос — ответ»."""

    user: Message
    assistant: Message


logger = logging.getLogger(__name__)

# Сколько раз заново запросить ответ, если он оборвался на полуслове (с бесплатным Gemini
# это случается), и какие сбои считаются временными.
RESTARTS = 1
TRANSIENT = {LLMFailure.UNAVAILABLE, LLMFailure.TIMEOUT}

ChatEvent = AnswerChunk | AnswerRestart | Exchange


class ChatService:
    def __init__(self, messages: MessageRepository, llm: LLMClient, context_exchanges: int) -> None:
        self._messages = messages
        self._llm = llm
        self._context_exchanges = context_exchanges

    def history(self) -> list[Message]:
        return self._messages.list_all()

    def send(self, text: str) -> Iterator[ChatEvent]:
        """Спросить модель: сначала идут части ответа, последним — сохранённая пара.

        В историю попадают только завершённые пары. Если модель не ответила или ответ
        оборвался и повторная попытка не помогла (LLMError), в базе ничего не меняется —
        вопрос можно отправить заново.
        """
        asked_at = utc_now()
        # В истории лежат только пары «вопрос — ответ», поэтому контекст всегда начинается с вопроса.
        context = self._messages.list_recent(self._context_exchanges * 2)
        turns = [ChatTurn(message.role, message.text) for message in context]
        turns.append(ChatTurn("user", text))

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

        user, assistant = self._messages.add_many(
            [NewMessage("user", text, asked_at), NewMessage("assistant", answer, utc_now())]
        )
        yield Exchange(user=user, assistant=assistant)

    def clear(self) -> None:
        self._messages.delete_all()
