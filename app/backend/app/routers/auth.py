from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.dependencies import get_current_active_user, get_db
from app.models.user import UserDocument
from app.schemas.auth import (
    ForgotPasswordRequest,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    ResetPasswordRequest,
    TokenResponse,
    VerifyEmailRequest,
)
from app.schemas.user import UserResponse
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


def _ctx(request: Request) -> dict:
    return {
        "actor_ip": getattr(request.state, "actor_ip", ""),
        "actor_ua": getattr(request.state, "actor_ua", ""),
        "request_id": getattr(request.state, "request_id", ""),
    }


@router.post("/register", response_model=TokenResponse, status_code=201)
async def register(
    body: RegisterRequest,
    request: Request,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> TokenResponse:
    return await auth_service.register(db, body, **_ctx(request))


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    request: Request,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> TokenResponse:
    return await auth_service.login(db, body, **_ctx(request))


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    body: RefreshRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> TokenResponse:
    return await auth_service.refresh_tokens(db, body)


@router.post("/logout", status_code=204)
async def logout(
    current_user: UserDocument = Depends(get_current_active_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> None:
    await auth_service.logout(db, str(current_user.id))


@router.post("/verify-email", status_code=204)
async def verify_email(
    body: VerifyEmailRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> None:
    await auth_service.verify_email(db, body.token)


@router.post("/forgot-password", status_code=204)
async def forgot_password(
    body: ForgotPasswordRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> None:
    await auth_service.forgot_password(db, body.email)


@router.post("/reset-password", status_code=204)
async def reset_password(
    body: ResetPasswordRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> None:
    await auth_service.reset_password(db, body)


@router.get("/me", response_model=UserResponse)
async def me(current_user: UserDocument = Depends(get_current_active_user)) -> UserResponse:
    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        username=current_user.username,
        role=current_user.role,
        extra_permissions=current_user.extra_permissions,
        is_active=current_user.is_active,
        is_verified=current_user.is_verified,
        profile=current_user.profile,
        artist_id=current_user.artist_id,
        created_at=current_user.created_at,
    )
