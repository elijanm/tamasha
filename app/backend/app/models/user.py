from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.utils.object_id import PyObjectId


class UserProfile(BaseModel):
    display_name: str = ""
    avatar_url: str | None = None
    avatar_r2_key: str | None = None
    bio: str | None = None
    phone: str | None = None


class UserDocument(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
    )

    id: PyObjectId | None = Field(default=None, alias="_id")
    email: str
    username: str
    hashed_password: str
    role: Literal["superadmin", "admin", "staff", "artist", "listener"] = "listener"
    extra_permissions: list[str] = Field(default_factory=list)
    is_active: bool = True
    is_verified: bool = False
    email_verified_at: datetime | None = None
    profile: UserProfile = Field(default_factory=UserProfile)
    artist_id: PyObjectId | None = None
    last_login_at: datetime | None = None
    last_login_ip: str | None = None
    refresh_token_hash: str | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
