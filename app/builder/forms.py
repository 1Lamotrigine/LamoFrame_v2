"""Формы приложения.

Пока здесь только регистрация: вход/выход обслуживает django.contrib.auth,
но собственная форма нужна, чтобы добавить проверки и русские подписи,
которые не помещаются в штатный UserCreationForm без обёрток.
"""
from django import forms
from django.contrib.auth import get_user_model
from django.contrib.auth.forms import UserCreationForm

User = get_user_model()

# Поля в том порядке, в котором они показываются на странице регистрации.
FIELD_ORDER = ("username", "email", "password1", "password2")


class SignUpForm(UserCreationForm):
    """Регистрация с необязательным email.

    Наследуемся от UserCreationForm: он уже подключает валидаторы пароля
    из AUTH_PASSWORD_VALIDATORS, проверяет совпадение паролей и соль с
    логином. Мы лишь добавляем email, ограничения на логин и русские тексты.
    """

    email = forms.EmailField(
        label="Email",
        required=False,
        max_length=254,
        widget=forms.EmailInput(
            attrs={"autocomplete": "email", "placeholder": "you@example.com"}
        ),
    )

    class Meta(UserCreationForm.Meta):
        model = User
        fields = ("username", "email")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["username"].label = "Логин"
        self.fields["username"].help_text = (
            "До 150 символов: буквы, цифры и @/./+/-/_."
        )
        self.fields["username"].widget.attrs.update(
            {
                "autocomplete": "username",
                "placeholder": "Например, anna",
                "autofocus": True,
            }
        )
        self.fields["password1"].label = "Пароль"
        self.fields["password1"].help_text = "Минимум 8 символов, не только цифры."
        self.fields["password1"].widget.attrs.update(
            {"autocomplete": "new-password", "placeholder": "••••••••"}
        )
        self.fields["password2"].label = "Повторите пароль"
        self.fields["password2"].help_text = ""
        self.fields["password2"].widget.attrs.update(
            {"autocomplete": "new-password", "placeholder": "••••••••"}
        )

    def clean_username(self):
        username = (self.cleaned_data.get("username") or "").strip()
        if not username:
            raise forms.ValidationError("Введите логин.")
        # Регистрозависимый, но устойчивый к пробелам и регистру по краям.
        if User.objects.filter(username__iexact=username).exists():
            raise forms.ValidationError("Такой логин уже занят.")
        return username

    def clean_email(self):
        email = (self.cleaned_data.get("email") or "").strip()
        if email and User.objects.filter(email__iexact=email).exists():
            raise forms.ValidationError("На этот email уже зарегистрирован аккаунт.")
        return email

    def save(self, commit=True):
        user = super().save(commit=False)
        user.email = self.cleaned_data.get("email", "")
        if commit:
            user.save()
        return user
