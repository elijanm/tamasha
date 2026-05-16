from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.core.pagination import PagedResponse
from app.utils.object_id import PyObjectId


class OwnershipRequestResponse(BaseModel):
    request_id: PyObjectId | None = None
    user_id: PyObjectId
    status: Literal["pending", "approved", "rejected"]
    notes: str | None = None
    requested_at: datetime
    reviewed_at: datetime | None = None
    reviewed_by: PyObjectId | None = None


class ArtistResponse(BaseModel):
    id: PyObjectId
    user_id: PyObjectId | None = None
    slug: str
    display_name: str
    bio: str | None = None
    image_url: str | None = None
    country: str | None = None
    genres: list[str]
    status: Literal["pending", "approved", "rejected"]
    approved_at: datetime | None = None
    track_count: int = 0
    is_band: bool = False
    auto_created: bool = False
    created_at: datetime
    updated_at: datetime


class ArtistDetailResponse(ArtistResponse):
    ownership_requests: list[OwnershipRequestResponse] = []


class ArtistCreateRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=200)
    bio: str | None = Field(default=None, max_length=5000)
    country: str | None = None
    genres: list[str] = Field(default_factory=list)
    image_url: str | None = None
    is_band: bool = False


class ArtistUpdateRequest(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=200)
    bio: str | None = Field(default=None, max_length=5000)
    country: str | None = None
    genres: list[str] | None = None
    image_url: str | None = None
    is_band: bool | None = None
    status: Literal["pending", "approved", "rejected"] | None = None


class OwnershipRequestReview(BaseModel):
    status: Literal["approved", "rejected"]
    notes: str | None = None


ArtistListResponse = PagedResponse[ArtistResponse]
