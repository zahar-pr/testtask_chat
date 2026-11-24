from __future__ import annotations

import re

from pydantic import BaseModel, field_validator

from app.config import ACCESS_KEY_MAX_LENGTH, ACCESS_KEY_MIN_LENGTH, ACCESS_KEY_PATTERN


class LoginRequest(BaseModel):
    access_key: str

    @field_validator("access_key")
    @classmethod
    def _check_format(cls, value: str) -> str:
        if not ACCESS_KEY_MIN_LENGTH <= len(value) <= ACCESS_KEY_MAX_LENGTH:
            raise ValueError(
                f"Ключ доступа должен быть длиной от {ACCESS_KEY_MIN_LENGTH} до {ACCESS_KEY_MAX_LENGTH} символов."
            )
        if not re.fullmatch(ACCESS_KEY_PATTERN, value):
            raise ValueError("В ключе допустимы только латинские буквы, цифры, дефис и подчёркивание.")
        return value
