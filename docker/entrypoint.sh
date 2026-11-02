#!/usr/bin/env sh
set -e

cd /app/app

# Директории для данных (в контейнере могут быть смонтированы как volume).
mkdir -p media staticfiles

echo "→ Миграции базы данных…"
python manage.py migrate --noinput

echo "→ Сбор статики…"
python manage.py collectstatic --noinput

# Создаём демо-пользователя и пример проекта, если их ещё нет.
if [ "${SEED_DEMO:-1}" = "1" ]; then
  echo "→ Демо-данные…"
  python manage.py seed_demo || true
fi

echo "→ Готово. Запуск: $*"
exec "$@"
