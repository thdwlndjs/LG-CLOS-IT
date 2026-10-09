import pytest
from pydantic import ValidationError

from app.core.config import Settings, load_settings


@pytest.mark.parametrize("changes", [
    {"app_env": "production"}, {"app_env": "staging"}, {"public_deployment": True},
    {"jwt_secret": "short"}, {"jwt_secret": "CHANGE_ME_MIN_32_CHARS"},
    {"storage_access_key": "CHANGE_ME"}, {"database_url": "sqlite:///fallback.db"},
    {"demo_auth_enabled": False}, {"vton_provider": "DECART"},
    {"cors_allowed_origins": "*"}, {"n8n_enabled": True}, {"app_timezone": "Asia/Seoul"},
])
def test_invalid_or_unsafe_configuration_is_rejected(settings_values, changes):
    with pytest.raises(ValidationError):
        Settings(**(settings_values | changes))


def test_production_jwt_with_demo_disabled_is_allowed(settings_values):
    settings = Settings(**(settings_values | dict(
        app_env="production", auth_mode="JWT", demo_auth_enabled=False
    )))
    assert settings.auth_mode == "JWT"


def test_secrets_are_redacted_in_repr(settings):
    output = repr(settings)
    assert "unit-secret-key" not in output
    assert "unit-test-only-secret" not in output
    assert "postgresql+asyncpg://unit" not in output


def test_startup_validation_does_not_print_secrets(settings_values):
    with pytest.raises(ValidationError) as exc:
        Settings(**(settings_values | {"app_env": "production"}))
    assert "unit-secret-key" not in str(exc.value)
    assert "unit-test-only-secret" not in str(exc.value)


def test_environment_overrides_dotenv(tmp_path, monkeypatch, settings_values):
    path = tmp_path / "local.env"
    path.write_text("\n".join(f"{key.upper()}={value}" for key, value in settings_values.items()),
                    encoding="utf-8")
    monkeypatch.setenv("LOG_LEVEL", "ERROR")
    assert load_settings(path).log_level == "ERROR"
