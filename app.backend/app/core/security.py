from __future__ import annotations

import hashlib
import hmac
import uuid
from datetime import timedelta

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import get_settings
from app.core.exceptions import UnauthorizedError
from app.utils.datetime_utils import utc_now

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    """Return bcrypt hash of *password*."""
    return _pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    """Return True when *plain* matches *hashed*."""
    return _pwd_context.verify(plain, hashed)


def create_access_token(user_id: str, role: str) -> str:
    """Create a short-lived JWT access token."""
    settings = get_settings()
    now = utc_now()
    exp = now + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {
        "sub": user_id,
        "role": role,
        "type": "access",
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def create_refresh_token(user_id: str) -> str:
    """Create a long-lived JWT refresh token with a unique jti."""
    settings = get_settings()
    now = utc_now()
    exp = now + timedelta(days=settings.refresh_token_expire_days)
    payload = {
        "sub": user_id,
        "type": "refresh",
        "jti": str(uuid.uuid4()),
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict:
    """Decode and verify a JWT token.

    Raises :exc:`UnauthorizedError` if the token is invalid or expired.
    """
    settings = get_settings()
    try:
        return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise UnauthorizedError(f"Invalid or expired token: {exc}") from exc


def hash_refresh_token(token: str) -> str:
    """SHA-256 hash a refresh token for safe DB storage.

    Bcrypt is not used here because JWT tokens exceed 72 bytes.
    """
    return hashlib.sha256(token.encode()).hexdigest()


def verify_refresh_token_hash(token: str, stored_hash: str) -> bool:
    """Constant-time comparison of token hash against stored value."""
    expected = hashlib.sha256(token.encode()).hexdigest()
    return hmac.compare_digest(expected, stored_hash)
