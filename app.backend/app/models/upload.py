from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.utils.object_id import PyObjectId


class UploadManifestItem(BaseModel):
    r2_key: str
    original_filename: str
    file_size: int
    sha256: str
    status: Literal["pending", "processing", "complete", "failed"] = "pending"
    track_id: PyObjectId | None = None
    error: str | None = None

    model_config = ConfigDict(arbitrary_types_allowed=True)


class UploadDocument(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
    )

    id: PyObjectId | None = Field(default=None, alias="_id")
    uploaded_by: PyObjectId
    manifest: list[UploadManifestItem] = Field(default_factory=list)
    total_files: int = 0
    processed_files: int = 0
    failed_files: int = 0
    status: Literal[
        "pending", "processing", "complete", "partial_failure", "failed"
    ] = "pending"
    source_folder: str | None = None
    celery_task_id: str | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
