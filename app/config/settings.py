"""
Django settings for the site builder prototype.
"""
from pathlib import Path
import json
import os
import secrets

BASE_DIR = Path(__file__).resolve().parent.parent

DEBUG = os.environ.get("DJANGO_DEBUG", "1") == "1"

SECRET_KEY = (os.environ.get("DJANGO_SECRET_KEY") or "").strip()
if not SECRET_KEY:
    if DEBUG:
        # Стабильный ключ нужен только локально, чтобы сессии не сбрасывались.
        SECRET_KEY = "django-insecure-dev-only-site-builder-change-me-in-production"
    else:
        # В проде не подставляем известный ключ: генерируем эфемерный.
        # Он сбросит сессии при рестарте, зато не позволит подделать подпись.
        SECRET_KEY = secrets.token_urlsafe(50)

_default_hosts = "*" if DEBUG else "localhost,127.0.0.1,[::1]"
ALLOWED_HOSTS = [
    h.strip() for h in os.environ.get("DJANGO_ALLOWED_HOSTS", _default_hosts).split(",") if h.strip()
]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # allauth требует sites: провайдеры привязаны к конкретному сайту.
    "django.contrib.sites",
    # Аутентификация через соцсети (Google). account — базовый слой,
    # socialaccount — сами OAuth-провайдеры.
    "allauth",
    "allauth.account",
    "allauth.socialaccount",
    "allauth.socialaccount.providers.google",
    "builder",
]

# ID текущего сайта для django.contrib.sites. При одном сайте всегда 1.
SITE_ID = int(os.environ.get("DJANGO_SITE_ID", "1"))

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "config.middleware.NoCacheInDebugMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    # allauth после AuthenticationMiddleware: подчищает «полуавторизацию»
    # между локальным аккаунтом и привязанным соцаккаунтом.
    "allauth.account.middleware.AccountMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
                "builder.context_processors.asset_version",
                "builder.context_processors.module_map",
                "builder.context_processors.social_auth",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": os.environ.get("SQLITE_PATH", str(BASE_DIR / "db.sqlite3")),
        # SQLite плохо переносит параллельные записи: даём блокировке больше
        # времени вместо мгновенной ошибки "database is locked".
        "OPTIONS": {"timeout": 20},
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "ru-ru"
TIME_ZONE = "Europe/Moscow"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATICFILES_DIRS = [BASE_DIR / "static"]
STATIC_ROOT = BASE_DIR / "staticfiles"


def _asset_version():
    """Версия статики для ?v= в теге script/css и карте ES-модулей.

    Браузер кеширует ES-модули очень агрессивно (в проде — на год), поэтому
    ?v должен МЕНЯТЬСЯ при каждой сборке статики. Иначе после обновления кода
    браузер подставляет старый state.js к новому editor.js и приложение
    падает с «doesn't provide an export named».

    - ASSET_VERSION из окружения — если задан вручную (CI);
    - DEBUG — по времени изменения файлов в static/ (мгновенные правки);
    - прод — хеш манифеста staticfiles.json (меняется после collectstatic).
    """
    override = os.environ.get("ASSET_VERSION")
    if override:
        return override

    if DEBUG:
        latest = 0.0
        for path in (BASE_DIR / "static").rglob("*"):
            if path.is_file() and path.suffix in {".js", ".css", ".svg"}:
                try:
                    latest = max(latest, path.stat().st_mtime)
                except OSError:
                    continue
        return str(int(latest)) if latest else "1"

    # Прод: берём хеш манифеста — collectstatic перезаписывает его при
    # каждой сборке, так что версия всегда соответствует содержимому.
    manifest = Path(STATIC_ROOT) / "staticfiles.json"
    try:
        data = json.loads(manifest.read_text("utf-8"))
        digest = data.get("hash")
        if digest:
            return str(digest)[:12]
        stamp = int(manifest.stat().st_mtime)
        return str(stamp)
    except (OSError, ValueError):
        # Манифеста нет (например, ещё не собирали) — деградируем безопасно.
        return "1"


ASSET_VERSION = _asset_version()

STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}
WHITENOISE_USE_FINDERS = DEBUG
WHITENOISE_AUTOREFRESH = DEBUG
# Хеш-имена неизменяемы, поэтому в проде их можно кешировать на год.
WHITENOISE_MAX_AGE = 0 if DEBUG else 31536000

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LOGIN_URL = "login"
LOGIN_REDIRECT_URL = "dashboard"
LOGOUT_REDIRECT_URL = "login"

