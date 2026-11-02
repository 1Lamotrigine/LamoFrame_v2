"""Контекст-процессоры: версия статики и карта модулей для шаблонов."""

from pathlib import Path

from django.conf import settings


def asset_version(request):
    return {"ASSET_VERSION": getattr(settings, "ASSET_VERSION", "1")}


def module_map(request):
    """Список ES-модулей приложения для import map с версией.

    Собираем имена файлов из static/js, чтобы в шаблоне построить import map
    вида "/static/js/render.js?v=123": так браузер не держит старые модули
    после правок без хешей в имени (актуально для DEBUG).
    """
    js_dir = Path(settings.BASE_DIR) / "static" / "js"
    names = []
    if js_dir.is_dir():
        names = sorted(p.name for p in js_dir.glob("*.js"))
    return {"MODULE_NAMES": names}


def social_auth(request):
    """Показывать ли вход через Google.

    Провайдер активен только когда заданы GOOGLE_CLIENT_ID/SECRET; без ключей
    кнопку не рендерим, чтобы не вести пользователя в тупик.
    """
    return {"google_oauth_enabled": bool(getattr(settings, "GOOGLE_OAUTH_ENABLED", False))}
