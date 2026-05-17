from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import Depends

from app.core.exceptions import ForbiddenError

if TYPE_CHECKING:
    from app.models.user import UserDocument

ROLE_PERMISSIONS: dict[str, set[str]] = {
    "superadmin": {"*", "billing.manage"},
    "admin": {"*"},
    "staff": {
        "track.read",
        "track.write",
        "upload.read",
        "upload.write",
        "artist.read",
        "artist.write",
        "skiza.read",
        "skiza.write",
        "duplicate.read",
        "duplicate.write",
        "analytics.read",
        "audit_log.read",
        "sync_job.read",
        "admin.read",
    },
    "artist": {
        "track.read",
        "artist.read",
        "artist.update_own",
        "analytics.read_own",
        "upload.write",
    },
    "listener": {
        "track.read",
        "stream.read",
        "playlist.read",
        "playlist.write",
        "analytics.ingest",
    },
}


def has_permission(role: str, permission: str) -> bool:
    """Return True when *role* holds *permission* or the wildcard ``*``."""
    perms = ROLE_PERMISSIONS.get(role, set())
    return "*" in perms or permission in perms


def require_permission(permission: str):
    """Return a FastAPI dependency that checks the current user's permissions.

    The dependency resolves to the current :class:`UserDocument` so routes can
    use the user object directly::

        @router.get("/")
        async def my_route(current_user = require_permission("track.read")):
            ...
    """
    from app.dependencies import get_current_active_user

    async def _check(current_user: "UserDocument" = Depends(get_current_active_user)) -> "UserDocument":
        if not has_permission(current_user.role, permission):
            raise ForbiddenError(
                f"Role '{current_user.role}' does not have permission '{permission}'"
            )
        return current_user

    return Depends(_check)
