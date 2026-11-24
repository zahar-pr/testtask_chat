"""Сборка приложения: настройки → хранилище → сервисы → маршруты."""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import timedelta
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.auth.rate_limit import LoginRateLimiter
from app.auth.router import router as auth_router
from app.auth.service import AuthService
from app.auth.sessions import SessionRepository
from app.chat.repository import ChatRepository
from app.chat.router import router as chat_router
from app.chat.service import ChatService
from app.config import Settings, get_settings
from app.db import Database
from app.errors import register_error_handlers
from app.llm.base import LLMClient
from app.llm.gemini import GeminiClient
from app.progress.repository import ProgressRepository
from app.progress.router import router as progress_router
from app.security import SameOriginMiddleware, SecurityHeadersMiddleware

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

def create_app(settings: Settings | None = None, llm: LLMClient | None = None) -> FastAPI:
    """Фабрика приложения. В тестах сюда передают свои настройки и подставную модель."""
    settings = settings or get_settings()

    database = Database(settings.database_path)
    database.migrate()

    gemini: GeminiClient | None = None
    if llm is None:
        gemini = GeminiClient(
            api_key=settings.gemini_api_key.get_secret_value(),
            models=settings.gemini_models,
            timeout_seconds=settings.gemini_timeout_seconds,
        )
        llm = gemini

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
        if gemini is not None:
            gemini.close()

    app = FastAPI(
        title="Чат-помощник по математике", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan
    )

    app.state.auth_service = AuthService(
        access_key=settings.access_key.get_secret_value(),
        sessions=SessionRepository(database),
        session_ttl=timedelta(hours=settings.session_ttl_hours),
    )
    app.state.login_rate_limiter = LoginRateLimiter(
        max_attempts=settings.login_max_attempts, window_seconds=settings.login_window_seconds
    )
    app.state.progress = ProgressRepository(database)
    app.state.chat_service = ChatService(
        chats=ChatRepository(database),
        llm=llm,
        context_exchanges=settings.context_exchanges,
        progress=app.state.progress,
    )

    register_error_handlers(app)
    app.include_router(auth_router)
    app.include_router(chat_router)
    app.include_router(progress_router)

    app.add_middleware(SameOriginMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)  # добавлен последним — оборачивает все ответы, включая отказы

    @app.get("/api/health", include_in_schema=False)
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/", include_in_schema=False)
    def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-cache"})

    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
    return app
