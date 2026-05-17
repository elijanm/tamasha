from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.utils.object_id import PyObjectId


class AuditLogDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True, arbitrary_types_allowed=True)

    id: PyObjectId | None = Field(default=None, alias="_id")
    actor_id: str | None = None
    actor_role: str = ""
    actor_ip: str = ""
    actor_ua: str = ""
    action: str
    entity_type: str
    entity_id: str
    before: dict[str, Any] | None = None
    after: dict[str, Any] | None = None
    request_id: str = ""
    occurred_at: datetime = Field(default_factory=datetime.utcnow)
