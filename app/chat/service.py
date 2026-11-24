"""Сценарий чата: вопрос пользователя → ответ модели → запись пары в историю."""

from __future__ import annotations

from dataclasses import dataclass

from app.chat.messages import Message, MessageRepository, NewMessage
from app.chat.prompt import SYSTEM_PROMPT
from app.clock import utc_now
from app.llm.base import ChatTurn, LLMClient


@dataclass(frozen=True)
class Exchange:
    user: Message
    assistant: Message


class ChatService:
    def __init__(self, messages: MessageRepository, llm: LLMClient, context_exchanges: int) -> None:
        self._messages = messages
        self._llm = llm
        self._context_exchanges = context_exchanges

    def history(self) -> list[Message]:
        return self._messages.list_all()

    def send(self, text: str) -> Exchange:
        """Спросить модель и сохранить вопрос с ответом.

        В историю попадают только завершённые пары: если модель не ответила, исключение
        уходит наверх, а в базе ничего не меняется — вопрос можно просто отправить заново.
        """
        asked_at = utc_now()
        # В истории лежат только пары «вопрос — ответ», поэтому контекст всегда начинается с вопроса.
        context = self._messages.list_recent(self._context_exchanges * 2)
        turns = [ChatTurn(message.role, message.text) for message in context]
        turns.append(ChatTurn("user", text))

        answer = self._llm.generate(SYSTEM_PROMPT, turns)

        user, assistant = self._messages.add_many(
            [NewMessage("user", text, asked_at), NewMessage("assistant", answer, utc_now())]
        )
        return Exchange(user=user, assistant=assistant)

    def clear(self) -> None:
        self._messages.delete_all()
