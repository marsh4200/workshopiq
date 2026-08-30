"""Outbound email (SMTP) for client job notifications.

Uses the Python standard library's ``smtplib`` — nothing new to add to
requirements.txt. SMTP is blocking, so the actual send runs in a threadpool
from async code via ``fastapi.concurrency.run_in_threadpool``, matching the
pattern used for the Samba backup client elsewhere in this codebase.

Two administrator-controlled toggles (stored in Settings) gate everything:
  - notify_on_status_change  — email the client(s) assigned to a job whenever
    its status changes (any transition other than reaching "Completed").
  - notify_on_job_completion — email the client(s) assigned to a job when it
    reaches the "Completed" status.

A job reaching "Completed" fires only the completion email, never both, so
clients don't get two notifications for the same event.

All send failures are logged and swallowed here — a broken or unconfigured
SMTP setup must never break the job-status-update request itself.
"""
import logging
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ClientJobAccess, Job, User, UserRole
from app.services.settings_service import get_all_settings

logger = logging.getLogger("workshopiq.email")


def _truthy(value: str | None) -> bool:
    return str(value or "0").strip().lower() in ("1", "true", "yes", "on")


class EmailNotConfigured(Exception):
    """Raised when SMTP host/from-address settings are missing."""


def _send_sync(
    host: str,
    port: int,
    username: str,
    password: str,
    from_addr: str,
    to_addrs: list[str],
    subject: str,
    text_body: str,
) -> None:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = ", ".join(to_addrs)
    msg.attach(MIMEText(text_body, "plain"))

    if port == 465:
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(host, port, timeout=20, context=context) as server:
            if username:
                server.login(username, password or "")
            server.sendmail(from_addr, to_addrs, msg.as_string())
    else:
        with smtplib.SMTP(host, port, timeout=20) as server:
            server.ehlo()
            try:
                server.starttls(context=ssl.create_default_context())
                server.ehlo()
            except smtplib.SMTPNotSupportedError:
                pass  # server doesn't offer STARTTLS (e.g. local relay) — send plain
            if username:
                server.login(username, password or "")
            server.sendmail(from_addr, to_addrs, msg.as_string())


async def send_email(
    db: AsyncSession, to_addrs: list[str], subject: str, text_body: str
) -> None:
    """Send a plain-text email via the SMTP settings configured in Settings.

    Raises EmailNotConfigured if host/from-address aren't set, or whatever
    smtplib raises on a connection/auth/send failure. Callers that must not
    fail the surrounding request (e.g. notification hooks) should catch.
    """
    to_addrs = [a for a in (to_addrs or []) if a]
    if not to_addrs:
        return

    s = await get_all_settings(db)
    host = (s.get("email_host") or "").strip()
    user = (s.get("email_user") or "").strip()
    password = s.get("email_password") or ""
    from_addr = (s.get("email_from") or user).strip()
    port_raw = (s.get("email_port") or "587").strip()

    if not host or not from_addr:
        raise EmailNotConfigured("SMTP host and From address must be configured in Settings")

    try:
        port = int(port_raw)
    except ValueError:
        port = 587

    await run_in_threadpool(
        _send_sync, host, port, user, password, from_addr, to_addrs, subject, text_body
    )


async def assigned_client_emails(db: AsyncSession, job_id: int) -> list[str]:
    """Every distinct, active client email assigned to this job."""
    result = await db.execute(
        select(User.email)
        .join(ClientJobAccess, ClientJobAccess.user_id == User.id)
        .where(
            ClientJobAccess.job_id == job_id,
            User.role == UserRole.client.value,
            User.is_active.is_(True),
            User.email.is_not(None),
            User.email != "",
        )
        .distinct()
    )
    return [e for (e,) in result.all() if e]


async def notify_job_status_changed(
    db: AsyncSession, job: Job, old_status: str, new_status: str
) -> None:
    """Fire the appropriate client notification for a job status transition.

    Reaching "Completed" fires the completion email (if that toggle is on);
    every other transition fires the general status-change email (if that
    toggle is on). Never both, for the same transition.
    """
    if old_status == new_status:
        return

    s = await get_all_settings(db)
    is_completion = new_status == "Completed"
    toggle_key = "notify_on_job_completion" if is_completion else "notify_on_status_change"
    if not _truthy(s.get(toggle_key)):
        return

    emails = await assigned_client_emails(db, job.id)
    if not emails:
        return

    if is_completion:
        subject = f"{job.job_number} — your job is complete"
        text = (
            f"Good news — job {job.job_number} ({job.customer_name}) has been "
            f"marked Completed."
        )
    else:
        subject = f"{job.job_number} — status update: {new_status}"
        text = (
            f"Job {job.job_number} ({job.customer_name}) status changed from "
            f"{old_status} to {new_status}."
        )

    try:
        await send_email(db, emails, subject, text)
    except Exception:  # noqa: BLE001 — never let a broken SMTP config break a job update
        logger.exception(
            "Failed to send %s email for job %s", "completion" if is_completion else "status-change", job.id
        )
