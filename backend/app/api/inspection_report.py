"""QR-driven Everton inspection reports.

Flow (mirrors the QR check-in pattern in ``checkin.py``)
-------------------------------------------------------
1. An admin/staff picks a job and generates a report — this allocates a unique
   token and a sequential certificate number (e.g. ``ECE 260001``).
2. The token is encoded in a QR pointing at the PUBLIC form URL
   ``{base}/api/inspection-report/{token}``.
3. An employee scans it (or the admin opens it on screen) -> a no-login form
   opens, pre-filled with the job header -> they fill the measurement rows and
   sign-off -> Submit. ONLY on submit is the report recorded.
4. On submit the report is rendered to a PDF, filed straight into that job's
   Documents, written to the job timeline, and the token LOCKED (one-time).
   The job status is intentionally left untouched.
5. To do another report, generate a fresh token for the job.

The public routes are unauthenticated and live under the ``/api`` prefix so
they ride the existing nginx + Cloudflare proxy with no infra change.
"""
import html
import json
import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.checkin import (
    OPERATORS,
    _job_line,
    _options,
    _page,
    public_base_url,
    qr_data_uri,
)
from app.api.deps import require_admin, require_staff
from app.core.config import settings
from app.core.database import get_db
from app.models import Document, InspectionReport, Job, TimelineEvent, User
from app.services import file_service, inspection_report_service
from app.services.settings_service import next_ece_number

router = APIRouter(tags=["inspection-reports"])

YN_OPTIONS = ["Y", "N"]


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%d/%m/%Y")


def report_url(request: Request, token: str) -> str:
    return f"{public_base_url(request)}{settings.API_PREFIX}/inspection-report/{token}"


def _job_header_defaults(job: Job, cert: str) -> dict:
    """Pre-fill the report header from the job."""
    return {
        "certificate_number": cert,
        "date": _today(),
        "customer": job.customer_name or "",
        "job_no": job.job_number or "",
        "job_desc": (job.description or job.component_type or "")[:255],
        "drawing_number": "",
        "qcp_no": "",
        "quantity": "",
        "eve_job": job.eq_number or "",
    }


def _serialize(report: InspectionReport, job: Job | None) -> dict:
    return {
        "id": report.id,
        "job_id": report.job_id,
        "job_number": job.job_number if job else None,
        "customer_name": job.customer_name if job else None,
        "token": report.token,
        "certificate_number": report.certificate_number,
        "submitted": report.submitted,
        "inspector_name": report.inspector_name,
        "qcp_pass": report.qcp_pass,
        "qc_reject": report.qc_reject,
        "rework": report.rework,
        "document_id": report.document_id,
        "submitted_at": report.submitted_at.isoformat() if report.submitted_at else None,
        "created_at": report.created_at.isoformat() if report.created_at else None,
    }


# --------------------------- authed: list / generate ---------------------------
@router.get("/inspection-reports")
async def list_reports(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_staff),
):
    rows = (
        await db.execute(
            select(InspectionReport)
            .options(selectinload(InspectionReport.job))
            .order_by(InspectionReport.created_at.desc())
            .limit(200)
        )
    ).scalars().all()
    return [_serialize(r, r.job) for r in rows]


@router.post("/inspection-reports/generate", status_code=201)
async def generate_report(
    request: Request,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_staff),
):
    job_id = body.get("job_id")
    if not job_id:
        raise HTTPException(status_code=400, detail="job_id is required")
    job = await db.get(Job, int(job_id))
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    cert, seq = await next_ece_number(db)
    for _ in range(5):
        token = secrets.token_urlsafe(12)
        if not await db.scalar(
            select(InspectionReport.id).where(InspectionReport.token == token)
        ):
            break
    else:
        raise HTTPException(status_code=500, detail="Could not allocate report token")

    report = InspectionReport(
        job_id=job.id,
        token=token,
        certificate_number=cert,
        sequence=seq,
        created_by_id=user.id,
    )
    db.add(report)
    db.add(
        TimelineEvent(
            job_id=job.id,
            event_type="inspection_report",
            description=f"Inspection report {cert} QR generated",
            actor_name=user.full_name or user.username,
        )
    )
    await db.commit()
    await db.refresh(report)

    url = report_url(request, token)
    qr_png = await run_in_threadpool(qr_data_uri, url)
    data = _serialize(report, job)
    data.update({"url": url, "qr_png": qr_png})
    return data


