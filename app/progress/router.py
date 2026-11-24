"""HTTP-эндпоинты прогресса: результаты тренажёров и сводка по ним."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, ConfigDict, Field

from app.auth.dependencies import require_session
from app.clock import utc_now
from app.progress.repository import Outcome, ProgressRepository

MISTAKES_SHOWN = 20

router = APIRouter(prefix="/api/progress", tags=["progress"], dependencies=[Depends(require_session)])


def get_progress(request: Request) -> ProgressRepository:
    return request.app.state.progress


Progress = Annotated[ProgressRepository, Depends(get_progress)]


class AttemptRequest(BaseModel):
    message_id: int = Field(ge=1)  # ответ модели, в котором находится тренажёр
    block: int = Field(ge=0, le=20)  # какой по счёту тренажёр в этом ответе
    task: int = Field(ge=0, le=50)  # номер задания в тренажёре
    topic: str = Field(min_length=1, max_length=120)
    question: str = Field(min_length=1, max_length=1000)
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
    totals: TotalsResponse
    topics: list[TopicResponse]
    mistakes: list[MistakeResponse]


@router.post("/attempts", status_code=status.HTTP_204_NO_CONTENT)
def save_attempt(payload: AttemptRequest, progress: Progress) -> None:
    progress.save(
        payload.message_id, payload.block, payload.task, payload.topic.strip(), payload.question.strip(),
        payload.outcome, utc_now(),
    )


@router.get("", response_model=ProgressResponse)
def get_summary(progress: Progress):
    return {
        "totals": progress.totals(),
        "topics": progress.by_topic(),
        "mistakes": progress.mistakes(MISTAKES_SHOWN),
    }


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def reset(progress: Progress) -> None:
    progress.clear()
