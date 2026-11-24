"""Клиент Google Gemini API (REST, streamGenerateContent: ответ приходит по частям)."""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator, Sequence

import httpx

from app.llm.base import ChatTurn, LLMError, LLMFailure

logger = logging.getLogger(__name__)

API_ROOT = "https://generativelanguage.googleapis.com/v1beta"
_ROLE_NAMES = {"user": "user", "assistant": "model"}

# Сбои, после которых нет смысла пробовать другую модель: дело в ключе или в самом запросе.
_FATAL = {LLMFailure.MISCONFIGURED, LLMFailure.NO_ANSWER}


class GeminiClient:
    def __init__(
        self,
        api_key: str,
        models: Sequence[str],
        timeout_seconds: float = 20,
        http_client: httpx.Client | None = None,
    ) -> None:
        if not models:
            raise ValueError("нужна хотя бы одна модель")
        self._models = list(models)
        # Таймаут — на ожидание очередной части ответа, а не на весь ответ целиком.
        self._http = http_client or httpx.Client(timeout=timeout_seconds)
        self._headers = {"x-goog-api-key": api_key}

    def close(self) -> None:
        self._http.close()

    def stream(self, system_prompt: str, turns: Sequence[ChatTurn]) -> Iterator[str]:
        payload = {
            "system_instruction": {"parts": [{"text": system_prompt}]},
            "contents": [
                {"role": _ROLE_NAMES[turn.role], "parts": [{"text": turn.text}]} for turn in turns
            ],
            "generationConfig": {"temperature": 0.3, "maxOutputTokens": 8192},
        }
        last_error: LLMError | None = None
        for model in self._models:
            started = False
            try:
                for chunk in self._stream_model(model, payload):
                    started = True
                    yield chunk
                return
            except LLMError as error:
                # Запасная модель выручает, только пока пользователю ещё ничего не показано:
                # иначе к началу одного ответа приклеилось бы продолжение другого.
                if started or error.failure in _FATAL:
                    raise
                logger.warning("Модель %s не ответила (%s): %s", model, error.failure.value, error)
                last_error = error
        assert last_error is not None
        raise last_error

    def _stream_model(self, model: str, payload: dict) -> Iterator[str]:
        url = f"{API_ROOT}/models/{model}:streamGenerateContent"
        got_text = False
        last_event: dict = {}
        try:
            with self._http.stream(
                "POST", url, params={"alt": "sse"}, json=payload, headers=self._headers
            ) as response:
                if response.status_code != 200:
                    response.read()
                    raise LLMError(
                        _failure_for_status(response.status_code), f"{model}: {_error_detail(response)}"
                    )
                for line in response.iter_lines():
                    if not line.startswith("data:"):
                        continue
                    last_event = json.loads(line[len("data:"):])
                    if text := _event_text(last_event):
                        got_text = True
                        yield text
        except httpx.TimeoutException as error:
            raise LLMError(LLMFailure.TIMEOUT, f"{model}: таймаут") from error
        except httpx.HTTPError as error:
            raise LLMError(LLMFailure.UNAVAILABLE, f"{model}: {error!r}") from error
        except ValueError as error:  # часть ответа не в формате JSON
            raise LLMError(LLMFailure.UNAVAILABLE, f"{model}: неразборчивый ответ") from error

        if not got_text:
            raise LLMError(LLMFailure.NO_ANSWER, f"{model}: пустой ответ ({_empty_reason(last_event)})")


def _failure_for_status(status_code: int) -> LLMFailure:
    if status_code == 429:
        return LLMFailure.RATE_LIMITED
    if status_code in (400, 401, 403):
        return LLMFailure.MISCONFIGURED
    # 404 — модель снята с поддержки, 5xx — перегрузка: в обоих случаях поможет запасная модель.
    return LLMFailure.UNAVAILABLE


def _error_detail(response: httpx.Response) -> str:
    try:
        return f"{response.status_code} {response.json()['error']['message']}"
    except (ValueError, KeyError, TypeError):
        return f"{response.status_code} {response.text[:200]}"


def _event_text(event: dict) -> str:
    candidates = event.get("candidates") or [{}]
    parts = (candidates[0].get("content") or {}).get("parts") or []
    # Части с пометкой thought — рассуждения модели, пользователю их не показываем.
    return "".join(part.get("text", "") for part in parts if not part.get("thought"))


def _empty_reason(event: dict) -> str:
    block_reason = (event.get("promptFeedback") or {}).get("blockReason")
    finish_reason = (event.get("candidates") or [{}])[0].get("finishReason")
    return str(block_reason or finish_reason or "нет вариантов ответа")
