from __future__ import annotations

from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from fastapi.middleware.gzip import GZipMiddleware
from starlette.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.core.exceptions import register_exception_handlers
from app.core.seed import ensure_admin_user
from app.db.mongo import connect_db, create_indexes, disconnect_db, get_database
from app.db.redis import connect_redis, disconnect_redis, get_redis
from app.middleware.audit_context import AuditContextMiddleware
from app.middleware.rate_limit import RateLimitMiddleware
from app.middleware.request_id import RequestIDMiddleware

structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ]
)

logger = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logger.info("startup", environment=settings.environment)
    await connect_db()
    await create_indexes()
    await ensure_admin_user(get_database())
    await connect_redis()
    yield
    await disconnect_db()
    await disconnect_redis()
    logger.info("shutdown")


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="Tamasha API",
        version="0.1.0",
        description="Tamasha music archival and streaming platform API",
        lifespan=lifespan,
        docs_url="/api/docs" if not settings.is_production else None,
        redoc_url="/api/redoc" if not settings.is_production else None,
    )

    # ── Middleware (outermost first) ───────────────────────────────────────────
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        # Wildcard patterns for ngrok tunnels and LAN access in development
        allow_origin_regex=r"https://.*\.ngrok\.io|https://.*\.ngrok-free\.app|http://\d+\.\d+\.\d+\.\d+:\d+",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(RequestIDMiddleware)
    app.add_middleware(AuditContextMiddleware)
    app.add_middleware(RateLimitMiddleware)
    app.add_middleware(GZipMiddleware, minimum_size=1000)

    # ── Exception handlers ────────────────────────────────────────────────────
    register_exception_handlers(app)

    # ── Routers ───────────────────────────────────────────────────────────────
    from app.routers import (
        admin,
        analytics,
        artists,
        audit_logs,
        auth,
        billing,
        duplicates,
        media_monitoring,
        r2_pool,
        recognize,
        sync_jobs,
        tracks,
        uploads,
        users,
    )

    prefix = "/api/v1"
    app.include_router(auth.router, prefix=prefix)
    app.include_router(users.router, prefix=prefix)
    app.include_router(artists.router, prefix=prefix)
    app.include_router(tracks.router, prefix=prefix)
    app.include_router(uploads.router, prefix=prefix)
    app.include_router(analytics.router, prefix=prefix)
    app.include_router(sync_jobs.router, prefix=prefix)
    app.include_router(audit_logs.router, prefix=prefix)
    app.include_router(admin.router, prefix=prefix)
    app.include_router(r2_pool.router, prefix=prefix)
    app.include_router(media_monitoring.router, prefix=prefix)
    app.include_router(duplicates.router, prefix=prefix)
    app.include_router(billing.router, prefix=prefix)
    app.include_router(recognize.router, prefix=prefix)

    # ── Health check ──────────────────────────────────────────────────────────
    @app.get("/healthz", tags=["health"])
    async def healthz() -> dict:
        from app.db.mongo import get_database
        db_ok = False
        redis_ok = False
        try:
            await get_database().command("ping")
            db_ok = True
        except Exception:
            pass
        try:
            r = get_redis()
            await r.ping()
            redis_ok = True
        except Exception:
            pass
        return {
            "status": "ok" if db_ok and redis_ok else "degraded",
            "db": "connected" if db_ok else "disconnected",
            "redis": "connected" if redis_ok else "disconnected",
        }

    return app


app = create_app()
