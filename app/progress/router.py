"""HTTP-эндпоинты прогресса: результаты тренажёров и сводка по ним."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request, status

from app.auth.dependencies import require_session
from app.progress.schemas import AttemptRequest, ProgressResponse
from app.progress.service import ProgressService

router = APIRouter(prefix="/api/progress", tags=["progress"], dependencies=[Depends(require_session)])


def get_progress_service(request: Request) -> ProgressService:
    return request.app.state.progress_service


Service = Annotated[ProgressService, Depends(get_progress_service)]


@router.post("/attempts", status_code=status.HTTP_204_NO_CONTENT)
def save_attempt(payload: AttemptRequest, progress: Service) -> None:
    progress.record_attempt(**payload.model_dump())


@router.get("", response_model=ProgressResponse)
def get_summary(progress: Service):
    return progress.summary()


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def reset(progress: Service) -> None:
    progress.reset()
