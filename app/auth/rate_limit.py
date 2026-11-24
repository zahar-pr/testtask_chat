"""Ограничение перебора ключа: не больше N попыток входа с одного адреса за окно времени."""

from __future__ import annotations

import math
import threading
import time
from collections import deque
from collections.abc import Callable


class LoginRateLimiter:
    """Счётчик живёт в памяти процесса — для одного экземпляра приложения этого достаточно."""

    def __init__(
        self, max_attempts: int, window_seconds: int, timer: Callable[[], float] = time.monotonic
    ) -> None:
        self._max_attempts = max_attempts
        self._window = window_seconds
        self._timer = timer
        self._attempts: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def attempt(self, client: str) -> int:
        """Учесть попытку входа. 0 — попытка разрешена; иначе — сколько секунд клиенту ждать.

        Проверка и учёт — одно действие под одним замком: параллельные запросы не могут
        все разом «проскочить» мимо лимита.
        """
        with self._lock:
            now = self._timer()
            attempts = self._attempts.get(client)
            if attempts is not None:
                while attempts and attempts[0] <= now - self._window:
                    attempts.popleft()
                if not attempts:  # окно истекло — запись об адресе больше не нужна
                    del self._attempts[client]
                    attempts = None
            if attempts is not None and len(attempts) >= self._max_attempts:
                return max(1, math.ceil(attempts[0] + self._window - now))
            self._attempts.setdefault(client, deque()).append(now)
            return 0

    def forgive(self, client: str) -> None:
        """Вход удался — попытки этого адреса больше не считаются."""
        with self._lock:
            self._attempts.pop(client, None)
