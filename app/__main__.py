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

    uvicorn.run(
        "app.main:create_app",
        factory=True,
        host=settings.host,
        port=settings.port,
        # Заголовкам X-Forwarded-* верим только от перечисленных прокси: иначе клиент мог бы
        # подделать свой адрес и обойти ограничение попыток входа.
        proxy_headers=True,
        forwarded_allow_ips=settings.trusted_proxies,
    )


if __name__ == "__main__":
    main()
