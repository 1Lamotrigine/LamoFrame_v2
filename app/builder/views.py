import copy
import json
import os

from django.contrib.auth import login
from django.contrib.auth.decorators import login_required
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.http import HttpResponse, JsonResponse, HttpResponseBadRequest
from django.shortcuts import get_object_or_404, redirect, render
from django.utils.http import url_has_allowed_host_and_scheme
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.debug import sensitive_post_parameters
from django.views.decorators.http import require_GET, require_POST, require_http_methods
from PIL import Image, UnidentifiedImageError

from .forms import SignUpForm
from .models import Asset, Project, Template, blank_document, unique_slug

ALLOWED_IMAGE_FORMATS = {"JPEG", "PNG", "WEBP", "GIF"}
MAX_ASSET_SIZE = 2 * 1024 * 1024
MAX_DOCUMENT_SIZE = 8 * 1024 * 1024
MAX_EXPORT_SIZE = 12 * 1024 * 1024
MAX_PAGES = 50
MAX_FRAMES = 400
MAX_ELEMENTS = 5000
MAX_DOCUMENT_DEPTH = 40
MAX_ASSETS = 200


def _owned(request, pk):
    # 404, а не 403: не раскрываем существование чужого проекта.
    return get_object_or_404(Project, pk=pk, owner=request.user)


def resolve_next(request, fallback=None):
    """Вернуть безопасный `next` из запроса (защита от open redirect)."""
    target = request.POST.get("next") or request.GET.get("next")
    if target and url_has_allowed_host_and_scheme(
        target, allowed_hosts={request.get_host()}, require_https=request.is_secure()
    ):
        return target
    return fallback


def _document_problem(data):
    """Проверить структуру и размеры документа перед сохранением."""
    if not isinstance(data, dict) or data.get("version") not in (1, 2, 3):
        return "Неизвестная версия документа"
    if not any(key in data for key in ("frames", "sections", "pages")):
        return "В документе нет фреймов"

    pages = data.get("pages") or []
    frames = data.get("frames") or []
    sections = data.get("sections") or []
    if not isinstance(pages, list) or not isinstance(frames, list) or not isinstance(sections, list):
        return "Некорректная структура документа"
    if len(pages) > MAX_PAGES:
        return f"Слишком много страниц (максимум {MAX_PAGES})"

    frame_count = len(frames) + len(sections)
    element_count = sum(len(frame.get("elements") or []) for frame in frames if isinstance(frame, dict))
    for page in pages:
        if not isinstance(page, dict):
            return "Некорректная структура страницы"
        page_frames = page.get("frames") or []
        if not isinstance(page_frames, list):
            return "Некорректная структура страницы"
        frame_count += len(page_frames)
        element_count += sum(
            len(frame.get("elements") or []) for frame in page_frames if isinstance(frame, dict)
        )
        devices = page.get("devices") or {}
        if isinstance(devices, dict):
            for device in devices.values():
                device_frames = (device or {}).get("frames") or []
                if isinstance(device_frames, list):
                    frame_count += len(device_frames)
                    element_count += sum(
                        len(frame.get("elements") or [])
                        for frame in device_frames
                        if isinstance(frame, dict)
                    )
    if frame_count > MAX_FRAMES:
        return f"Слишком много фреймов (максимум {MAX_FRAMES})"
    if element_count > MAX_ELEMENTS:
        return f"Слишком много элементов (максимум {MAX_ELEMENTS})"

    def depth(value, level=0):
        if level > MAX_DOCUMENT_DEPTH:
            return level
        if isinstance(value, dict):
            return max((depth(item, level + 1) for item in value.values()), default=level)
        if isinstance(value, list):
            return max((depth(item, level + 1) for item in value), default=level)
        return level

    if depth(data) > MAX_DOCUMENT_DEPTH:
        return "Слишком глубокая вложенность документа"
    return None



