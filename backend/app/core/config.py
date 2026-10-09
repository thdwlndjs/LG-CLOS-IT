import os
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from dotenv import dotenv_values
from pydantic import BaseModel, ConfigDict, Field, SecretStr, model_validator

from app.core.paths import PROJECT_ROOT


class ConfigurationError(ValueError):
    pass


class Settings(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True, hide_input_in_errors=True)

    app_env: Literal["local", "test", "staging", "production"] = "local"
    public_deployment: bool = False
    app_timezone: Literal["UTC"] = "UTC"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    database_url: SecretStr
    redis_url: SecretStr
    celery_broker_url: SecretStr
    celery_result_backend: SecretStr
    storage_endpoint: str
    storage_bucket: str = "wardrobe-assets"
    storage_access_key: SecretStr
    storage_secret_key: SecretStr
    storage_public_base_url: str = "http://localhost:9000"
    auth_mode: Literal["DEMO", "JWT"] = "DEMO"
    demo_auth_enabled: bool = True
    jwt_secret: SecretStr
    jwt_issuer: str = "smart-wardrobe"
    jwt_audience: str = "smart-wardrobe-api"
    jwt_ttl_seconds: int = Field(default=3600, ge=60, le=86400)
    vton_provider: Literal["MOCK", "DECART"] = "MOCK"
    decart_api_key: SecretStr = SecretStr("")
    decart_base_url: str = ""
    decart_model_id: str = ""
    decart_timeout_seconds: int = Field(default=90, ge=1, le=300)
    decart_max_concurrency: int = Field(default=2, ge=1, le=32)
    weather_provider: Literal["MOCK", "LIVE"] = "MOCK"
    calendar_provider: Literal["MOCK", "LIVE"] = "MOCK"
    thinq_clo_mode: Literal["MOCK"] = "MOCK"
    card_renderer_url: str = "http://renderer:3000"
    card_render_timeout_seconds: int = Field(default=30, ge=1, le=120)
    n8n_enabled: bool = False
    worker_queue: str = Field(default="celery", pattern=r"^[a-zA-Z0-9_-]{1,80}$")
    n8n_webhook_secret: SecretStr = SecretStr("")
    cors_allowed_origins: str = "http://localhost:5173"
    health_timeout_seconds: float = Field(default=5, gt=0, le=30)

    @model_validator(mode="after")
    def validate_runtime(self) -> "Settings":
        if not self.database_url.get_secret_value().startswith("postgresql+asyncpg://"):
            raise ConfigurationError("DATABASE_URL must use postgresql+asyncpg")
        for name in ("redis_url", "celery_broker_url", "celery_result_backend"):
            if urlparse(getattr(self, name).get_secret_value()).scheme not in {"redis", "rediss"}:
                raise ConfigurationError(f"{name.upper()} must use redis or rediss")
        for name in ("storage_access_key", "storage_secret_key", "jwt_secret"):
            value = getattr(self, name).get_secret_value()
            if not value or "CHANGE_ME" in value.upper():
                raise ConfigurationError(f"{name.upper()} must be configured")
        if len(self.jwt_secret.get_secret_value().encode()) < 32:
            raise ConfigurationError("JWT_SECRET must contain at least 32 bytes")
        local = self.app_env in {"local", "test"} and not self.public_deployment
        if not local and (self.demo_auth_enabled or self.auth_mode == "DEMO"):
            raise ConfigurationError("Demo authentication is permitted only in local/test")
        if self.auth_mode == "DEMO" and not self.demo_auth_enabled:
            raise ConfigurationError("AUTH_MODE=DEMO requires DEMO_AUTH_ENABLED=true")
        if self.vton_provider == "DECART":
            raise ConfigurationError(
                "DECART adapter contract is unverified; live mode is unavailable (D-003)"
            )
        if "*" in self.cors_origins:
            raise ConfigurationError("CORS requires an explicit origin allowlist")
        if self.n8n_enabled:
            raise ConfigurationError("n8n integration is deferred to Sprint 7")
        return self

    @property
    def cors_origins(self) -> list[str]:
        return [v.strip() for v in self.cors_allowed_origins.split(",") if v.strip()]


def load_settings(env_file: Path | None = None) -> Settings:
    source = dotenv_values(env_file or PROJECT_ROOT / ".env")
    source.update(os.environ)
    fields = {key: source[key.upper()] for key in Settings.model_fields if key.upper() in source}
    return Settings.model_validate(fields)
