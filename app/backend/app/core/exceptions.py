from __future__ import annotations

import structlog
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

logger = structlog.get_logger(__name__)


class TamashaError(Exception):
    """Base class for all Tamasha application errors."""

    status_code: int = 500
    error_code: str = "internal_error"

    def __init__(self, message: str = "An internal error occurred") -> None:
        self.message = message
        super().__init__(message)


class NotFoundError(TamashaError):
    status_code = 404
    error_code = "not_found"

    def __init__(self, message: str = "Resource not found") -> None:
        super().__init__(message)


class ForbiddenError(TamashaError):
    status_code = 403
    error_code = "forbidden"

    def __init__(self, message: str = "You do not have permission to perform this action") -> None:
        super().__init__(message)


class UnauthorizedError(TamashaError):
    status_code = 401
    error_code = "unauthorized"

    def __init__(self, message: str = "Authentication required") -> None:
        super().__init__(message)


class ConflictError(TamashaError):
    status_code = 409
    error_code = "conflict"

    def __init__(self, message: str = "Resource conflict") -> None:
        super().__init__(message)


class ValidationError(TamashaError):
    status_code = 422
    error_code = "validation_error"

    def __init__(self, message: str = "Validation failed") -> None:
        super().__init__(message)


class RateLimitError(TamashaError):
    status_code = 429
    error_code = "rate_limit_exceeded"

    def __init__(self, message: str = "Rate limit exceeded", retry_after: int = 60) -> None:
        super().__init__(message)
        self.retry_after = retry_after


def register_exception_handlers(app: FastAPI) -> None:
    """Register all custom exception handlers on the FastAPI app."""

    @app.exception_handler(TamashaError)
    async def tamasha_error_handler(request: Request, exc: TamashaError) -> JSONResponse:
        headers = {}
        if isinstance(exc, RateLimitError):
            headers["Retry-After"] = str(exc.retry_after)
        if isinstance(exc, UnauthorizedError):
            headers["WWW-Authenticate"] = "Bearer"
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": exc.error_code, "detail": exc.message},
            headers=headers,
        )

    @app.exception_handler(NotFoundError)
    async def not_found_handler(request: Request, exc: NotFoundError) -> JSONResponse:
        return JSONResponse(
            status_code=404,
            content={"error": exc.error_code, "detail": exc.message},
        )

    @app.exception_handler(ForbiddenError)
    async def forbidden_handler(request: Request, exc: ForbiddenError) -> JSONResponse:
        return JSONResponse(
            status_code=403,
            content={"error": exc.error_code, "detail": exc.message},
        )

    @app.exception_handler(UnauthorizedError)
    async def unauthorized_handler(request: Request, exc: UnauthorizedError) -> JSONResponse:
        return JSONResponse(
            status_code=401,
            content={"error": exc.error_code, "detail": exc.message},
            headers={"WWW-Authenticate": "Bearer"},
        )

    @app.exception_handler(ConflictError)
    async def conflict_handler(request: Request, exc: ConflictError) -> JSONResponse:
        return JSONResponse(
            status_code=409,
            content={"error": exc.error_code, "detail": exc.message},
        )

    @app.exception_handler(RateLimitError)
    async def rate_limit_handler(request: Request, exc: RateLimitError) -> JSONResponse:
        return JSONResponse(
            status_code=429,
            content={"error": exc.error_code, "detail": exc.message},
            headers={"Retry-After": str(exc.retry_after)},
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.error(
            "unhandled_exception",
            method=request.method,
            path=request.url.path,
            exc_type=type(exc).__name__,
            exc=str(exc),
        )
        return JSONResponse(
            status_code=500,
            content={"error": "internal_error", "detail": "An unexpected error occurred"},
        )
