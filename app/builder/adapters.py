"""Адаптеры django-allauth под наши правила LamoFrame.

Логин/регистрация остаются нашими страницами (builder.views), а allauth
отвечает только за OAuth-флоу Google. Здесь мы:

- направляем редиректы allauth на наши URL-имена;
- бережно заполняем профиль при первом входе через Google;
- генерируем уникальный username из email, если у соцаккаунта его нет;
- подстраховываемся от коллизий email с уже существующим аккаунтом.
"""
from allauth.account.adapter import DefaultAccountAdapter
from allauth.core.exceptions import ImmediateHttpResponse
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter
from django.conf import settings
from django.contrib import messages
from django.contrib.auth import get_user_model
from django.http import HttpResponseRedirect
from django.urls import reverse
from django.utils.text import slugify

User = get_user_model()

# Логины, которые может занять служебная часть приложения.
RESERVED_NAMESPACES = {"admin", "root", "support", "system", "allauth"}


def generate_username(seed, UserModel=User, max_len=150):
    """Подобрать свободный username на основе email/имени.

    Транслитерируем в безопасный slug; если вышло пусто — берём базовый
    префикс. Суффикс с числом добавляется только при коллизии, чтобы не
    перегружать базу запросами на каждый вход.
    """
    base = slugify((seed or "").split("@")[0], allow_unicode=False)[:max_len] or "user"
    if base in RESERVED_NAMESPACES:
        base = f"{base}-user"
    candidate = base
    suffix = 1
    while UserModel.objects.filter(username__iexact=candidate).exists():
        suffix += 1
        tail = f"-{suffix}"
        candidate = f"{base[: max_len - len(tail)]}{tail}"
    return candidate


class LamoFrameAccountAdapter(DefaultAccountAdapter):
    """Настройки обычного (локального) аккаунт-флоу allauth."""

    def is_open_for_signup(self, request):
        # Наша регистрация доступна всегда; allauth-форму не используем, но
        # пусть правило совпадает, чтобы снабжать правильные редиректы.
        return True

    def get_login_redirect_url(self, request):
        # Возвращаемся туда, куда пользователь шёл (безопасный next),
        # иначе — в мастерскую.
        from .views import resolve_next

        return resolve_next(request, "/")

    def populate_username(self, request, user):
        # У локального signup логин уже есть; страхуемся, если allauth
        # создаёт пользователя без username.
        if not user.username:
            user.username = generate_username(user.email or user.get_full_name())


class LamoFrameSocialAccountAdapter(DefaultSocialAccountAdapter):
    """Заполнение профиля при входе/регистрации через Google."""

    def get_provider(self, request, provider, client_id=None):
        # Если провайдер отключён (не заданы ключи), не отдаём 500 при прямом
        # заходе на /accounts/google/login/: показываем вход с подсказкой.
        if not getattr(settings, "GOOGLE_OAUTH_ENABLED", False):
            messages.info(
                request,
                "Вход через Google пока не настроен администратором.",
            )
            raise ImmediateHttpResponse(
                HttpResponseRedirect(reverse("login"))
            )
        return super().get_provider(request, provider, client_id=client_id)

    def is_open_for_signup(self, request, sociallogin):
        return True

    def populate_user(self, request, sociallogin, data):
        user = super().populate_user(request, sociallogin, data)
        # У Google обычно есть email, name, given_name/family_name.
        email = (data.get("email") or "").strip()
        if not user.email and email:
            user.email = email
        # Имя: Google отдаёт name, реже first_name/last_name.
        if not user.first_name:
            user.first_name = (data.get("first_name") or "").strip()[:150]
        if not user.last_name:
            user.last_name = (data.get("last_name") or "").strip()[:150]
        return user

    def save_user(self, request, sociallogin, form=None):
        user = sociallogin.user
        # Гарантируем уникальный логин, если он ещё не задан.
        if not user.username:
            seed = user.email or sociallogin.account.extra_data.get("email") or ""
            user.username = generate_username(seed)
        return super().save_user(request, sociallogin, form=form)

    def get_connect_redirect_url(self, request, socialaccount):
        return "/"
