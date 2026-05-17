from __future__ import annotations

import hashlib
from pathlib import Path

_CHUNK = 65_536  # 64 KiB


def sha256_file(path: str | Path) -> str:
    """Return the lowercase hex SHA-256 digest of the file at *path*."""
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while chunk := fh.read(_CHUNK):
            h.update(chunk)
    return h.hexdigest()


def md5_file(path: str | Path) -> str:
    """Return the lowercase hex MD5 digest of the file at *path*."""
    h = hashlib.md5()  # noqa: S324  — used for dedup, not security
    with open(path, "rb") as fh:
        while chunk := fh.read(_CHUNK):
            h.update(chunk)
    return h.hexdigest()
