from django.contrib import admin

from .models import Asset, Project, Template


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ("title", "owner", "slug", "updated_at")
    search_fields = ("title", "slug", "owner__username")
    readonly_fields = ("created_at", "updated_at", "exported_html")


@admin.register(Asset)
class AssetAdmin(admin.ModelAdmin):
    list_display = ("name", "project", "size", "created_at")
    search_fields = ("name", "project__title")


@admin.register(Template)
class TemplateAdmin(admin.ModelAdmin):
    list_display = ("title", "slug", "sort_order")
    prepopulated_fields = {"slug": ("title",)}
