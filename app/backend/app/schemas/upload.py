from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.core.pagination import PagedResponse
from app.utils.object_id import PyObjectId


class UploadFileItem(BaseModel):
    original_filename: str
    file_size: int = Field(gt=0)
    sha256: str = Field(min_length=64, max_length=64)


class UploadInitiateRequest(BaseModel):
    files: list[UploadFileItem] = Field(min_length=1)
    source_folder: str | None = None


class PresignedUploadItem(BaseModel):
    r2_key: str
    upload_url: str
    original_filename: str
    expires_in: int = 3600


class UploadInitiateResponse(BaseModel):
    upload_id: str
    items: list[PresignedUploadItem]


class UploadCompleteRequest(BaseModel):
    upload_id: str
    confirmed_keys: list[str] = Field(min_length=1)


class UploadManifestItemResponse(BaseModel):
    r2_key: str
    original_filename: str
    file_size: int
    sha256: str
    status: Literal["pending", "processing", "complete", "failed"]
    track_id: PyObjectId | None = None
    error: str | None = None


class UploadResponse(BaseModel):
    id: PyObjectId
    uploaded_by: PyObjectId
    manifest: list[UploadManifestItemResponse]
    total_files: int
    processed_files: int
    failed_files: int
    status: Literal["pending", "processing", "complete", "partial_failure", "failed"]
    source_folder: str | None = None
    created_at: datetime
    updated_at: datetime


UploadListResponse = PagedResponse[UploadResponse]
