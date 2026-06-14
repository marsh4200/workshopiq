"""Final inspection: admin releases it, the assigned client passes or fails it.

Flow
----
1. Staff/admin "submit" (release) the final inspection on a job. This moves the
   job from Machining into the Inspection stage and makes the form available to
   the assigned client.
2. The client opens their job, enters the inspector's name and either:
     * PASSES it (optionally with an internal reference) — the final inspection
       is marked complete and the job moves to the Completed stage; a customer
       review can then be requested; or
     * FAILS it with a written reason — the job moves to the "Inspection Failed"
       stage. The review stays locked. Each failure is numbered (1st, 2nd, …),
       logged to the timeline, and saved as a note.
3. Staff fix whatever was flagged, then release the final inspection again
   ("send for re-inspection"). The job moves back to the Inspection stage and
   the client gets the pass/fail form once more. This loops until it passes.
4. Every outcome is recorded in the attempt log, which drives the inspection
   report (full pass/fail history).
5. Only once the final inspection has PASSED can a customer review be requested
   (enforced in app/api/reviews.py).
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user, require_staff
from app.api.jobs import (
    actor_name,
    assert_can_view,
    get_client_job_ids,
    log_event,
)
from app.core.database import get_db
from app.models import (
    FinalInspection,
    FinalInspectionAttempt,
    Job,
    JobCheckin,
    Note,
    User,
    UserRole,
)
from app.schemas import (
    FinalInspectionFail,
    FinalInspectionOut,
    FinalInspectionSubmit,
    PendingInspectionItem,
)

router = APIRouter(tags=["final-inspection"])

FAILED_STATUS = "Inspection Failed"
INSPECTION_STATUS = "Inspection"
COMPLETED_STATUS = "Completed"


def _ordinal(n: int) -> str:
    """1 -> '1st', 2 -> '2nd', 3 -> '3rd', 11 -> '11th', etc."""
    if 11 <= (n % 100) <= 13:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


async def _get_fi(db: AsyncSession, job_id: int) -> FinalInspection | None:
    result = await db.execute(
        select(FinalInspection).where(FinalInspection.job_id == job_id)
    )
    return result.scalar_one_or_none()


async def _is_checked_in(db: AsyncSession, job_id: int) -> bool:
    """True once the job's QR check-in has been completed (one-time, permanent)."""
    return bool(
        await db.scalar(
            select(JobCheckin.id)
            .where(JobCheckin.job_id == job_id)
            .where(JobCheckin.checked_in.is_(True))
            .limit(1)
        )
    )


async def _get_fi_with_log(db: AsyncSession, job_id: int) -> FinalInspection | None:
    """Load the final inspection with its attempt log eagerly (for responses)."""
    result = await db.execute(
        select(FinalInspection)
        .options(selectinload(FinalInspection.attempts_log))
        .where(FinalInspection.job_id == job_id)
    )
    return result.scalar_one_or_none()


async def _next_attempt_number(db: AsyncSession, fi_id: int) -> int:
    existing = await db.scalar(
        select(func.count())
        .select_from(FinalInspectionAttempt)
        .where(FinalInspectionAttempt.final_inspection_id == fi_id)
    )
    return (existing or 0) + 1


async def _set_status(db: AsyncSession, job: Job, new_status: str, user: User) -> None:
    if job.status != new_status:
        old = job.status
        job.status = new_status
        await log_event(
            db, job.id, "status_change", f"Status changed: {old} → {new_status}", user
        )


@router.post(
    "/jobs/{job_id}/final-inspection",
    response_model=FinalInspectionOut,
    status_code=201,
)
async def release_final_inspection(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_staff),
):
    """Release the final inspection for client completion (idempotent).

    Creates the final-inspection record if needed and moves the job into the
    Inspection stage so the assigned client can fill it in. If the inspection
    was previously failed, this re-opens it for re-inspection (clears the
    failed result while keeping the last reason on record for context).
    """
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    fi = await _get_fi(db, job_id)

    if not fi:
        # First release — only allowed once the QR check-in is done.
        if not await _is_checked_in(db, job_id):
            raise HTTPException(
                status_code=409,
                detail="Scan the QR code to check the job in before releasing "
                "the final inspection.",
            )
        fi = FinalInspection(job_id=job_id, requested_by_id=user.id)
        db.add(fi)
        await log_event(db, job_id, "final_inspection", "Final inspection released", user)
        await _set_status(db, job, INSPECTION_STATUS, user)
    elif fi.completed:
        # Already passed — nothing to release.
        return await _get_fi_with_log(db, job_id)
    elif fi.result == "failed":
        # Re-inspection: reopen the form, keep failure_reason for reference.
        fi.result = None
        await log_event(
            db,
            job_id,
            "final_inspection",
            f"Sent for re-inspection (attempt {fi.attempts + 1})",
            user,
        )
        await _set_status(db, job, INSPECTION_STATUS, user)
    else:
        # Already released and pending — just make sure the stage is right.
        await _set_status(db, job, INSPECTION_STATUS, user)

    await db.commit()
    return await _get_fi_with_log(db, job_id)


