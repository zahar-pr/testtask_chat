from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.progress.repository import Outcome


class AttemptRequest(BaseModel):
    message_id: int = Field(ge=1)  # ответ модели, в котором находится тренажёр
    block: int = Field(ge=0, le=20)  # какой по счёту тренажёр в этом ответе
    task: int = Field(ge=0, le=50)  # номер задания в тренажёре
    topic: str = Field(min_length=1, max_length=120)
    question: str = Field(min_length=1, max_length=500)
    outcome: Outcome


class TotalsResponse(BaseModel):
    first: int
    solved: int
    revealed: int


class TopicResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    topic: str
    tasks: int
    first: int


class MistakeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    topic: str
    question: str
    outcome: Outcome
    created_at: datetime


class ProgressResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    totals: TotalsResponse
    topics: list[TopicResponse]
    mistakes: list[MistakeResponse]
