"""Samba (network-drive) backup configuration and manual trigger.

Lets an administrator point WorkshopIQ at an SMB share and turn on automatic
6-hourly backups. The share password is stored like the SMTP password — write
only; it is never returned to the browser.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.core.database import get_db
from app.models import User
from app.schemas import SambaConfigOut, SambaStatusOut, SambaUpdate
from app.services import samba_service
from app.services.samba_scheduler import (
    INTERVAL_SECONDS,
    _cfg_from_settings,
    run_backup_to_share,
)
from app.services.settings_service import get_all_settings, set_setting

router = APIRouter(prefix="/settings/samba", tags=["samba"])


def _status(s: dict) -> SambaStatusOut:
    cfg = _cfg_from_settings(s)
    return SambaStatusOut(
        server=s.get("smb_server", "") or None,
        share=s.get("smb_share", "") or None,
        username=s.get("smb_username", "") or None,
        subpath=s.get("smb_subpath", "") or None,
        password_set=bool(s.get("smb_password")),
        auto_backup=s.get("smb_auto_backup") == "1",
        configured=cfg.configured,
        last_backup_at=s.get("smb_last_backup_at") or None,
        last_backup_status=s.get("smb_last_backup_status") or None,
        interval_hours=INTERVAL_SECONDS // 3600,
        keep_copies=samba_service.KEEP,
    )


@router.get("", response_model=SambaStatusOut)
async def read_samba(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    return _status(await get_all_settings(db))


@router.put("", response_model=SambaStatusOut)
async def update_samba(
    payload: SambaUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    fields = payload.model_dump(exclude_unset=True)

    # Empty/omitted password means "leave the stored one unchanged" so the
    # admin doesn't have to retype it every save.
    if "password" in fields and (fields["password"] is None or fields["password"] == ""):
        fields.pop("password")

    mapping = {
        "server": "smb_server",
        "share": "smb_share",
        "username": "smb_username",
        "password": "smb_password",
        "subpath": "smb_subpath",
    }
    for key, value in fields.items():
        if key == "auto_backup":
            await set_setting(db, "smb_auto_backup", "1" if value else "0")
        elif key in mapping:
            await set_setting(db, mapping[key], "" if value is None else str(value))
    await db.commit()
    return _status(await get_all_settings(db))


@router.post("/test", response_model=SambaConfigOut)
async def test_samba(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Verify the saved share is reachable with the saved credentials."""
    cfg = _cfg_from_settings(await get_all_settings(db))
    if not cfg.configured:
        raise HTTPException(status_code=400, detail="Enter a server and share name first.")
    try:
        await run_in_threadpool(samba_service.test_connection, cfg)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Connection failed: {exc}")
    return SambaConfigOut(ok=True, detail=f"Connected to {cfg.unc_dir()}")


@router.post("/backup-now", response_model=SambaConfigOut)
async def backup_now(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Run a backup to the share immediately (does not affect the 6h schedule)."""
    cfg = _cfg_from_settings(await get_all_settings(db))
    if not cfg.configured:
        raise HTTPException(status_code=400, detail="Enter a server and share name first.")
    try:
        remote = await run_backup_to_share(cfg)
    except Exception as exc:  # noqa: BLE001
        await set_setting(db, "smb_last_backup_status", f"error: {exc}")
        await db.commit()
        raise HTTPException(status_code=400, detail=f"Backup failed: {exc}")

    now = datetime.now(timezone.utc).isoformat()
    await set_setting(db, "smb_last_backup_at", now)
    await set_setting(db, "smb_last_backup_status", "ok")
    await db.commit()
    return SambaConfigOut(ok=True, detail=f"Backed up to {remote}")