@router.get("/final-inspection/pending", response_model=list[PendingInspectionItem])
async def pending_final_inspections(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Final inspections released and awaiting the current user's sign-off.

    Drives the client login banner. A job appears here once staff release the
    final inspection (or send a re-inspection) and disappears once the client
    passes it (completed) or fails it (result == "failed", i.e. back with the
    workshop). Clients only see jobs they're assigned to.
    """
    query = (
        select(Job, FinalInspection)
        .join(FinalInspection, FinalInspection.job_id == Job.id)
        .where(FinalInspection.completed.is_(False))
        .where(FinalInspection.result.is_(None))
        .order_by(Job.sequence.desc())
    )
    if user.role == UserRole.client.value:
        allowed = await get_client_job_ids(db, user.id)
        if not allowed:
            return []
        query = query.where(Job.id.in_(allowed))

    rows = (await db.execute(query)).all()
    return [
        PendingInspectionItem(
            job_id=job.id,
            job_number=job.job_number,
            customer_name=job.customer_name,
            attempts=fi.attempts,
            is_reinspection=fi.attempts > 0,
        )
        for job, fi in rows
    ]


@router.get("/jobs/{job_id}/final-inspection", response_model=FinalInspectionOut | None)
async def get_final_inspection(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    await assert_can_view(db, job, user)
    return await _get_fi_with_log(db, job_id)


@router.put("/jobs/{job_id}/final-inspection", response_model=FinalInspectionOut)
async def submit_final_inspection(
    job_id: int,
    payload: FinalInspectionSubmit,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Pass the final inspection (assigned client, or staff). Moves to Completed."""
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    await assert_can_view(db, job, user)

    fi = await _get_fi(db, job_id)
    if not fi:
        raise HTTPException(
            status_code=404, detail="Final inspection is not available yet"
        )
    if fi.completed:
        raise HTTPException(
            status_code=409, detail="This final inspection has already been submitted"
        )
    if fi.result == "failed":
        raise HTTPException(
            status_code=409,
            detail="This inspection was failed — the workshop must send it for "
            "re-inspection before it can be passed.",
        )

    name = (payload.inspector_name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Inspector name is required")
    reference = (payload.internal_reference or "").strip() or None

    fi.inspector_name = name
    fi.internal_reference = reference
    fi.result = "passed"
    fi.completed = True
    fi.completed_by_id = user.id
    fi.completed_at = datetime.now(timezone.utc)

    attempt_no = await _next_attempt_number(db, fi.id)
    db.add(
        FinalInspectionAttempt(
            job_id=job_id,
            final_inspection_id=fi.id,
            attempt_number=attempt_no,
            result="passed",
            inspector_name=name,
            internal_reference=reference,
            created_by_id=user.id,
        )
    )

    await log_event(
        db, job_id, "final_inspection", f"Final inspection passed by {name}", user
    )
    await _set_status(db, job, COMPLETED_STATUS, user)

    await db.commit()
    return await _get_fi_with_log(db, job_id)


@router.post("/jobs/{job_id}/final-inspection/fail", response_model=FinalInspectionOut)
async def fail_final_inspection(
    job_id: int,
    payload: FinalInspectionFail,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Fail the final inspection with a reason (assigned client, or staff).

    Moves the job to the "Inspection Failed" stage and records why. The reason
    is saved as a numbered note (1st/2nd/… failure) and to the attempt log; the
    review stays locked until a later attempt passes.
    """
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    await assert_can_view(db, job, user)

    fi = await _get_fi(db, job_id)
    if not fi:
        raise HTTPException(
            status_code=404, detail="Final inspection is not available yet"
        )
    if fi.completed:
        raise HTTPException(
            status_code=409,
            detail="This final inspection has already passed and can't be failed.",
        )
    if fi.result == "failed":
        raise HTTPException(
            status_code=409,
            detail="This inspection is already marked failed and is awaiting "
            "re-inspection.",
        )

    name = (payload.inspector_name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Inspector name is required")
    reason = (payload.reason or "").strip()
    if not reason:
        raise HTTPException(
            status_code=400, detail="A reason is required to fail the inspection"
        )

    fi.inspector_name = name
    fi.result = "failed"
    fi.failure_reason = reason
    fi.attempts += 1
    fi.failed_by_id = user.id
    fi.failed_at = datetime.now(timezone.utc)

    ordinal = _ordinal(fi.attempts)  # 1st / 2nd / 3rd failure

    attempt_no = await _next_attempt_number(db, fi.id)
    db.add(
        FinalInspectionAttempt(
            job_id=job_id,
            final_inspection_id=fi.id,
            attempt_number=attempt_no,
            result="failed",
            inspector_name=name,
            reason=reason,
            created_by_id=user.id,
        )
    )

    # Persist the reason as a numbered note so the order is clear in the notes,
    # and log it to the timeline.
    db.add(
        Note(
            job_id=job_id,
            note_type="action",
            body=f"Final inspection failed ({ordinal} attempt) by {name}: {reason}",
            author_id=user.id,
            author_name=actor_name(user),
        )
    )
    await log_event(
        db,
        job_id,
        "final_inspection",
        f"Final inspection failed ({ordinal} attempt) by {name}: {reason}",
        user,
    )
    await _set_status(db, job, FAILED_STATUS, user)

    await db.commit()
    return await _get_fi_with_log(db, job_id)
