from __future__ import annotations

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel, EmailStr

from app.core.pagination import PageParams
from app.core.rbac import require_permission
from app.dependencies import get_current_active_user, get_db
from app.models.user import UserDocument
from app.schemas.user import (
    AdminCreateUserRequest,
    UserListResponse,
    UserResponse,
    UserRoleUpdateRequest,
    UserUpdateRequest,
)
from app.core.exceptions import ValidationError
from app.services import auth_service, user_service
from app.tasks.email import dispatch_invite_email, dispatch_invite_link_email

router = APIRouter(prefix="/users", tags=["users"])


class InviteLinkRequest(BaseModel):
    email: EmailStr
    role: str = "listener"


def _ctx(request: Request) -> dict:
    return {
        "actor_ip": getattr(request.state, "actor_ip", ""),
        "actor_ua": getattr(request.state, "actor_ua", ""),
        "request_id": getattr(request.state, "request_id", ""),
    }


def _to_response(user: UserDocument) -> UserResponse:
    return UserResponse(
        id=user.id,
        email=user.email,
        username=user.username,
        role=user.role,
        is_active=user.is_active,
        is_verified=user.is_verified,
        profile=user.profile,
        artist_id=user.artist_id,
        created_at=user.created_at,
    )


@router.post("/", response_model=UserResponse, status_code=201)
async def create_user(
    body: AdminCreateUserRequest,
    request: Request,
    actor: UserDocument = require_permission("*"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> UserResponse:
    user = await user_service.admin_create_user(db, body, actor, **_ctx(request))
    if body.send_invite:
        try:
            dispatch_invite_email(
                user_id=str(user.id),
                email=user.email,
                username=user.username,
                role=user.role,
                invited_by=actor.username,
            )
        except Exception:
            pass  # email failure should not block user creation
    return _to_response(user)


@router.post("/{user_id}/invite", status_code=204)
async def send_invite(
    user_id: str,
    request: Request,
    actor: UserDocument = require_permission("*"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> None:
    user = await user_service.get_user(db, user_id)
    dispatch_invite_email(
        user_id=str(user.id),
        email=user.email,
        username=user.username,
        role=user.role,
        invited_by=actor.username,
    )


@router.patch("/me", response_model=UserResponse)
async def update_me(
    body: UserUpdateRequest,
    request: Request,
    current_user: UserDocument = Depends(get_current_active_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> UserResponse:
    updated = await user_service.update_user(db, str(current_user.id), body, current_user, **_ctx(request))
    return _to_response(updated)


@router.post("/me/avatar", response_model=UserResponse)
async def upload_my_avatar(
    file: UploadFile = File(...),
    current_user: UserDocument = Depends(get_current_active_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> UserResponse:
    allowed = {"image/jpeg", "image/png", "image/webp"}
    if file.content_type not in allowed:
        raise ValidationError("Avatar must be a JPEG, PNG, or WebP image")
    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise ValidationError("Avatar file must be under 5 MB")
    updated = await user_service.upload_avatar(db, str(current_user.id), data, file.content_type or "image/jpeg")
    return _to_response(updated)


@router.post("/invite-link", status_code=204)
async def send_invite_link(
    body: InviteLinkRequest,
    actor: UserDocument = require_permission("*"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> None:
    token = await auth_service.create_invite_token(
        db, str(body.email), body.role, actor.username
    )
    dispatch_invite_link_email(
        email=str(body.email),
        role=body.role,
        invited_by=actor.username,
        token=token,
    )


@router.get("/", response_model=UserListResponse)
async def list_users(
    request: Request,
    role: str | None = Query(default=None),
    search: str | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=500),
    _actor: UserDocument = require_permission("*"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> UserListResponse:
    page = PageParams(skip=skip, limit=limit)
    users, total = await user_service.list_users(db, page, role, search)
    return UserListResponse(items=[_to_response(u) for u in users], total=total, skip=skip, limit=limit)


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: str,
    actor: UserDocument = Depends(get_current_active_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> UserResponse:
    # Admin can view anyone; others can only view themselves
    from app.core.exceptions import ForbiddenError
    if actor.role != "admin" and str(actor.id) != user_id:
        raise ForbiddenError("You can only view your own profile")
    return _to_response(await user_service.get_user(db, user_id))


@router.patch("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: str,
    body: UserUpdateRequest,
    request: Request,
    actor: UserDocument = Depends(get_current_active_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> UserResponse:
    updated = await user_service.update_user(db, user_id, body, actor, **_ctx(request))
    return _to_response(updated)


@router.patch("/{user_id}/role", response_model=UserResponse)
async def change_role(
    user_id: str,
    body: UserRoleUpdateRequest,
    request: Request,
    actor: UserDocument = require_permission("*"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> UserResponse:
    updated = await user_service.change_role(db, user_id, body, actor, **_ctx(request))
    return _to_response(updated)


@router.delete("/{user_id}", status_code=204)
async def deactivate_user(
    user_id: str,
    request: Request,
    actor: UserDocument = require_permission("*"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> None:
    await user_service.deactivate_user(db, user_id, actor, **_ctx(request))


@router.patch("/{user_id}/activate", response_model=UserResponse)
async def activate_user(
    user_id: str,
    request: Request,
    actor: UserDocument = require_permission("*"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> UserResponse:
    updated = await user_service.activate_user(db, user_id, actor, **_ctx(request))
    return _to_response(updated)
