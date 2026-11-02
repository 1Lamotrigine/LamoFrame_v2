# --- Базовый образ ---
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DJANGO_SETTINGS_MODULE=config.settings

WORKDIR /app

# Системные зависимости: Pillow требует libjpeg/zlib, curl — для healthcheck.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl libjpeg62-turbo zlib1g libwebp7 \
    && rm -rf /var/lib/apt/lists/*

# Сначала зависимости — так кэш слоёв переиспользуется.
COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

# Исходники проекта.
COPY app/ ./app/

# Непривилегированный пользователь.
RUN useradd --create-home --uid 1000 appuser \
    && mkdir -p /app/app/media /app/app/staticfiles /data \
    && chown -R appuser:appuser /app /data

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER appuser

EXPOSE 8000

ENTRYPOINT ["/entrypoint.sh"]
CMD ["gunicorn", "config.wsgi:application", "--chdir", "/app/app", "--bind", "0.0.0.0:8000", "--workers", "1", "--threads", "4", "--timeout", "60"]
