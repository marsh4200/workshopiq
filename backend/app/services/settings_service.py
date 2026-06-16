"""Settings key/value helpers."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings as app_settings
from app.models import Setting

DEFAULTS = {
    "company_name": "WorkshopIQ",
    "company_logo": "",
    "dashboard_branding": "Engineering Workshop Management",
    "job_number_prefix": "Job",
    "job_sequence": "0",
    "ncr_number_prefix": "NCR",
    "ncr_sequence": "0",
    "email_host": "",
    "email_port": "587",
    "email_user": "",
    "email_password": "",
    "email_from": "",
    "github_repo_url": "https://github.com/marsh4200/workshopiq",
    "current_version": app_settings.APP_VERSION,
    "available_version": "",
    # Samba network-drive backup
    "smb_server": "",
    "smb_share": "",
    "smb_username": "",
    "smb_password": "",
    "smb_subpath": "",
    "smb_auto_backup": "0",
    "smb_last_backup_at": "",
    "smb_last_backup_status": "",
}


async def get_setting(db: AsyncSession, key: str, default: str | None = None) -> str | None:
    row = await db.get(Setting, key)
    if row is None:
        return DEFAULTS.get(key, default)
    return row.value


async def set_setting(db: AsyncSession, key: str, value: str) -> None:
    row = await db.get(Setting, key)
    if row is None:
        row = Setting(key=key, value=value)
        db.add(row)
    else:
        row.value = value
    await db.flush()


async def get_all_settings(db: AsyncSession) -> dict[str, str]:
    result = await db.execute(select(Setting))
    stored = {s.key: (s.value or "") for s in result.scalars().all()}
    merged = dict(DEFAULTS)
    merged.update(stored)
    return merged


async def ensure_defaults(db: AsyncSession) -> None:
    result = await db.execute(select(Setting.key))
    existing = {r for r in result.scalars().all()}
    for key, value in DEFAULTS.items():
        if key not in existing:
            db.add(Setting(key=key, value=value))
    await db.flush()


async def next_job_number(db: AsyncSession) -> tuple[str, int]:
    """Increment sequence and return (job_number, sequence)."""
    prefix = await get_setting(db, "job_number_prefix") or "Job"
    seq_raw = await get_setting(db, "job_sequence") or "0"
    try:
        seq = int(seq_raw)
    except ValueError:
        seq = 0
    seq += 1
    await set_setting(db, "job_sequence", str(seq))
    return f"{prefix} {seq}", seq


async def next_ncr_number(db: AsyncSession) -> tuple[str, int]:
    """Increment the NCR sequence and return (ncr_number, sequence)."""
    prefix = await get_setting(db, "ncr_number_prefix") or "NCR"
    seq_raw = await get_setting(db, "ncr_sequence") or "0"
    try:
        seq = int(seq_raw)
    except ValueError:
        seq = 0
    seq += 1
    await set_setting(db, "ncr_sequence", str(seq))
    return f"{prefix} {seq}", seq
