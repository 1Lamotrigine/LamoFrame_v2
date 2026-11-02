import uuid

from django.conf import settings
from django.db import models
from django.utils.text import slugify


def new_frame(name="Фрейм 1", x=0, y=0, w=1200, h=720, bg="#ffffff"):
    return {
        "id": "f_" + uuid.uuid4().hex[:8],
        "name": name,
        "x": x,
        "y": y,
        "w": w,
        "h": h,
        "bg": bg,
        "radius": 0,
        "locked": False,
        "hidden": False,
        "elements": [],
    }


def blank_document(title="Новый сайт"):
    frame = new_frame()
    return {
        "version": 3,
        "meta": {"title": title, "description": "", "lang": "ru"},
        "settings": {
            "width": 1200,
            "bg": "#ffffff",
            "font": "system",
            "responsive": {"auto": True, "device": "desktop"},
        },
        "activePageId": "p_home",
        "pages": [
            {
                "id": "p_home",
                "name": "Главная",
                "slug": "index",
                "frames": [frame],
            }
        ],
        "components": {"header": None, "footer": None},
    }


def unique_slug(title):
    base = slugify(title, allow_unicode=False)[:150] or "project"
    return f"{base}-{uuid.uuid4().hex[:6]}"


class Project(models.Model):
    title = models.CharField("название", max_length=200)
    slug = models.SlugField("slug", max_length=200, unique=True, blank=True)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name="владелец",
        on_delete=models.CASCADE,
        related_name="projects",
    )
    data = models.JSONField("документ", default=blank_document)
    exported_html = models.TextField("готовый HTML", blank=True, default="")
    thumbnail = models.ImageField("миниатюра", upload_to="thumbnails/", blank=True)
    created_at = models.DateTimeField("создан", auto_now_add=True)
    updated_at = models.DateTimeField("изменён", auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        verbose_name = "проект"
        verbose_name_plural = "проекты"

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = unique_slug(self.title)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.title


def asset_path(instance, filename):
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "png"
    return f"projects/{instance.project_id}/{uuid.uuid4().hex[:12]}.{ext}"


class Asset(models.Model):
    project = models.ForeignKey(
        Project,
        verbose_name="проект",
        on_delete=models.CASCADE,
        related_name="assets",
    )
    file = models.ImageField("файл", upload_to=asset_path)
    name = models.CharField("имя", max_length=255)
    size = models.PositiveBigIntegerField("размер", default=0)
    created_at = models.DateTimeField("загружен", auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "файл"
        verbose_name_plural = "файлы"

    def __str__(self):
        return self.name


class Template(models.Model):
    title = models.CharField("название", max_length=120)
    slug = models.SlugField("slug", max_length=120, unique=True)
    description = models.CharField("описание", max_length=240, blank=True)
    preview = models.ImageField("обложка", upload_to="template_previews/", blank=True)
    data = models.JSONField("документ", default=dict)
    sort_order = models.PositiveIntegerField("порядок", default=0)

    class Meta:
        ordering = ["sort_order", "id"]
        verbose_name = "шаблон"
        verbose_name_plural = "шаблоны"

    def __str__(self):
        return self.title
