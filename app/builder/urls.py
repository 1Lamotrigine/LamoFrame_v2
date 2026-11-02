from django.urls import path

from . import views

urlpatterns = [
    path("", views.dashboard, name="dashboard"),
    path("new/", views.new_project, name="new_project"),
    path("projects/create/", views.create_project, name="create_project"),
    path("editor/<int:pk>/", views.editor, name="editor"),
    path("api/projects/<int:pk>/", views.api_project, name="api_project"),
    path("api/projects/<int:pk>/assets/", views.upload_asset, name="upload_asset"),
    path("projects/<int:pk>/export/", views.export_project, name="export_project"),
    path("projects/<int:pk>/duplicate/", views.duplicate_project, name="duplicate_project"),
    path("projects/<int:pk>/delete/", views.delete_project, name="delete_project"),
    path("p/<slug:slug>/", views.public_preview, name="public_preview"),
    path("p/<slug:slug>/raw/", views.public_raw, name="public_raw"),
]
