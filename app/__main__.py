"""Запуск: `python -m app`."""

from __future__ import annotations

import sys

import uvicorn
from pydantic import ValidationError

from app.config import get_settings


def main() -> None:
    try:
        settings = get_settings()
    except ValidationError as error:
        problems = "\n".join(
            f"  {'.'.join(str(part) for part in item['loc']).upper()}: {item['msg'].removeprefix('Value error, ')}"
            for item in error.errors()
        )
        sys.exit(f"Не хватает настроек или они заданы неверно (см. .env.example):\n{problems}")

    uvicorn.run("app.main:create_app", factory=True, host=settings.host, port=settings.port)


if __name__ == "__main__":
    main()
