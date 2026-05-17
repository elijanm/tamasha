from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ─── Database ────────────────────────────────────────────────────────────
    mongo_url: str = "mongodb://localhost:27017"
    mongo_db: str = "tamasha"

    # ─── Redis ───────────────────────────────────────────────────────────────
    redis_url: str = "redis://localhost:6379/0"

    # ─── Celery ──────────────────────────────────────────────────────────────
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "redis://localhost:6379/2"

    # ─── JWT ─────────────────────────────────────────────────────────────────
    jwt_secret_key: str = "insecure-default-secret-change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 30

    # ─── Cloudflare R2 ───────────────────────────────────────────────────────
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket: str = "tamasha-media"
    r2_endpoint_url: str = ""

    # ─── CORS ────────────────────────────────────────────────────────────────
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    # ─── Application ─────────────────────────────────────────────────────────
    environment: Literal["development", "staging", "production"] = "development"
    log_level: str = "INFO"

    # ─── Billing ─────────────────────────────────────────────────────────────
    billing_banner_accounting: bool = True  # show billing banner to admins with accounting permission

    # ─── Rate Limiting ───────────────────────────────────────────────────────
    rate_limit_per_minute: int = 60

    # ─── Registration ────────────────────────────────────────────────────────
    allow_registration: bool = False  # when False, /auth/register requires a valid invite token

    # ─── Seed Admin ──────────────────────────────────────────────────────────
    seed_admin_email: str = "admin@tamasha.com"
    seed_admin_username: str = "admin"
    seed_admin_password: str = "TamashaAdmin2026!"

    # ─── Seed Superadmin ─────────────────────────────────────────────────────
    seed_superadmin_email: str = "superadmin@tamasha.com"
    seed_superadmin_username: str = "superadmin"
    seed_superadmin_password: str = "TamashaSuperAdmin2026!"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, v: str | list[str]) -> list[str]:
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
