from __future__ import annotations

from pydantic import BaseModel, field_validator

from app.auth.rules import access_key_problem


class LoginRequest(BaseModel):
    access_key: str

    @field_validator("access_key")
    @classmethod
    def _check_format(cls, value: str) -> str:
        if problem := access_key_problem(value):
            raise ValueError(problem)
        return value
