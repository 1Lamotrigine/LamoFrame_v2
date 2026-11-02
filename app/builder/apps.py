from django.apps import AppConfig
from django.db.models.signals import post_migrate


def load_templates(sender, **kwargs):
    """Load the bundled templates once, so a fresh project has content."""
    from django.core.management import call_command

    from .models import Template

    if Template.objects.exists():
        return
    call_command("loaddata", "templates", verbosity=0)


class BuilderConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "builder"
    verbose_name = "Конструктор сайтов"

    def ready(self):
        post_migrate.connect(load_templates, sender=self, dispatch_uid="builder.load_templates")
