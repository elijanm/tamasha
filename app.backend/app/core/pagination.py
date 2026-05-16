from __future__ import annotations

from typing import Generic, TypeVar

from fastapi import Query
from pydantic import BaseModel, Field

T = TypeVar("T")


class PageParams:
    """Dependency class for pagination query parameters."""

    def __init__(
        self,
        skip: int = Query(default=0, ge=0, description="Number of records to skip"),
        limit: int = Query(
            default=20, ge=1, le=100, description="Maximum records to return (max 100)"
        ),
    ) -> None:
        self.skip = skip
        self.limit = limit


class PagedResponse(BaseModel, Generic[T]):
    """Generic paginated response envelope."""

    items: list[T]
    total: int = Field(description="Total number of matching records")
    skip: int = Field(description="Number of records skipped")
    limit: int = Field(description="Page size requested")

    model_config = {"arbitrary_types_allowed": True}
