import copy
import os
import secrets

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from builder.models import Project, Template


class Command(BaseCommand):
    help = (
        "Создаёт демо-пользователя и пример проекта. Пароли берутся из "
        "DEMO_PASSWORD / ADMIN_PASSWORD; без них генерируется случайный пароль."
    )

    def handle(self, *args, **options):
        User = get_user_model()
        demo_password = (os.environ.get("DEMO_PASSWORD") or "").strip()
        generated = False
        if not demo_password:
            demo_password = secrets.token_urlsafe(12)
            generated = True

        demo, created = User.objects.get_or_create(
            username="demo",
            defaults={"email": "demo@example.com", "first_name": "Демо"},
        )
        if created:
            demo.set_password(demo_password)
            demo.save()
            note = " (пароль сгенерирован)" if generated else ""
            self.stdout.write(
                self.style.SUCCESS(f"Создан пользователь demo / {demo_password}{note}")
            )
        else:
            self.stdout.write("Пользователь demo уже существует")

        admin_password = (os.environ.get("ADMIN_PASSWORD") or "").strip()
        if admin_password:
            admin, admin_created = User.objects.get_or_create(
                username="admin",
                defaults={"email": "admin@example.com", "is_staff": True, "is_superuser": True},
            )
            if admin_created:
                admin.set_password(admin_password)
                admin.is_staff = True
                admin.is_superuser = True
                admin.save()
                self.stdout.write(self.style.SUCCESS("Создан администратор admin"))
            else:
                self.stdout.write("Пользователь admin уже существует")
        else:
            self.stdout.write(
                "ADMIN_PASSWORD не задан — администратор не создаётся."
            )

        if not Project.objects.filter(owner=demo).exists():
            template = Template.objects.filter(slug="landing").first()
            if template:
                title = "Аврора — лендинг"
                data = copy.deepcopy(template.data)
                data["meta"]["title"] = title
                Project.objects.create(title=title, owner=demo, data=data)
                self.stdout.write(self.style.SUCCESS("Создан демо-проект"))
