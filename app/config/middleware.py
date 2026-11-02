"""Middleware для локальной разработки: запрещаем кеширование.

В DEBUG браузер иначе может держать старые ES-модули (у них нет хешей в имени),
и правки в JS/CSS не видны без жёсткого обновления. В продакшене имя файла
хешируется, поэтому там middleware ничего не делает.
"""

from django.conf import settings


class NoCacheInDebugMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response
        self.enabled = settings.DEBUG

    def __call__(self, request):
        response = self.get_response(request)
        if self.enabled and not response.has_header("Cache-Control"):
            response["Cache-Control"] = "no-store, max-age=0"
        return response
