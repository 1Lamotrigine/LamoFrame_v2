import json
import shutil
import tempfile

from django.contrib.auth import get_user_model
from django.contrib.sessions.middleware import SessionMiddleware
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import RequestFactory, TestCase, override_settings
from django.urls import reverse

from .models import Asset, Project, blank_document


def make_png():
    # 1×1 прозрачный PNG.
    return (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
        b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    )


class SignUpTests(TestCase):
    def test_signup_page_renders(self):
        response = self.client.get(reverse("signup"))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Регистрация")
        self.assertContains(response, "Создать аккаунт")

    def test_signup_creates_user_and_logs_in(self):
        response = self.client.post(
            reverse("signup"),
            {
                "username": "newbie",
                "email": "newbie@example.com",
                "password1": "StrongPass-42",
                "password2": "StrongPass-42",
            },
        )
        self.assertRedirects(response, reverse("dashboard"))
        User = get_user_model()
        user = User.objects.get(username="newbie")
        self.assertEqual(user.email, "newbie@example.com")
        # Пользователь сразу авторизован.
        self.assertEqual(int(self.client.session["_auth_user_id"]), user.pk)

    def test_signup_rejects_duplicate_username_case_insensitive(self):
        User = get_user_model()
        User.objects.create_user("Taken", password="pass12345")
        response = self.client.post(
            reverse("signup"),
            {
                "username": "taken",
                "email": "",
                "password1": "StrongPass-42",
                "password2": "StrongPass-42",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "уже занят")
        self.assertFalse(User.objects.filter(username__iexact="taken").count() > 1)

    def test_signup_rejects_mismatched_passwords(self):
        response = self.client.post(
            reverse("signup"),
            {
                "username": "mismatch",
                "email": "",
                "password1": "StrongPass-42",
                "password2": "Different-77",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(get_user_model().objects.filter(username="mismatch").exists())

    def test_signup_rejects_short_password(self):
        response = self.client.post(
            reverse("signup"),
            {
                "username": "shorty",
                "email": "",
                "password1": "123",
                "password2": "123",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(get_user_model().objects.filter(username="shorty").exists())

    def test_signup_rejects_duplicate_email(self):
        User = get_user_model()
        User.objects.create_user("first", email="dup@example.com", password="pass12345")
        response = self.client.post(
            reverse("signup"),
            {
                "username": "second",
                "email": "DUP@example.com",
                "password1": "StrongPass-42",
                "password2": "StrongPass-42",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "email")
        self.assertFalse(User.objects.filter(username="second").exists())

    def test_signup_redirects_authenticated_user(self):
        User = get_user_model()
        user = User.objects.create_user("logged", password="pass12345")
        self.client.force_login(user)
        response = self.client.get(reverse("signup"))
        self.assertRedirects(response, reverse("dashboard"))

    def test_signup_honours_safe_next(self):
        response = self.client.post(
            reverse("signup") + "?next=" + reverse("new_project"),
            {
                "username": "nextuser",
                "email": "",
                "password1": "StrongPass-42",
                "password2": "StrongPass-42",
            },
        )
        self.assertRedirects(response, reverse("new_project"))

    def test_signup_ignores_external_next(self):
        response = self.client.post(
            reverse("signup"),
            {
                "username": "evilredirect",
                "email": "",
                "password1": "StrongPass-42",
                "password2": "StrongPass-42",
                "next": "https://evil.example.com/steal",
            },
        )
        self.assertRedirects(response, reverse("dashboard"))

    def test_login_page_links_to_signup(self):
        response = self.client.get(reverse("login"))
        self.assertContains(response, reverse("signup"))


class GoogleAuthTests(TestCase):
    """Интеграция входа через Google (django-allauth).

    Реальные ключи Google в тестах не нужны: проверяем конфигурацию,
    URL-ы, адаптеры и то, что кнопка показывается только при ключах.
    """

    def test_urls_resolve(self):
        # Наши страницы выигрывают, а allauth-имена указывают на них же.
        self.assertEqual(reverse("login"), "/accounts/login/")
        self.assertEqual(reverse("signup"), "/accounts/signup/")
        self.assertEqual(reverse("account_login"), "/accounts/login/")
        self.assertEqual(reverse("account_signup"), "/accounts/signup/")
        self.assertEqual(reverse("google_login"), "/accounts/google/login/")
        self.assertEqual(reverse("google_callback"), "/accounts/google/login/callback/")

    def test_google_button_hidden_without_credentials(self):
        with override_settings(GOOGLE_OAUTH_ENABLED=False):
            for name in ("login", "signup"):
                response = self.client.get(reverse(name))
                self.assertEqual(response.status_code, 200)
                self.assertNotContains(response, "Войти через Google")

    def test_google_button_shown_with_credentials(self):
        with override_settings(GOOGLE_OAUTH_ENABLED=True):
            for name in ("login", "signup"):
                response = self.client.get(reverse(name))
                self.assertContains(response, "Войти через Google")
                self.assertContains(response, reverse("google_login"))

    def test_google_login_redirects_when_disabled(self):
        # Без ключей прямой заход не должен давать 500 — редирект на вход.
        with override_settings(GOOGLE_OAUTH_ENABLED=False):
            response = self.client.get(reverse("google_login"))
        self.assertEqual(response.status_code, 302)
        self.assertIn(reverse("login"), response["Location"])

    def test_google_login_is_reachable_when_enabled(self):
        # При включённом провайдере прямой заход не падает (не 5xx):
        # allauth либо отдаёт форму, либо редиректит на Google.
        with override_settings(
            GOOGLE_OAUTH_ENABLED=True,
            SOCIALACCOUNT_PROVIDERS={
                "google": {
                    "APP": {"client_id": "cid", "secret": "sec", "key": ""},
                    "SCOPE": ["profile", "email"],
                }
            },
        ):
            response = self.client.get(reverse("google_login"))
        self.assertLess(response.status_code, 500)

    def test_generate_username_is_unique(self):
        from .adapters import generate_username

        User = get_user_model()
        User.objects.create_user("anna", password="pass12345")
        # email приводит к тому же базовому слэгу — должен появиться суффикс.
        self.assertEqual(generate_username("anna@example.com"), "anna-2")
        self.assertEqual(generate_username("bob@example.com"), "bob")

    def test_generate_username_handles_empty_and_reserved(self):
        from .adapters import generate_username

        self.assertTrue(generate_username("").startswith("user"))
        # Зарезервированные имена не должны заниматься напрямую.
        self.assertNotEqual(generate_username("admin@example.com"), "admin")

    def test_social_adapter_creates_unique_username(self):
        from allauth.socialaccount.models import SocialAccount, SocialLogin

        from .adapters import LamoFrameSocialAccountAdapter

        User = get_user_model()
        User.objects.create_user("clash", password="pass12345")
        adapter = LamoFrameSocialAccountAdapter()
        user = User(username="", email="clash@example.com", first_name="Test")
        sociallogin = SocialLogin(
            user=user, account=SocialAccount(provider="google", uid="123")
        )
        sociallogin.account.extra_data = {"email": "clash@example.com"}

        request = RequestFactory().post("/accounts/google/login/")
        SessionMiddleware(lambda r: None).process_request(request)
        request.session.save()

        saved = adapter.save_user(request, sociallogin)
        self.assertTrue(saved.username)
        self.assertNotEqual(saved.username.lower(), "clash")
        self.assertEqual(saved.email, "clash@example.com")

    def test_account_adapter_redirect_honours_safe_next(self):
        from .adapters import LamoFrameAccountAdapter

        request = self.client.request().wsgi_request
        request.GET = {"next": reverse("new_project")}
        adapter = LamoFrameAccountAdapter()
        self.assertEqual(adapter.get_login_redirect_url(request), reverse("new_project"))

    def test_account_adapter_ignores_external_next(self):
        from .adapters import LamoFrameAccountAdapter

        request = self.client.request().wsgi_request
        request.GET = {"next": "https://evil.example.com/"}
        adapter = LamoFrameAccountAdapter()
        self.assertEqual(adapter.get_login_redirect_url(request), "/")

    def test_local_signup_still_works(self):
        # Регресс: добавление allauth не должно ломать локальную регистрацию.
        response = self.client.post(
            reverse("signup"),
            {
                "username": "localuser",
                "email": "local@example.com",
                "password1": "StrongPass-42",
                "password2": "StrongPass-42",
            },
        )
        self.assertRedirects(response, reverse("dashboard"))
        self.assertTrue(get_user_model().objects.filter(username="localuser").exists())


class ProjectAccessTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.owner = User.objects.create_user("owner", password="pass12345")
        self.other = User.objects.create_user("other", password="pass12345")
        self.project = Project.objects.create(
            title="Тест", owner=self.owner, data=blank_document("Тест")
        )

    def test_anonymous_redirected_to_login(self):
        response = self.client.get(reverse("api_project", args=[self.project.pk]))
        self.assertEqual(response.status_code, 302)
        self.assertIn("/accounts/login/", response["Location"])

    def test_foreign_project_is_404_not_403(self):
        self.client.force_login(self.other)
        response = self.client.get(reverse("api_project", args=[self.project.pk]))
        self.assertEqual(response.status_code, 404)

    def test_api_get_returns_updated_at(self):
        self.client.force_login(self.owner)
        response = self.client.get(reverse("api_project", args=[self.project.pk]))
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("updated_at", payload)
        self.assertEqual(payload["title"], "Тест")

    def test_api_rejects_unknown_document_version(self):
        self.client.force_login(self.owner)
        response = self.client.put(
            reverse("api_project", args=[self.project.pk]),
            data=json.dumps({"data": {"version": 99, "frames": []}}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_api_rejects_too_many_pages(self):
        self.client.force_login(self.owner)
        data = blank_document("Много")
        data["pages"] = [{"id": f"p{i}", "name": "x", "slug": f"x{i}", "frames": []} for i in range(51)]
        response = self.client.put(
            reverse("api_project", args=[self.project.pk]),
            data=json.dumps({"data": data}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_stale_base_updated_at_returns_409(self):
        self.client.force_login(self.owner)
        stale = "2000-01-01T00:00:00+00:00"
        response = self.client.put(
            reverse("api_project", args=[self.project.pk]),
            data=json.dumps(
                {
                    "data": blank_document("Новое"),
                    "base_updated_at": stale,
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 409)

    def test_create_project_with_invalid_template_does_not_500(self):
        self.client.force_login(self.owner)
        response = self.client.post(
            reverse("create_project"),
            {"title": "Без шаблона", "template": "not-a-number"},
        )
        self.assertEqual(response.status_code, 302)


class PublicPageTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.owner = User.objects.create_user("owner", password="pass12345")
        self.project = Project.objects.create(
            title="Публичный",
            owner=self.owner,
            data=blank_document("Публичный"),
        )

    def test_raw_without_export_is_404(self):
        response = self.client.get(reverse("public_raw", args=[self.project.slug]))
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")

    def test_raw_has_sandbox_csp_and_etag(self):
        self.project.exported_html = "<!doctype html><title>x</title><p>ok</p>"
        self.project.save()
        url = reverse("public_raw", args=[self.project.slug])
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertIn("sandbox", response["Content-Security-Policy"])
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")
        etag = response["ETag"]
        cached = self.client.get(url, HTTP_IF_NONE_MATCH=etag)
        self.assertEqual(cached.status_code, 304)


class AssetTests(TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp()
        self.override = override_settings(MEDIA_ROOT=self.media_root)
        self.override.enable()
        User = get_user_model()
        self.owner = User.objects.create_user("owner", password="pass12345")
        self.project = Project.objects.create(
            title="Файлы", owner=self.owner, data=blank_document("Файлы")
        )
        self.client.force_login(self.owner)

    def tearDown(self):
        self.override.disable()
        shutil.rmtree(self.media_root, ignore_errors=True)

    def test_upload_png(self):
        upload = SimpleUploadedFile("pic.png", make_png(), content_type="image/png")
        response = self.client.post(
            reverse("upload_asset", args=[self.project.pk]), {"file": upload}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.project.assets.count(), 1)

    def test_upload_rejects_non_image(self):
        upload = SimpleUploadedFile("note.txt", b"not an image", content_type="text/plain")
        response = self.client.post(
            reverse("upload_asset", args=[self.project.pk]), {"file": upload}
        )
        self.assertEqual(response.status_code, 400)

    def test_delete_project_removes_asset_file(self):
        asset = Asset(project=self.project, name="pic.png", size=len(make_png()))
        asset.file.save("pic.png", SimpleUploadedFile("pic.png", make_png()), save=True)
        path = asset.file.path
        self.client.post(reverse("delete_project", args=[self.project.pk]))
        self.assertFalse(Asset.objects.filter(pk=asset.pk).exists())
        self.assertFalse(__import__("os").path.exists(path))
