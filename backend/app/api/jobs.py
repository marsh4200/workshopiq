"""Job lifecycle endpoints: jobs, notes, photos, documents, inspections."""
import secrets

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user, require_admin, require_staff
from app.core.database import get_db
from app.models import (
    ClientJobAccess,
    Document,
    FinalInspection,
    Inspection,
    InspectionItem,
    InspectionTemplate,
    Job,
    JobCheckin,
    Note,
    Photo,
    TimelineEvent,
    User,
    UserRole,
)
from app.schemas import (
    AssignClientsRequest,
    InspectionCreate,
    InspectionOut,
    InspectionUpdate,
    JobCreate,
    JobDetailOut,
    JobListOut,
    JobUpdate,
    NoteCreate,
    NoteOut,
    PhotoOut,
)
from app.services import file_service
from app.services.settings_service import next_job_number
from app.services.templates_data import JOB_STATUSES

router = APIRouter(prefix="/jobs", tags=["jobs"])


def actor_name(user: User) -> str:
    return user.full_name or user.username


async def log_event(
    db: AsyncSession, job_id: int, event_type: str, description: str, user: User
) -> None:
    db.add(
        TimelineEvent(
            job_id=job_id,
            event_type=event_type,
            description=description,
            actor_name=actor_name(user),
        )
    )


async def get_client_job_ids(db: AsyncSession, user_id: int) -> set[int]:
    result = await db.execute(
        select(ClientJobAccess.job_id).where(ClientJobAccess.user_id == user_id)
    )
    return set(result.scalars().all())


async def assert_can_view(db: AsyncSession, job: Job, user: User) -> None:
    if user.role == UserRole.client.value:
        allowed = await get_client_job_ids(db, user.id)
        if job.id not in allowed:
            raise HTTPException(status_code=403, detail="Access denied")


async def load_job_detail(db: AsyncSession, job_id: int) -> Job | None:
    result = await db.execute(
        select(Job)
        .options(
            selectinload(Job.photos),
            selectinload(Job.documents),
            selectinload(Job.notes),
            selectinload(Job.timeline),
            selectinload(Job.inspections).selectinload(Inspection.items),
            selectinload(Job.client_access),
            selectinload(Job.final_inspection).selectinload(
                FinalInspection.attempts_log
            ),
            selectinload(Job.checkins),
        )
        .where(Job.id == job_id)
    )
    return result.scalar_one_or_none()


def serialize_detail(job: Job) -> JobDetailOut:
    data = JobDetailOut.model_validate(job)
    data.notes = sorted(job.notes, key=lambda n: n.created_at, reverse=True)
    data.timeline = sorted(job.timeline, key=lambda t: t.created_at, reverse=True)
    data.client_user_ids = [a.user_id for a in job.client_access]
    data.checked_in = any(c.checked_in for c in job.checkins)
    return data


# ---------------- Jobs ----------------
@router.get("", response_model=list[JobListOut])
async def list_jobs(
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = select(Job).order_by(Job.sequence.desc())
    if user.role == UserRole.client.value:
        allowed = await get_client_job_ids(db, user.id)
        if not allowed:
            return []
        query = query.where(Job.id.in_(allowed))
    if status:
        query = query.where(Job.status == status)
    result = await db.execute(query)
    return result.scalars().all()


@router.post("", response_model=JobDetailOut, status_code=201)
async def create_job(
    payload: JobCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_staff),
):
    job_number, sequence = await next_job_number(db)
    job = Job(
        job_number=job_number,
        sequence=sequence,
        customer_name=payload.customer_name,
        contact_person=payload.contact_person,
        phone=payload.phone,
        email=payload.email,
        po_number=payload.po_number,
        description=payload.description,
        component_type=payload.component_type,
        status="Received",
        created_by_id=user.id,
    )
    if payload.date_received:
        job.date_received = payload.date_received
    db.add(job)
    await db.flush()
    db.add(JobCheckin(job_id=job.id, token=secrets.token_urlsafe(12)))
    await log_event(db, job.id, "created", f"Job {job_number} created", user)

    # Optionally grant client access at intake. Any staff member (not only
    # administrators) may set client access, mirroring the dedicated
    # assign-clients endpoint.
    if payload.client_user_ids:
        added = 0
        for uid in dict.fromkeys(payload.client_user_ids):
            client = await db.get(User, uid)
            if client and client.role == UserRole.client.value:
                db.add(ClientJobAccess(user_id=uid, job_id=job.id))
                added += 1
        if added:
            await log_event(
                db, job.id, "access", f"Client access granted to {added} user(s)", user
            )

    await db.commit()
    detail = await load_job_detail(db, job.id)
    return serialize_detail(detail)


