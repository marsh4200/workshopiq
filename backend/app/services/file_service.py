"""File storage helpers for photos and documents."""
import os
import uuid
from pathlib import Path

from fastapi import UploadFile

from app.core.config import settings

UPLOAD_ROOT = Path(settings.UPLOAD_DIR)
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".bmp"}


def _ensure_dir() -> None:
    UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)


async def save_upload(upload: UploadFile, job_id: int) -> tuple[str, str]:
    """Persist an uploaded file. Returns (stored_filename, original_name)."""
    _ensure_dir()
    ext = Path(upload.filename or "").suffix.lower()
    stored = f"job{job_id}_{uuid.uuid4().hex}{ext}"
    dest = UPLOAD_ROOT / stored
    content = await upload.read()
    max_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024
    if len(content) > max_bytes:
        raise ValueError(f"File exceeds {settings.MAX_UPLOAD_MB} MB limit")
    with open(dest, "wb") as f:
        f.write(content)
    return stored, (upload.filename or stored)


def is_image(filename: str) -> bool:
    return Path(filename).suffix.lower() in IMAGE_EXTS


def delete_file(filename: str) -> None:
    try:
        path = UPLOAD_ROOT / filename
        if path.exists():
            os.remove(path)
    except OSError:
        pass


def file_path(filename: str) -> Path:
    return UPLOAD_ROOT / filename