@never_cache
@sensitive_post_parameters("password1", "password2")
def signup(request):
    """Регистрация нового пользователя.

    После успешного создания аккаунта сразу выполняем вход, чтобы человек
    попал в мастерскую без повторного ввода пароля.
    """
    if request.user.is_authenticated:
        return redirect("dashboard")

    if request.method == "POST":
        form = SignUpForm(request.POST)
        if form.is_valid():
            try:
                with transaction.atomic():
                    user = form.save()
            except IntegrityError:
                # Гонка: логин заняли между проверкой формы и save().
                form.add_error("username", "Такой логин уже занят.")
            else:
                # Backend указываем явно: их два (ModelBackend + allauth),
                # иначе Django не знает, какой записать в сессию.
                login(
                    request,
                    user,
                    backend="django.contrib.auth.backends.ModelBackend",
                )
                return redirect(resolve_next(request) or "dashboard")
    else:
        form = SignUpForm()

    return render(
        request,
        "registration/signup.html",
        {"form": form, "next": resolve_next(request, "")},
    )


@login_required
@ensure_csrf_cookie
def dashboard(request):
    projects = Project.objects.filter(owner=request.user)
    query = (request.GET.get("q") or "").strip()
    if query:
        projects = projects.filter(Q(title__icontains=query) | Q(slug__icontains=query))
    projects = list(projects)
    return render(
        request,
        "dashboard.html",
        {
            "projects": projects,
            "query": query,
            "project_data": {str(p.pk): p.data for p in projects},
        },
    )


@login_required
@ensure_csrf_cookie
def new_project(request):
    templates = list(Template.objects.all())
    blank = blank_document("Новый сайт")
    return render(
        request,
        "new_project.html",
        {
            "templates": templates,
            "blank_doc": blank,
            "template_data": {str(t.pk): t.data for t in templates},
        },
    )


@login_required
@require_POST
def create_project(request):
    title = (request.POST.get("title") or "").strip()[:200]
    template_id = request.POST.get("template")
    data = None
    if template_id:
        try:
            template_pk = int(template_id)
        except (TypeError, ValueError):
            template_pk = None
        template = Template.objects.filter(pk=template_pk).first() if template_pk else None
        if template:
            data = copy.deepcopy(template.data)
            if not title:
                title = template.title
    if not title:
        title = "Новый сайт"
    if not data:
        data = blank_document(title)
    data.setdefault("meta", {})["title"] = title
    project = Project.objects.create(title=title, owner=request.user, data=data)
    return redirect("editor", pk=project.pk)


@login_required
@ensure_csrf_cookie
def editor(request, pk):
    project = _owned(request, pk)
    return render(request, "editor.html", {"project": project})


@login_required
@require_http_methods(["GET", "PUT"])
def api_project(request, pk):
    project = _owned(request, pk)
    if request.method == "GET":
        return JsonResponse(
            {
                "id": project.pk,
                "title": project.title,
                "slug": project.slug,
                "data": project.data,
                "updated_at": project.updated_at.isoformat(),
                "assets": [
                    {
                        "id": a.pk,
                        "name": a.name,
                        "url": a.file.url,
                        "size": a.size,
                    }
                    for a in project.assets.all()
                ],
            }
        )

    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return HttpResponseBadRequest("Некорректный JSON")
    if not isinstance(payload, dict):
        return HttpResponseBadRequest("Ожидается объект")

    data = payload.get("data")
    html = payload.get("html")
    title = payload.get("title")
    base_updated_at = payload.get("base_updated_at")

    # Оптимистическая блокировка: клиент присылает версию, которую он открыл.
    # Если в другой вкладке уже сохранили изменения — не затираем их молча.
    if isinstance(base_updated_at, str) and base_updated_at:
        if base_updated_at != project.updated_at.isoformat():
            return JsonResponse(
                {"error": "Проект изменён в другой вкладке. Обновите страницу."},
                status=409,
            )

    if data is not None:
        problem = _document_problem(data)
        if problem:
            return HttpResponseBadRequest(problem)
        serialized = json.dumps(data, ensure_ascii=False)
        if len(serialized.encode("utf-8")) > MAX_DOCUMENT_SIZE:
            return HttpResponseBadRequest("Документ слишком большой")
        project.data = data
    if isinstance(title, str) and title.strip():
        project.title = title.strip()[:200]
    if isinstance(html, str):
        if len(html.encode("utf-8")) > MAX_EXPORT_SIZE:
            return HttpResponseBadRequest("Экспорт слишком большой")
        project.exported_html = html
    project.save()
    return JsonResponse(
        {
            "ok": True,
            "updated_at": project.updated_at.isoformat(),
            "slug": project.slug,
            "title": project.title,
        }
    )


