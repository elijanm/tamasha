from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.utils.object_id import PyObjectId


class OwnershipRequest(BaseModel):
    request_id: PyObjectId | None = Field(default=None, alias="_id")
    user_id: PyObjectId
    status: Literal["pending", "approved", "rejected"] = "pending"
    notes: str | None = None
    requested_at: datetime = Field(default_factory=datetime.utcnow)
    reviewed_at: datetime | None = None
    reviewed_by: PyObjectId | None = None

    model_config = ConfigDict(populate_by_name=True, arbitrary_types_allowed=True)


class ArtistDocument(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
    )

    id: PyObjectId | None = Field(default=None, alias="_id")
    user_id: PyObjectId | None = None
    slug: str
    display_name: str
    bio: str | None = None
    image_url: str | None = None
    country: str | None = None
    genres: list[str] = Field(default_factory=list)
    status: Literal["pending", "approved", "rejected"] = "pending"
    approved_by: PyObjectId | None = None
    approved_at: datetime | None = None
    ownership_requests: list[OwnershipRequest] = Field(default_factory=list)
    is_band: bool = False
    created_by: PyObjectId | None = None
    auto_created: bool = False
    track_count: int = 0
    monthly_listeners: int = 0
    image_r2_key: str | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