# --- Аутентификация через соцсети (django-allauth) ---------------------------
# Локальные логин/регистрация остаются нашими (builder.views), allauth
# подключается ради OAuth-флоу Google. Backend добавляем ПОСЛЕ штатного,
# чтобы пароли и сессии работали как раньше, а соцвход — как дополнение.
AUTHENTICATION_BACKENDS = [
    "django.contrib.auth.backends.ModelBackend",
    "allauth.account.auth_backends.AuthenticationBackend",
]

# Вход/регистрация: allauth принимает логин ИЛИ email, но наши формы
# остаются основными. Пароль вводится дважды, email опционально.
ACCOUNT_LOGIN_METHODS = {"username", "email"}
ACCOUNT_SIGNUP_FIELDS = ["username*", "email", "password1*", "password2*"]
ACCOUNT_EMAIL_VERIFICATION = "none"
ACCOUNT_UNIQUE_EMAIL = True
ACCOUNT_USER_MODEL_USERNAME_FIELD = "username"
ACCOUNT_USER_MODEL_EMAIL_FIELD = "email"
# Наш кастомный выход (POST-форма в dashboard) не трогаем.
ACCOUNT_ADAPTER = "builder.adapters.LamoFrameAccountAdapter"

# Провайдер Google живёт только когда заданы ключи из Google Cloud Console.
# Без них кнопка «Войти через Google» просто не показывается — сайт работает.
GOOGLE_CLIENT_ID = (os.environ.get("GOOGLE_CLIENT_ID") or "").strip()
GOOGLE_CLIENT_SECRET = (os.environ.get("GOOGLE_CLIENT_SECRET") or "").strip()
GOOGLE_OAUTH_ENABLED = bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)

SOCIALACCOUNT_PROVIDERS = {}
if GOOGLE_OAUTH_ENABLED:
    SOCIALACCOUNT_PROVIDERS["google"] = {
        "APP": {
            "client_id": GOOGLE_CLIENT_ID,
            "secret": GOOGLE_CLIENT_SECRET,
            "key": "",
        },
        # openid+email+profile дают устойчивый идентификатор и базовые данные.
        "SCOPE": ["profile", "email"],
        "AUTH_PARAMS": {"access_type": "online"},
        "OAUTH_PKCE_ENABLED": True,
    }

# Автоматически создаём аккаунт при первом входе через Google, адрес почты
# считаем подтверждённым (его проверяет сам Google), и не спрашиваем логин
# повторно — берём username из email.
SOCIALACCOUNT_AUTO_SIGNUP = True
SOCIALACCOUNT_LOGIN_ON_GET = False
SOCIALACCOUNT_EMAIL_AUTHENTICATION = True
SOCIALACCOUNT_EMAIL_AUTHENTICATION_AUTO_CONNECT = True
SOCIALACCOUNT_EMAIL_VERIFICATION = "none"
SOCIALACCOUNT_ADAPTER = "builder.adapters.LamoFrameSocialAccountAdapter"
# Аутентификация через ссылку на почту нам не нужна (нет почтового бэкенда).
ACCOUNT_LOGIN_BY_CODE_ENABLED = False

# Uploads are checked in the view as well; this is a second line of defence.
DATA_UPLOAD_MAX_MEMORY_SIZE = 12 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 4 * 1024 * 1024
CSRF_COOKIE_HTTPONLY = False
X_FRAME_OPTIONS = "SAMEORIGIN"

# --- Прод-безопасность -------------------------------------------------------
# Флаги включаются явно: локальный Docker работает по HTTP на localhost:8000,
# и безусловные Secure-cookies сломали бы вход. На реальном HTTPS-деплое
# задайте DJANGO_SECURE_COOKIES=1 и DJANGO_HTTPS=1.
_secure_cookies = os.environ.get("DJANGO_SECURE_COOKIES", "0") == "1"
_https = os.environ.get("DJANGO_HTTPS", "0") == "1"

SESSION_COOKIE_SECURE = _secure_cookies
CSRF_COOKIE_SECURE = _secure_cookies
SESSION_COOKIE_HTTPONLY = True
SECURE_SSL_REDIRECT = _https and not DEBUG
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
USE_X_FORWARDED_HOST = _https
SECURE_HSTS_SECONDS = int(os.environ.get("DJANGO_HSTS_SECONDS", "0"))
SECURE_HSTS_INCLUDE_SUBDOMAINS = SECURE_HSTS_SECONDS > 0
SECURE_HSTS_PRELOAD = SECURE_HSTS_SECONDS > 0
SECURE_CONTENT_TYPE_NOSNIFF = True
CSRF_TRUSTED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("DJANGO_CSRF_TRUSTED_ORIGINS", "").split(",")
    if origin.strip()
]

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "std": {"format": "%(asctime)s %(levelname)s %(name)s: %(message)s"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "std"},
    },
    "root": {"handlers": ["console"], "level": os.environ.get("DJANGO_LOG_LEVEL", "INFO")},
}
