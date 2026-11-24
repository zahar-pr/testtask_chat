"""Ограничение перебора ключа: не больше N неудачных попыток с одного адреса за окно времени."""

from __future__ import annotations

import math
import threading
import time
from collections import defaultdict, deque
from collections.abc import Callable


class LoginRateLimiter:
    """Счётчик живёт в памяти процесса — для одного экземпляра приложения этого достаточно."""

    def __init__(
        self, max_attempts: int, window_seconds: int, timer: Callable[[], float] = time.monotonic
    ) -> None:
        self._max_attempts = max_attempts
        self._window = window_seconds
        self._timer = timer
        self._failures: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def retry_after(self, client: str) -> int:
        """Сколько секунд клиенту нужно подождать; 0 — можно пробовать."""
        with self._lock:
            failures = self._recent(client)
            if len(failures) < self._max_attempts:
                return 0
            return max(1, math.ceil(failures[0] + self._window - self._timer()))

    def record_failure(self, client: str) -> None:
        with self._lock:
            self._recent(client).append(self._timer())

    def reset(self, client: str) -> None:
        with self._lock:
            self._failures.pop(client, None)

    def _recent(self, client: str) -> deque[float]:
        failures = self._failures[client]
        threshold = self._timer() - self._window
        while failures and failures[0] <= threshold:
            failures.popleft()
        return failures
