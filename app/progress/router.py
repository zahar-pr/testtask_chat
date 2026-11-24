"""HTTP-эндпоинты прогресса: результаты тренажёров и сводка по ним."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request, status

from app.auth.dependencies import require_session
from app.clock import utc_now
from app.progress.repository import ProgressRepository
from app.progress.schemas import AttemptRequest, ProgressResponse

MISTAKES_SHOWN = 20

router = APIRouter(prefix="/api/progress", tags=["progress"], dependencies=[Depends(require_session)])


def get_progress(request: Request) -> ProgressRepository:
    return request.app.state.progress


Progress = Annotated[ProgressRepository, Depends(get_progress)]


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
