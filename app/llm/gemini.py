"""Клиент Google Gemini API (REST, generateContent)."""

from __future__ import annotations

import logging
from collections.abc import Sequence

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
        self._http = http_client or httpx.Client(timeout=timeout_seconds)
        self._headers = {"x-goog-api-key": api_key}

    def close(self) -> None:
        self._http.close()

    def generate(self, system_prompt: str, turns: Sequence[ChatTurn]) -> str:
        payload = {
            "system_instruction": {"parts": [{"text": system_prompt}]},
            "contents": [
                {"role": _ROLE_NAMES[turn.role], "parts": [{"text": turn.text}]} for turn in turns
            ],
            "generationConfig": {"temperature": 0.3, "maxOutputTokens": 8192},
        }
        last_error: LLMError | None = None
        for model in self._models:
            try:
                return self._request(model, payload)
            except LLMError as error:
                if error.failure in _FATAL:
                    raise
                logger.warning("Модель %s не ответила (%s): %s", model, error.failure.value, error)
                last_error = error
        assert last_error is not None
        raise last_error

    def _request(self, model: str, payload: dict) -> str:
        try:
            response = self._http.post(
                f"{API_ROOT}/models/{model}:generateContent", json=payload, headers=self._headers
            )
        except httpx.TimeoutException as error:
            raise LLMError(LLMFailure.TIMEOUT, f"{model}: таймаут") from error
        except httpx.HTTPError as error:
            raise LLMError(LLMFailure.UNAVAILABLE, f"{model}: {error!r}") from error

        if response.status_code != 200:
            raise LLMError(_failure_for_status(response.status_code), f"{model}: {_error_detail(response)}")

        try:
            return _extract_text(response.json())
        except ValueError as error:  # ответ не в формате JSON
            raise LLMError(LLMFailure.UNAVAILABLE, f"{model}: неразборчивый ответ") from error


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


def _extract_text(body: dict) -> str:
    candidates = body.get("candidates") or []
    if not candidates:
        reason = (body.get("promptFeedback") or {}).get("blockReason", "нет вариантов ответа")
        raise LLMError(LLMFailure.NO_ANSWER, f"пустой ответ: {reason}")

    candidate = candidates[0]
    parts = (candidate.get("content") or {}).get("parts") or []
    text = "".join(part.get("text", "") for part in parts if not part.get("thought")).strip()
    if not text:
        raise LLMError(LLMFailure.NO_ANSWER, f"пустой ответ: {candidate.get('finishReason')}")
    return text