@router.get("/{job_id}", response_model=JobDetailOut)
async def get_job(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    job = await load_job_detail(db, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    await assert_can_view(db, job, user)
    return serialize_detail(job)


@router.put("/{job_id}", response_model=JobDetailOut)
async def update_job(
    job_id: int,
    payload: JobUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_staff),
):
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if payload.status and payload.status != job.status:
        if payload.status not in JOB_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid status")
        old = job.status
        job.status = payload.status
        await log_event(
            db, job.id, "status_change", f"Status changed: {old} → {payload.status}", user
        )

    for field in (
        "customer_name",
        "contact_person",
        "phone",
        "email",
        "po_number",
        "description",
        "component_type",
    ):
        value = getattr(payload, field)
        if value is not None:
            setattr(job, field, value)

    await db.commit()
    detail = await load_job_detail(db, job_id)
    return serialize_detail(detail)


@router.delete("/{job_id}", status_code=204)
async def delete_job(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    job = await load_job_detail(db, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    for photo in job.photos:
        file_service.delete_file(photo.filename)
    for doc in job.documents:
        file_service.delete_file(doc.filename)
    await db.delete(job)
    await db.commit()


@router.put("/{job_id}/clients", response_model=JobDetailOut)
async def assign_clients(
    job_id: int,
    payload: AssignClientsRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_staff),
):
    job = await load_job_detail(db, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    for access in list(job.client_access):
        await db.delete(access)
    await db.flush()
    for uid in payload.user_ids:
        client = await db.get(User, uid)
        if client and client.role == UserRole.client.value:
            db.add(ClientJobAccess(user_id=uid, job_id=job_id))
    await log_event(db, job_id, "access", "Client access updated", user)
    await db.commit()
    detail = await load_job_detail(db, job_id)
    return serialize_detail(detail)


# ---------------- Notes ----------------
@router.post("/{job_id}/notes", response_model=NoteOut, status_code=201)
async def add_note(
    job_id: int,
    payload: NoteCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    # Clients may leave notes, but only on jobs they're assigned to.
    await assert_can_view(db, job, user)

    note_type = payload.note_type
    if user.role == UserRole.client.value:
        # Clients post customer-facing notes only — never internal/staff types.
        if note_type not in {"customer", "query"}:
            note_type = "customer"

    note = Note(
        job_id=job_id,
        note_type=note_type,
        body=payload.body,
        author_id=user.id,
        author_name=actor_name(user),
    )
    db.add(note)
    await log_event(db, job_id, "note", f"{note_type.title()} note added", user)
    await db.commit()
    await db.refresh(note)
    return note


# ---------------- Photos ----------------
@router.post("/{job_id}/photos", response_model=list[PhotoOut], status_code=201)
async def upload_photos(
    job_id: int,
    files: list[UploadFile] = File(...),
    category: str = Form("general"),
    caption: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    # Anyone who can view the job may add photos: administrators, staff, and
    # clients assigned to this job. Photos are visible to everyone with view
    # access (see serve_file / assert_can_view), so a client's upload shows up
    # for staff and vice versa.
    await assert_can_view(db, job, user)
    saved: list[Photo] = []
    for upload in files:
        try:
            stored, original = await file_service.save_upload(upload, job_id)
        except ValueError as exc:
            raise HTTPException(status_code=413, detail=str(exc))
        photo = Photo(
            job_id=job_id,
            filename=stored,
            original_name=original,
            category=category if category in {"before", "after", "general"} else "general",
            caption=caption,
            uploaded_by_id=user.id,
        )
        db.add(photo)
        saved.append(photo)
    await log_event(db, job_id, "photo", f"{len(saved)} photo(s) uploaded", user)
    await db.commit()
    for p in saved:
        await db.refresh(p)
    return saved


@router.delete("/{job_id}/photos/{photo_id}", status_code=204)
async def delete_photo(
    job_id: int,
    photo_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_staff),
):
    photo = await db.get(Photo, photo_id)
    if not photo or photo.job_id != job_id:
        raise HTTPException(status_code=404, detail="Photo not found")
    file_service.delete_file(photo.filename)
    await db.delete(photo)
    await db.commit()


# ---------------- Documents ----------------
@router.post("/{job_id}/documents", status_code=201)
async def upload_documents(
    job_id: int,
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_staff),
):
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    for upload in files:
        try:
            stored, original = await file_service.save_upload(upload, job_id)
        except ValueError as exc:
            raise HTTPException(status_code=413, detail=str(exc))
        db.add(
            Document(
                job_id=job_id,
                filename=stored,
                original_name=original,
                content_type=upload.content_type,
                uploaded_by_id=user.id,
            )
        )
    await log_event(db, job_id, "document", "Document(s) uploaded", user)
    await db.commit()
    return {"status": "ok"}


@router.delete("/{job_id}/documents/{doc_id}", status_code=204)
async def delete_document(
    job_id: int,
    doc_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_staff),
):
    doc = await db.get(Document, doc_id)
    if not doc or doc.job_id != job_id:
        raise HTTPException(status_code=404, detail="Document not found")
    file_service.delete_file(doc.filename)
    await db.delete(doc)
    await db.commit()


# ---------------- File serving ----------------
@router.get("/{job_id}/files/{filename}")
async def serve_file(
    job_id: int,
    filename: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    await assert_can_view(db, job, user)
    path = file_service.file_path(filename)
    if not path.exists() or not filename.startswith(f"job{job_id}_"):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path)


# ---------------- Inspections ----------------
@router.post("/{job_id}/inspections", response_model=InspectionOut, status_code=201)
async def create_inspection(
    job_id: int,
    payload: InspectionCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_staff),
):
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    inspection = Inspection(
        job_id=job_id,
        component_type=payload.component_type,
        title=payload.title or f"{payload.component_type} Inspection",
        inspector_id=user.id,
        inspector_name=actor_name(user),
    )
    db.add(inspection)
    await db.flush()

    # Load checklist from template
    result = await db.execute(
        select(InspectionTemplate)
        .options(selectinload(InspectionTemplate.items))
        .where(InspectionTemplate.component_type == payload.component_type)
    )
    template = result.scalar_one_or_none()
    if template:
        for item in template.items:
            db.add(
                InspectionItem(
                    inspection_id=inspection.id,
                    label=item.label,
                    order_index=item.order_index,
                )
            )
    await log_event(
        db, job_id, "inspection", f"{payload.component_type} inspection started", user
    )
    await db.commit()
    result = await db.execute(
        select(Inspection)
        .options(selectinload(Inspection.items))
        .where(Inspection.id == inspection.id)
    )
    return result.scalar_one()


@router.put(
    "/{job_id}/inspections/{inspection_id}", response_model=InspectionOut
)
async def update_inspection(
    job_id: int,
    inspection_id: int,
    payload: InspectionUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_staff),
):
    result = await db.execute(
        select(Inspection)
        .options(selectinload(Inspection.items))
        .where(Inspection.id == inspection_id, Inspection.job_id == job_id)
    )
    inspection = result.scalar_one_or_none()
    if not inspection:
        raise HTTPException(status_code=404, detail="Inspection not found")

    if payload.title is not None:
        inspection.title = payload.title
    if payload.completed is not None:
        inspection.completed = payload.completed
    if payload.items:
        by_id = {i.id: i for i in inspection.items}
        for upd in payload.items:
            item = by_id.get(upd.id)
            if item:
                if upd.result is not None:
                    item.result = upd.result
                if upd.notes is not None:
                    item.notes = upd.notes
    await db.commit()
    result = await db.execute(
        select(Inspection)
        .options(selectinload(Inspection.items))
        .where(Inspection.id == inspection_id)
    )
    return result.scalar_one()


@router.delete("/{job_id}/inspections/{inspection_id}", status_code=204)
async def delete_inspection(
    job_id: int,
    inspection_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_staff),
):
    result = await db.execute(
        select(Inspection).where(
            Inspection.id == inspection_id, Inspection.job_id == job_id
        )
    )
    inspection = result.scalar_one_or_none()
    if not inspection:
        raise HTTPException(status_code=404, detail="Inspection not found")
    await db.delete(inspection)
    await db.commit()
