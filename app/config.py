"""Настройки приложения: читаются из переменных окружения и файла .env."""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Единые правила для ключа доступа: их же проверяет форма входа на фронтенде.
ACCESS_KEY_MIN_LENGTH = 8
ACCESS_KEY_MAX_LENGTH = 255
ACCESS_KEY_PATTERN = r"^[A-Za-z0-9_-]+$"

MESSAGE_MAX_LENGTH = 500

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- Доступ ---
    access_key: SecretStr = Field(description="Ключ доступа, который вводит пользователь")
    session_ttl_hours: int = Field(default=24 * 7, ge=1)
    login_max_attempts: int = Field(default=5, ge=1)
    login_window_seconds: int = Field(default=300, ge=1)

    # --- Языковая модель ---
    gemini_api_key: SecretStr
    gemini_model: str = "gemini-3.5-flash"
    # Запасные модели через запятую: к ним идём, если основная перегружена или недоступна.
    gemini_fallback_models: str = "gemini-3.5-flash-lite,gemini-3.1-flash-lite"
    gemini_timeout_seconds: float = Field(default=20, gt=0)
    # Сколько предыдущих пар «вопрос — ответ» передавать модели как контекст (0 — без контекста).
    context_exchanges: int = Field(default=5, ge=0, le=50)

    # --- Хранилище и сервер ---
    database_path: Path = BASE_DIR / "data" / "chat.sqlite3"
    host: str = "127.0.0.1"
    port: int = 8000

    @field_validator("access_key")
    @classmethod
    def _check_access_key(cls, value: SecretStr) -> SecretStr:
        key = value.get_secret_value()
        if not ACCESS_KEY_MIN_LENGTH <= len(key) <= ACCESS_KEY_MAX_LENGTH:
            raise ValueError(
                f"длина должна быть от {ACCESS_KEY_MIN_LENGTH} до {ACCESS_KEY_MAX_LENGTH} символов"
            )
        if not re.fullmatch(ACCESS_KEY_PATTERN, key):
            raise ValueError("допустимы только латинские буквы, цифры, дефис и подчёркивание")
        return value

    @field_validator("gemini_api_key")
    @classmethod
    def _check_gemini_api_key(cls, value: SecretStr) -> SecretStr:
        if not value.get_secret_value().strip():
            raise ValueError("не задан ключ Gemini API")
        return value

    @property
    def gemini_models(self) -> list[str]:
        fallbacks = [name.strip() for name in self.gemini_fallback_models.split(",")]
        return [self.gemini_model, *(name for name in fallbacks if name)]


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # значения приходят из окружения
