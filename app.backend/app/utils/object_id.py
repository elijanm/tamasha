from __future__ import annotations

from typing import Any

from bson import ObjectId
from pydantic import GetCoreSchemaHandler
from pydantic_core import core_schema


class PyObjectId(str):
    """Pydantic v2-compatible ObjectId type that serialises as a plain string."""

    @classmethod
    def __get_pydantic_core_schema__(
        cls, source_type: Any, handler: GetCoreSchemaHandler
    ) -> core_schema.CoreSchema:
        return core_schema.no_info_plain_validator_function(
            cls.validate,
            serialization=core_schema.to_string_ser_schema(),
        )

    @classmethod
    def validate(cls, v: Any) -> "PyObjectId":
        if isinstance(v, ObjectId):
            return cls(str(v))
        if isinstance(v, cls):
            return v
        if isinstance(v, str):
            if not ObjectId.is_valid(v):
                raise ValueError(f"Invalid ObjectId: {v!r}")
            return cls(v)
        raise TypeError(f"Expected str or ObjectId, got {type(v)}")

    @classmethod
    def __get_pydantic_json_schema__(
        cls, schema: core_schema.CoreSchema, handler: Any
    ) -> dict[str, Any]:
        return {"type": "string", "description": "MongoDB ObjectId as string"}

    def to_object_id(self) -> ObjectId:
        return ObjectId(self)
