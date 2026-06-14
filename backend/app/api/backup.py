"""Full-system backup & restore endpoints (administrator only)."""
import tempfile
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.background import BackgroundTask

from app.api.deps import require_admin
from app.core.config import settings as app_settings
from app.core.database import get_db
from app.models import User
from app.services import backup_service

router = APIRouter(prefix="/settings", tags=["backup"])


@router.get("/backup")
async def download_backup(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Build and download a complete system backup (database + uploads)."""
    database, counts = await backup_service.collect_database(db)
    path = await run_in_threadpool(
        backup_service.write_archive, database, counts, app_settings.APP_VERSION
    )
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    filename = f"workshopiq-backup-{stamp}.zip"
    return FileResponse(
        path,
        media_type="application/zip",
        filename=filename,
        background=BackgroundTask(_cleanup, path),
    )


def _cleanup(path: str) -> None:
    import os

    try:
        os.remove(path)
    except OSError:
        pass


@router.post("/restore")
async def restore_backup(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Restore the whole system from an uploaded backup .zip.

    This OVERWRITES all current data and uploads with the contents of the
    backup. Intended for disaster recovery onto a fresh install.
    """
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="No file uploaded.")

    with tempfile.TemporaryDirectory(prefix="workshopiq-restore-") as work:
        try:
            manifest, database, uploads_dir = await run_in_threadpool(
                backup_service.read_archive, file_bytes, work
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

        try:
            counts = await backup_service.restore_database(db, database)
        except Exception as exc:  # noqa: BLE001
            await db.rollback()
            raise HTTPException(status_code=500, detail=f"Database restore failed: {exc}")

        await run_in_threadpool(backup_service.replace_uploads, uploads_dir)

    return {
        "status": "ok",
        "restored_from_version": manifest.get("app_version"),
        "created_at": manifest.get("created_at"),
        "counts": counts,
    }
