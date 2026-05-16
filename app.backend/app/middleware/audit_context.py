from __future__ import annotations

import ipaddress

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


def _extract_client_ip(request: Request) -> str:
    """Return the real client IP, skipping private/loopback addresses from
    ``X-Forwarded-For``, falling back to ``request.client.host``."""
    forwarded_for = request.headers.get("X-Forwarded-For", "")
    if forwarded_for:
        for candidate in (ip.strip() for ip in forwarded_for.split(",")):
            try:
                addr = ipaddress.ip_address(candidate)
                if not addr.is_private and not addr.is_loopback:
                    return candidate
            except ValueError:
                continue
    if request.client:
        return request.client.host
    return "unknown"


class AuditContextMiddleware(BaseHTTPMiddleware):
    """Populate ``request.state.actor_ip`` and ``request.state.actor_ua``."""

    async def dispatch(self, request: Request, call_next) -> Response:
        request.state.actor_ip = _extract_client_ip(request)
        request.state.actor_ua = request.headers.get("User-Agent", "")
        return await call_next(request)
