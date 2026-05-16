from __future__ import annotations

from datetime import datetime, timezone


def utc_now() -> datetime:
    """Return the current UTC datetime, timezone-aware."""
    return datetime.now(tz=timezone.utc)


def format_iso(dt: datetime) -> str:
    """Return an ISO 8601 string representation of *dt*.

    If *dt* is naive it is assumed to be UTC.
    """
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()
