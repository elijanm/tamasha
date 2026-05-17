from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.core.pagination import PagedResponse
from app.utils.object_id import PyObjectId


class AuditLogResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: PyObjectId = Field(alias="_id")
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
    occurred_at: datetime


class AuditLogFilter(BaseModel):
    actor_id: str | None = None
    action: str | None = None
    entity_type: str | None = None
    entity_id: str | None = None
    from_date: datetime | None = None
    to_date: datetime | None = None


AuditLogListResponse = PagedResponse[AuditLogResponse]
