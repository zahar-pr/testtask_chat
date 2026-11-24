# Образ приложения: Python + зависимости + код. Собирать и запускать проще через docker compose.
FROM python:3.12-slim

WORKDIR /app

# Сначала зависимости: этот слой пересобирается, только когда меняется requirements.txt.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app app
COPY static static

# База лежит в отдельном томе и переживает пересоздание контейнера.
# Приложение работает от непривилегированного пользователя.
RUN useradd --system --no-create-home app && mkdir /data && chown app /data
USER app
VOLUME /data

ENV HOST=0.0.0.0 \
    PORT=8000 \
    DATABASE_PATH=/data/chat.sqlite3 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=2)"

CMD ["python", "-m", "app"]
