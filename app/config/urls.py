from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path, re_path
from django.views.static import serve

from builder import views as builder_views

urlpatterns = [
    path("admin/", admin.site.urls),
    # Наши страницы входа/регистрации — раньше allauth, поэтому их пути
    # и имена (login/signup) выигрывают. allauth добавляет OAuth-флоу Google
    # и служебные URL (account_login/account_signup, google_login и т.п.).
    path("accounts/signup/", builder_views.signup, name="signup"),
    path("accounts/", include("django.contrib.auth.urls")),
    path("accounts/", include("allauth.urls")),
    path("", include("builder.urls")),
]

# Медиа отдаём и в режиме отладки, и под контейнером (WhiteNoise статику
# обслуживает сам, а загруженные пользователем картинки живут в /media/).
_media = [
    re_path(r"^media/(?P<path>.*)$", serve, {"document_root": settings.MEDIA_ROOT}),
]
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
else:
    urlpatterns += _media