@router.get("/inspection-reports/blank.pdf")
async def blank_report_pdf(_: User = Depends(require_staff)):
    pdf = await run_in_threadpool(inspection_report_service.render_blank_pdf, "")
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": 'inline; filename="Inspection Report (blank).pdf"'
        },
    )


@router.get("/inspection-reports/{report_id}")
async def report_status(
    report_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_staff),
):
    report = await db.get(InspectionReport, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    job = await db.get(Job, report.job_id)
    url = report_url(request, report.token)
    qr_png = await run_in_threadpool(qr_data_uri, url)
    data = _serialize(report, job)
    data.update({"url": url, "qr_png": qr_png})
    return data


@router.delete("/inspection-reports/{report_id}", status_code=204)
async def delete_report(
    report_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    report = await db.get(InspectionReport, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    if report.submitted:
        raise HTTPException(
            status_code=409,
            detail="This report has been submitted and filed; delete the document on the job instead.",
        )
    await db.delete(report)
    await db.commit()


# ----------------------------- public form (no auth) -----------------------------
def _field(label: str, name: str, value: str = "", *, ph: str = "", readonly: bool = False) -> str:
    ro = " readonly" if readonly else ""
    return (
        f'<label for="{name}">{html.escape(label)}</label>'
        f'<input type="text" id="{name}" name="{name}" value="{html.escape(value)}" '
        f'placeholder="{html.escape(ph)}"{ro}/>'
    )


def _select(label: str, name: str, values: list[str], placeholder: str) -> str:
    return (
        f'<label for="{name}">{html.escape(label)}</label>'
        f'<select id="{name}" name="{name}">{_options(values, placeholder)}</select>'
    )


def _form_page(token: str, job: Job, h: dict) -> str:
    body = f"""
    <h1>Inspection report</h1>
    <p class="sub">Complete and submit — it files straight to the job's documents.</p>
    <div class="meta">{_job_line(job)} · <b>{html.escape(h['certificate_number'])}</b></div>

    <form method="post" action="{settings.API_PREFIX}/inspection-report/{html.escape(token)}" onsubmit="return packRows()">
      <div class="sec">Header</div>
      {_field("Certificate number", "certificate_number", h['certificate_number'], readonly=True)}
      {_field("Date", "date", h['date'])}
      {_field("Customer", "customer", h['customer'])}
      {_field("Job no", "job_no", h['job_no'])}
      {_field("Job description", "job_desc", h['job_desc'])}
      {_field("Drawing number", "drawing_number", h['drawing_number'], ph="e.g. DRG-7781-A")}
      {_field("QCP no", "qcp_no", h['qcp_no'])}
      {_field("Quantity", "quantity", h['quantity'])}
      {_field("EVE job", "eve_job", h['eve_job'])}

      <div class="sec">Measurements</div>
      <div id="rows"></div>
      <button type="button" class="addbtn" onclick="addRow()">+ Add line</button>
      <input type="hidden" name="items_json" id="items_json"/>

      <div class="sec">Result</div>
      {_select("QCP-PASS", "qcp_pass", YN_OPTIONS, "Y / N…")}
      {_select("QC-REJECT", "qc_reject", YN_OPTIONS, "Y / N…")}
      {_select("REWORK", "rework", YN_OPTIONS, "Y / N…")}

      <div class="sec">Sign-off</div>
      {_select("Inspector (Everton)", "inspector_name", OPERATORS, "Select inspector…")}
      {_field("Customer name (optional)", "customer_signed_name", "")}

      <button type="submit">Submit &amp; file to job</button>
    </form>

    <template id="rowtpl">
      <div class="row">
        <div class="rowhead"><span class="rownum"></span><button type="button" class="rm" onclick="rmRow(this)">&times;</button></div>
        <input type="text" data-k="description" placeholder="Description"/>
        <div class="two">
          <input type="text" data-k="tol1" placeholder="Drawing size tol (1)"/>
          <input type="text" data-k="tol2" placeholder="Drawing size tol (2)"/>
        </div>
        <div class="two">
          <input type="text" data-k="req" placeholder="Actual — REQ"/>
          <input type="text" data-k="act" placeholder="Actual — ACT"/>
        </div>
        <div class="two">
          <input type="text" data-k="finished" placeholder="Finished"/>
          <select data-k="accept">
            <option value="" disabled selected>Accept…</option>
            <option value="Y">Accept — YES</option>
            <option value="N">Accept — NO</option>
          </select>
        </div>
      </div>
    </template>

    <script>
      var rowsEl = document.getElementById('rows');
      var tpl = document.getElementById('rowtpl');
      function renumber() {{
        var rs = rowsEl.querySelectorAll('.row');
        rs.forEach(function(r,i){{ r.querySelector('.rownum').textContent = 'Line ' + (i+1); }});
      }}
      function addRow() {{
        var node = tpl.content.cloneNode(true);
        rowsEl.appendChild(node);
        renumber();
      }}
      function rmRow(btn) {{
        var row = btn.closest('.row');
        if (rowsEl.querySelectorAll('.row').length > 1) {{ row.remove(); renumber(); }}
      }}
      function packRows() {{
        var out = [];
        rowsEl.querySelectorAll('.row').forEach(function(r){{
          var o = {{}}, any = false;
          r.querySelectorAll('[data-k]').forEach(function(el){{
            o[el.getAttribute('data-k')] = el.value || '';
            if (el.value) any = true;
          }});
          if (any) out.push(o);
        }});
        document.getElementById('items_json').value = JSON.stringify(out);
        return true;
      }}
      addRow();
    </script>"""
    return _page("Inspection report", body)


_EXTRA_CSS = """
<style>
  .sec {{ font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:12px;
    letter-spacing:.6px; text-transform:uppercase; color:#14b8a6;
    margin:22px 0 12px; padding-bottom:6px; border-bottom:1px solid #262b35; }}
  .row {{ background:#0f1115; border:1px solid #262b35; border-radius:12px;
    padding:12px; margin-bottom:12px; }}
  .rowhead {{ display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }}
  .rownum {{ font-size:12px; font-weight:600; color:#9aa3b2; }}
  .rm {{ width:auto; background:transparent; color:#f43f5e; font-size:20px; line-height:1;
    border:none; padding:0 6px; cursor:pointer; }}
  .row input, .row select {{ margin-bottom:8px !important; }}
  .two {{ display:flex; gap:8px; }}
  .two > * {{ flex:1; min-width:0; }}
  .addbtn {{ background:transparent; color:#14b8a6; border:1px dashed #2d8c80;
    font-weight:600; margin-bottom:4px; }}
</style>
"""


@router.get("/inspection-report/{token}", response_class=HTMLResponse)
async def report_form(token: str, db: AsyncSession = Depends(get_db)):
    report = (
        await db.execute(
            select(InspectionReport).where(InspectionReport.token == token)
        )
    ).scalar_one_or_none()
    if not report:
        return HTMLResponse(
            _page(
                "Invalid code",
                '<div class="ok err"><div class="tick">!</div>'
                "<h1>Invalid QR code</h1>"
                '<p class="detail">This inspection-report link is not recognised.</p></div>',
                accent="#f59e0b",
            ),
            status_code=404,
        )
    job = await db.get(Job, report.job_id)
    if not job:
        return HTMLResponse(
            _page(
                "Job not found",
                '<div class="ok err"><div class="tick">!</div><h1>Job not found</h1></div>',
                accent="#f59e0b",
            ),
            status_code=404,
        )
    if report.submitted:
        return HTMLResponse(_already_page(job, report))

    h = _job_header_defaults(job, report.certificate_number)
    page = _form_page(token, job, h)
    # Inject the extra CSS just before </head>.
    page = page.replace("</style>\n</head>", "</style>" + _EXTRA_CSS + "</head>", 1)
    return HTMLResponse(page)


def _already_page(job: Job, report: InspectionReport) -> str:
    when = ""
    if report.submitted_at:
        when = report.submitted_at.astimezone().strftime("%d %b %Y, %H:%M")
    body = f"""
    <div class="ok err">
      <div class="tick">!</div>
      <h1>Already submitted</h1>
      <p class="detail">
        <b>{html.escape(report.certificate_number)}</b> was completed by
        <b>{html.escape(report.inspector_name or '—')}</b><br/>{html.escape(when)}<br/>
        It has been filed to the job's documents.
      </p>
      <p class="sub" style="margin-top:18px">{_job_line(job)}</p>
    </div>"""
    return _page("Already submitted", body, accent="#f59e0b")


@router.post("/inspection-report/{token}", response_class=HTMLResponse)
async def report_submit(
    token: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    report = (
        await db.execute(
            select(InspectionReport).where(InspectionReport.token == token)
        )
    ).scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Invalid report code")
    job = await db.get(Job, report.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if report.submitted:
        return HTMLResponse(_already_page(job, report))

    form = await request.form()

    def g(key: str) -> str:
        return (form.get(key) or "").strip()

    try:
        items = json.loads(form.get("items_json") or "[]")
        if not isinstance(items, list):
            items = []
    except (ValueError, TypeError):
        items = []

    inspector = g("inspector_name")
    if not inspector:
        body = f"""
        <div class="ok err"><div class="tick">!</div>
          <h1>Missing inspector</h1>
          <p class="detail">Please select the inspector before submitting.</p>
          <p style="margin-top:18px"><a href="{settings.API_PREFIX}/inspection-report/{html.escape(token)}"
             style="color:#14b8a6">Go back</a></p>
        </div>"""
        return HTMLResponse(_page("Missing details", body, accent="#f59e0b"), status_code=400)

    header = {
        "certificate_number": report.certificate_number,
        "date": g("date") or _today(),
        "customer": g("customer"),
        "job_no": g("job_no"),
        "job_desc": g("job_desc"),
        "drawing_number": g("drawing_number"),
        "qcp_no": g("qcp_no"),
        "quantity": g("quantity"),
        "eve_job": g("eve_job"),
    }
    signoff = {
        "qcp_pass": g("qcp_pass"),
        "qc_reject": g("qc_reject"),
        "rework": g("rework"),
        "inspector_name": inspector,
        "date": header["date"],
        "customer_signed_name": g("customer_signed_name"),
        "customer_date": "",
    }
    report_data = {"header": header, "items": items, "signoff": signoff}

    # Render the PDF and file it as a job document.
    pdf = await run_in_threadpool(inspection_report_service.render_report_pdf, report_data)
    stored = f"job{job.id}_{uuid.uuid4().hex}.pdf"
    dest = file_service.file_path(stored)
    file_service.UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
    with open(dest, "wb") as fh:
        fh.write(pdf)

    original = f"Inspection Report {report.certificate_number}.pdf"
    doc = Document(
        job_id=job.id,
        filename=stored,
        original_name=original,
        content_type="application/pdf",
        uploaded_by_id=report.created_by_id,
    )
    db.add(doc)
    await db.flush()  # get doc.id

    now = datetime.now(timezone.utc)
    fwd = request.headers.get("x-forwarded-for", "")
    ip = (fwd.split(",")[0].strip() if fwd else None) or (
        request.client.host if request.client else None
    )

    report.submitted = True
    report.inspector_name = inspector
    report.customer_signed_name = signoff["customer_signed_name"] or None
    report.qcp_pass = signoff["qcp_pass"] or None
    report.qc_reject = signoff["qc_reject"] or None
    report.rework = signoff["rework"] or None
    report.payload = json.dumps(report_data)
    report.scanner_ip = ip
    report.submitted_at = now
    report.document_id = doc.id

    db.add(
        TimelineEvent(
            job_id=job.id,
            event_type="inspection_report",
            description=f"Inspection report {report.certificate_number} completed and filed to documents",
            actor_name=inspector,
        )
    )
    await db.commit()

    when = now.astimezone().strftime("%d %b %Y, %H:%M")
    body = f"""
    <div class="ok">
      <div class="tick">&#10003;</div>
      <h1>Report filed</h1>
      <p class="detail">
        <b>{html.escape(report.certificate_number)}</b> by <b>{html.escape(inspector)}</b><br/>
        {html.escape(when)}<br/>
        Saved to this job's documents.
      </p>
      <p class="sub" style="margin-top:18px">{_job_line(job)}</p>
    </div>"""
    return HTMLResponse(_page("Report filed", body))