@login_required
@require_POST
def upload_asset(request, pk):
    project = _owned(request, pk)
    upload = request.FILES.get("file")
    if upload is None:
        return JsonResponse({"error": "Файл не передан"}, status=400)
    if upload.size > MAX_ASSET_SIZE:
        return JsonResponse({"error": "Файл больше 2 МБ"}, status=400)
    if project.assets.count() >= MAX_ASSETS:
        return JsonResponse({"error": f"В проекте уже {MAX_ASSETS} файлов"}, status=400)
    try:
        probe = Image.open(upload)
        probe.verify()
        upload.seek(0)
        image_format = probe.format
    except Image.DecompressionBombError:
        return JsonResponse({"error": "Изображение слишком большое по разрешению"}, status=400)
    except (UnidentifiedImageError, OSError, ValueError):
        return JsonResponse({"error": "Это не изображение"}, status=400)
    if image_format not in ALLOWED_IMAGE_FORMATS:
        return JsonResponse({"error": "Поддерживаются JPEG, PNG, WebP и GIF"}, status=400)

    asset = Asset(
        project=project,
        name=os.path.basename(upload.name)[:255] or "image",
        size=upload.size,
    )
    asset.file.save(asset.name, upload, save=False)
    asset.save()
    return JsonResponse(
        {
            "id": asset.pk,
            "name": asset.name,
            "url": asset.file.url,
            "size": asset.size,
        }
    )


@login_required
@require_GET
def export_project(request, pk):
    project = _owned(request, pk)
    if not project.exported_html:
        return JsonResponse(
            {"error": "Экспорт ещё не готов. Сохраните проект в редакторе."},
            status=409,
        )
    response = HttpResponse(project.exported_html, content_type="text/html; charset=utf-8")
    filename = f"{project.slug or 'site'}.html"
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


@login_required
@require_POST
def duplicate_project(request, pk):
    project = _owned(request, pk)
    title = f"{project.title} (копия)"[:200]
    clone = Project.objects.create(
        title=title,
        slug=unique_slug(title),
        owner=request.user,
        data=copy.deepcopy(project.data),
        exported_html=project.exported_html,
    )
    if project.thumbnail:
        try:
            project.thumbnail.open()
            clone.thumbnail.save(
                os.path.basename(project.thumbnail.name),
                project.thumbnail.file,
                save=False,
            )
            project.thumbnail.close()
            clone.save(update_fields=["thumbnail"])
        except (OSError, ValueError):
            project.thumbnail.close()
    return redirect("editor", pk=clone.pk)


@login_required
@require_POST
def delete_project(request, pk):
    project = _owned(request, pk)
    # Django не удаляет файлы сам — чистим их до удаления записи.
    for asset in project.assets.all():
        asset.file.delete(save=False)
    if project.thumbnail:
        project.thumbnail.delete(save=False)
    project.delete()
    return redirect("dashboard")


@require_GET
def public_preview(request, slug):
    project = get_object_or_404(Project, slug=slug)
    return render(request, "public_preview.html", {"project": project})


@require_GET
def public_raw(request, slug):
    project = get_object_or_404(Project, slug=slug)
    if not project.exported_html:
        response = HttpResponse(
            "<!doctype html><title>Страница не опубликована</title>"
            "<body style=\"font:15px system-ui;padding:32px\">"
            "Эта страница ещё не опубликована.",
            content_type="text/html; charset=utf-8",
            status=404,
        )
    else:
        response = HttpResponse(
            project.exported_html,
            content_type="text/html; charset=utf-8",
        )
        etag = f'W/"project-{project.pk}-{int(project.updated_at.timestamp())}"'
        response["ETag"] = etag
        if request.headers.get("If-None-Match") == etag:
            response.status_code = 304
            response.content = b""
            return response
    response["X-Frame-Options"] = "SAMEORIGIN"
    response["X-Content-Type-Options"] = "nosniff"
    # Документ собран из пользовательского HTML. Sandbox даёт ему уникальный
    # origin: скрипты продолжают работать, но не могут читать cookie/сессии
    # приложения, даже если открыть /raw/ напрямую.
    response["Content-Security-Policy"] = (
        "sandbox allow-scripts allow-popups allow-forms; "
        "default-src 'none'; img-src * data: blob:; media-src * data: blob:; "
        "style-src 'unsafe-inline' *; font-src * data:; "
        "script-src 'unsafe-inline' 'unsafe-eval'; connect-src *; frame-src *"
    )
    return response
