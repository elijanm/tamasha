from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.core.pagination import PagedResponse
from app.utils.object_id import PyObjectId


class UserProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    display_name: str = ""
    avatar_url: str | None = None
    bio: str | None = None


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: PyObjectId
    email: str
    username: str
    role: Literal["admin", "staff", "artist", "listener"]
    is_active: bool
    is_verified: bool
    profile: UserProfileResponse
    artist_id: PyObjectId | None = None
    created_at: datetime


class UserUpdateRequest(BaseModel):
    display_name: str | None = Field(default=None, max_length=100)
    bio: str | None = Field(default=None, max_length=1000)
    avatar_url: str | None = None


class UserRoleUpdateRequest(BaseModel):
    role: Literal["admin", "staff", "artist", "listener"]


class AdminCreateUserRequest(BaseModel):
    email: str = Field(..., max_length=254)
    username: str = Field(..., min_length=2, max_length=50)
    password: str = Field(..., min_length=8, max_length=128)
    role: Literal["admin", "staff", "artist", "listener"] = "listener"
    send_invite: bool = True


UserListResponse = PagedResponse[UserResponse]
