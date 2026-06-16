"""Dashboard statistics endpoint."""
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models import ClientJobAccess, Job, TimelineEvent, User, UserRole
from app.schemas import DashboardStats, RecentActivityOut
from app.services.templates_data import JOB_STATUSES

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("", response_model=DashboardStats)
async def dashboard(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    job_filter = []
    allowed_ids: set[int] | None = None
    if user.role == UserRole.client.value:
        result = await db.execute(
            select(ClientJobAccess.job_id).where(ClientJobAccess.user_id == user.id)
        )
        allowed_ids = set(result.scalars().all())
        job_filter = [Job.id.in_(allowed_ids or {-1})]

    rows = await db.execute(
        select(Job.status, func.count()).where(*job_filter).group_by(Job.status)
    )
    counts = {status: count for status, count in rows.all()}

    status_breakdown = {s: counts.get(s, 0) for s in JOB_STATUSES}
    total = sum(counts.values())
    received = counts.get("Received", 0)
    machining = counts.get("Machining", 0)
    completed = counts.get("Completed", 0)
    closed = counts.get("Closed", 0)

    activity_query = (
        select(TimelineEvent)
        .options(selectinload(TimelineEvent.job))
        .order_by(TimelineEvent.created_at.desc())
        .limit(12)
    )
    if allowed_ids is not None:
        activity_query = activity_query.where(
            TimelineEvent.job_id.in_(allowed_ids or {-1})
        )
    activity_rows = await db.execute(activity_query)
    recent = [
        RecentActivityOut(
            id=e.id,
            event_type=e.event_type,
            description=e.description,
            actor_name=e.actor_name,
            created_at=e.created_at,
            job_id=e.job_id,
            job_number=e.job.job_number if e.job else None,
            customer_name=e.job.customer_name if e.job else None,
        )
        for e in activity_rows.scalars().all()
    ]

    return DashboardStats(
        received=received,
        machining=machining,
        completed=completed,
        closed=closed,
        total=total,
        status_breakdown=status_breakdown,
        recent_activity=recent,
    )
