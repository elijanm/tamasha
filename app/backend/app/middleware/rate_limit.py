from __future__ import annotations

import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.config import get_settings
from app.db.redis import get_redis


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Redis sliding-window rate limiter.

    Auth-related paths (``/api/v1/auth/``) are limited to 10 requests per
    minute.  All other paths use the configured default.
    """

    _AUTH_LIMIT = 10
    _AUTH_PREFIX = "/api/v1/auth/"

    async def dispatch(self, request: Request, call_next) -> Response:
        settings = get_settings()
        ip = getattr(request.state, "actor_ip", None) or (
            request.client.host if request.client else "unknown"
        )
        path = request.url.path

        is_auth_path = path.startswith(self._AUTH_PREFIX)
        limit = self._AUTH_LIMIT if is_auth_path else settings.rate_limit_per_minute

        minute_bucket = int(time.time() // 60)
        cache_key = f"ratelimit:{ip}:{minute_bucket}"

        try:
            redis = get_redis()
            current = await redis.incr(cache_key)
            if current == 1:
                await redis.expire(cache_key, 60)

            if current > limit:
                seconds_left = 60 - int(time.time() % 60)
                if is_auth_path:
                    detail = (
                        f"Too many login attempts from your IP address. "
                        f"Please wait {seconds_left} second{'s' if seconds_left != 1 else ''} before trying again."
                    )
                else:
                    detail = (
                        f"You have exceeded the request limit ({limit} requests per minute). "
                        f"Please wait {seconds_left} second{'s' if seconds_left != 1 else ''} before retrying."
                    )
                return JSONResponse(
                    status_code=429,
                    content={
                        "error": "rate_limit_exceeded",
                        "detail": detail,
                        "retry_after": seconds_left,
                    },
                    headers={"Retry-After": str(seconds_left)},
                )
        except Exception:  # noqa: BLE001 — never block request on Redis failure
            pass

        return await call_next(request)
