"""WhatsApp auto-notifications via the self-hosted wa-bridge service.

Composes a status-aware message and pushes it to the bridge over the internal
network. Every public function is best-effort and swallows its own errors — a
WhatsApp failure must never break a job status change.
"""
import logging

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings as app_settings
from app.models import Job, TimelineEvent, User
from app.services.settings_service import get_all_settings

logger = logging.getLogger("workshopiq.whatsapp")


def normalize_msisdn(raw: str | None, country_code: str = "27") -> str:
    """Reduce a phone number to bare international digits for WhatsApp.

    Leading "0" is swapped for the country code; "+"/"00" prefixes stripped.
    Returns "" if nothing usable.
    """
    if not raw:
        return ""
    cc = "".join(ch for ch in (country_code or "") if ch.isdigit())
    d = "".join(ch for ch in raw if ch.isdigit() or ch == "+")
    if not d:
        return ""
    if d.startswith("+"):
        d = d[1:]
    elif d.startswith("00"):
        d = d[2:]
    elif d.startswith("0"):
        d = cc + d[1:]
    elif cc and not d.startswith(cc):
        d = cc + d
    return d


def compose_message(job: Job, status: str, company: str, base_url: str = "") -> str:
    """A short, status-aware update for the customer."""
    who = job.contact_person or job.customer_name or "there"
    head = f"Hi {who}, this is {company}."
    if status in ("Completed", "Awaiting Customer Review"):
        line = f"Your job {job.job_number} is complete and ready for collection."
    elif status == "Inspection":
        line = f"Your job {job.job_number} has moved to final inspection."
    elif status == "Inspection Failed":
        line = f"Your job {job.job_number} needs rework after inspection — we'll keep you posted."
    elif status == "Machining":
        line = f"Your job {job.job_number} is now in production."
    elif status == "Closed":
        line = f"Your job {job.job_number} is now closed. Thank you for your business."
    else:
        line = f"We've received your job {job.job_number} and it's now logged."
    msg = f"{head} {line}"
    if base_url:
        msg += f"\nTrack progress: {base_url.rstrip('/')}"
    return msg


async def _bridge_post(path: str, payload: dict) -> tuple[bool, str]:
    """POST to the bridge. Returns (ok, error_message)."""
    if not app_settings.WA_BRIDGE_TOKEN:
        return False, "bridge token not configured"
    url = app_settings.WA_BRIDGE_URL.rstrip("/") + path
    headers = {"x-bridge-token": app_settings.WA_BRIDGE_TOKEN}
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(url, json=payload, headers=headers)
        if resp.status_code == 200 and resp.json().get("ok"):
            return True, ""
        detail = ""
        try:
            detail = resp.json().get("error", "")
        except Exception:
            detail = resp.text[:200]
        return False, detail or f"bridge returned {resp.status_code}"
    except Exception as exc:  # noqa: BLE001
        logger.warning("WhatsApp bridge unreachable: %s", exc)
        return False, "bridge unreachable"


async def send_message(to_msisdn: str, text: str) -> tuple[bool, str]:
    """Send a raw message to an already-normalised international number."""
    if not to_msisdn:
        return False, "no number"
    return await _bridge_post("/send", {"to": to_msisdn, "message": text})


async def bridge_status() -> dict:
    """Fetch connection state + QR from the bridge for the Settings page."""
    if not app_settings.WA_BRIDGE_TOKEN:
        return {"connected": False, "user": None, "qr": None, "error": "bridge token not configured"}
    url = app_settings.WA_BRIDGE_URL.rstrip("/") + "/health"
    headers = {"x-bridge-token": app_settings.WA_BRIDGE_TOKEN}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url, headers=headers)
        if resp.status_code == 200:
            return resp.json()
        return {"connected": False, "user": None, "qr": None, "error": f"bridge returned {resp.status_code}"}
    except Exception as exc:  # noqa: BLE001
        logger.warning("WhatsApp bridge status failed: %s", exc)
        return {"connected": False, "user": None, "qr": None, "error": "bridge unreachable"}


async def notify_status_change(
    db: AsyncSession, job: Job, new_status: str, user: User | None = None
) -> None:
    """Auto-send a WhatsApp update to the customer on a status change.

    Best-effort: respects the enable toggle + configured status list, requires
    a phone number, and never raises. On success it appends a timeline event.
    The caller is responsible for committing (the timeline event rides the
    caller's existing transaction).
    """
    try:
        s = await get_all_settings(db)
        if s.get("wa_auto_enabled", "0") != "1":
            return
        wanted = {
            x.strip()
            for x in (s.get("wa_notify_statuses") or "").split(",")
            if x.strip()
        }
        if new_status not in wanted:
            return
        if not job.phone:
            return
        to = normalize_msisdn(job.phone, s.get("whatsapp_country_code") or "27")
        if not to:
            return
        company = s.get("company_name") or "WorkshopIQ"
        text = compose_message(job, new_status, company, app_settings.PUBLIC_BASE_URL)
        ok, err = await send_message(to, text)
        actor = (user.full_name or user.username) if user else "System"
        if ok:
            db.add(
                TimelineEvent(
                    job_id=job.id,
                    event_type="whatsapp",
                    description="WhatsApp update sent to customer (auto)",
                    actor_name=actor,
                )
            )
        else:
            logger.info("WhatsApp auto-notify skipped/failed for job %s: %s", job.id, err)
    except Exception:  # noqa: BLE001
        logger.exception("WhatsApp auto-notify error")
