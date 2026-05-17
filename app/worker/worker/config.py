from __future__ import annotations

from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", case_sensitive=False, extra="ignore")

    # Database
    mongo_url: str = "mongodb://localhost:27017"
    mongo_db: str = "tamasha"

    # Redis / Celery
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "redis://localhost:6379/2"

    # Cloudflare R2
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket: str = "tamasha-assets"
    r2_endpoint_url: str = ""

    # Email
    resend_api_key: str = ""
    email_from: str = "noreply@tamasha.app"
    sandbox_email: str = ""
    invoice_email: str = ""

    # Backblaze B2
    b2_endpoint_url: str = ""
    b2_key_id: str = ""
    b2_application_key: str = ""
    b2_bucket: str = ""

    # Wasabi
    wasabi_endpoint_url: str = ""
    wasabi_access_key: str = ""
    wasabi_secret_key: str = ""
    wasabi_bucket: str = ""
    wasabi_region: str = "us-east-1"

    # AWS Glacier
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_region: str = "us-east-1"
    aws_glacier_bucket: str = ""

    # App
    app_base_url: str = "https://tamasha.app"
    environment: str = "development"
    log_level: str = "INFO"

    @property
    def r2_endpoint(self) -> str:
        if self.r2_endpoint_url:
            return self.r2_endpoint_url
        return f"https://{self.r2_account_id}.r2.cloudflarestorage.com"


@lru_cache
def get_settings() -> Settings:
    return Settings()
