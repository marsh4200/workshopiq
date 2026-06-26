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
# The digital fill-in form is a faithful white "paper" replica of the Everton
# inspection sheet — same logo banner, title bar, header grid, measurement
# table and sign-off block — with the cells turned into inputs. It is NOT the
# dark WorkshopIQ chrome; it deliberately looks like the printed form.

INITIAL_ROWS = 15  # empty measurement rows shown on load (like the paper sheet)


def _hv(value: str) -> str:
    return html.escape(value or "", quote=True)


def _accept_select() -> str:
    return (
        '<select data-k="accept" class="acc">'
        '<option value=""></option>'
        '<option value="Y">Y</option>'
        '<option value="N">N</option>'
        "</select>"
    )


def _yn_select(name: str, value: str = "") -> str:
    sel_y = " selected" if value.upper() == "Y" else ""
    sel_n = " selected" if value.upper() == "N" else ""
    return (
        f'<select name="{name}" class="yn">'
        f'<option value=""></option>'
        f'<option value="Y"{sel_y}>Y</option>'
        f'<option value="N"{sel_n}>N</option>'
        "</select>"
    )


def _inspector_select(name: str) -> str:
    opts = ['<option value=""></option>']
    opts += [f'<option value="{_hv(v)}">{html.escape(v)}</option>' for v in OPERATORS]
    return f'<select name="{name}" class="cellsel">{"".join(opts)}</select>'


def _meas_row() -> str:
    """One measurement table row (matches the sheet's columns)."""
    return (
        "<tr>"
        '<td><input data-k="description"/></td>'
        '<td><input data-k="tol1"/></td>'
        '<td><input data-k="tol2"/></td>'
        '<td><input data-k="req"/></td>'
        '<td><input data-k="act"/></td>'
        '<td><input data-k="finished"/></td>'
        f"<td>{_accept_select()}</td>"
        "</tr>"
    )


def _form_html(token: str, job: Job, h: dict) -> str:
    action = f"{settings.API_PREFIX}/inspection-report/{html.escape(token)}"
    logo = f"{settings.API_PREFIX}/inspection-report/{html.escape(token)}/logo.png"
    rows = "".join(_meas_row() for _ in range(INITIAL_ROWS))

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>Inspection Report · {_hv(h['certificate_number'])}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Arimo:wght@400;700&display=swap" rel="stylesheet">
<style>
  * {{ box-sizing: border-box; }}
  body {{ margin:0; background:#e9ebee; color:#000;
    font-family:'Arimo','Liberation Sans',Arial,sans-serif; padding:14px 8px 60px; }}
  .sheet {{ max-width:880px; margin:0 auto; background:#fff; padding:14px;
    box-shadow:0 10px 30px rgba(0,0,0,.18); border-radius:4px; }}
  .logo-band {{ border:3px solid #000; padding:10px 8px; text-align:center; }}
  .logo-band img {{ max-width:100%; height:auto; display:block; margin:0 auto; }}
  .title-band {{ background:#d9d9d9; border:1px solid #000; border-top:none;
    text-align:center; font-weight:700; letter-spacing:.5px; padding:7px; font-size:15px; }}
  table {{ border-collapse:collapse; width:100%; }}
  td, th {{ border:1px solid #000; }}
  .grid {{ margin-top:10px; }}
  .grid td {{ padding:0; }}
  .grid .lbl {{ background:#f2f2f2; font-weight:700; font-size:11px; padding:7px 8px;
    white-space:nowrap; width:1%; }}
  .grid input {{ width:100%; border:0; background:transparent; padding:9px 8px;
    font:inherit; font-size:14px; }}
  .grid input:focus {{ outline:none; background:#eef4ff; }}
  .grid input[readonly] {{ background:#f7f7f7; font-weight:700; }}

  .hscroll {{ overflow-x:auto; -webkit-overflow-scrolling:touch; margin-top:12px; }}
  table.meas {{ min-width:760px; }}
  table.meas th {{ background:#d9d9d9; font-size:11px; font-weight:700; padding:5px 4px;
    text-align:center; line-height:1.15; }}
  table.meas td {{ padding:0; }}
  table.meas input, table.meas select {{ width:100%; border:0; background:transparent;
    padding:11px 6px; font:inherit; font-size:14px; }}
  table.meas input:focus, table.meas select:focus {{ outline:none; background:#eef4ff; }}
  table.meas td:first-child input {{ text-align:left; }}
  table.meas input {{ text-align:center; }}
  .acc {{ text-align:center; font-weight:700; }}
  /* column widths */
  .meas col.c-desc {{ width:30%; }}
  .meas col.c-sm {{ width:14%; }}
  .meas col.c-xs {{ width:9%; }}

  .addrow {{ margin-top:8px; }}
  .addrow button {{ background:#fff; border:1px dashed #1f3fae; color:#1f3fae;
    font-weight:700; padding:9px 14px; border-radius:6px; cursor:pointer; font:inherit; font-size:13px; }}

  table.result {{ margin-top:14px; }}
  table.result .lbl {{ background:#f2f2f2; font-weight:700; font-size:11px;
    padding:8px; white-space:nowrap; text-align:center; }}
  table.result td {{ text-align:center; }}
  .yn {{ border:0; background:transparent; padding:9px 6px; font:inherit; font-size:15px;
    font-weight:700; text-align:center; width:100%; }}
  .yn:focus {{ outline:none; background:#eef4ff; }}

  table.sign {{ margin-top:14px; }}
  table.sign th {{ background:#d9d9d9; font-size:12px; padding:7px; }}
  table.sign .lbl {{ background:#f2f2f2; font-weight:700; font-size:11px; padding:8px;
    white-space:nowrap; width:1%; }}
  table.sign input, table.sign select.cellsel {{ width:100%; border:0; background:transparent;
    padding:9px 8px; font:inherit; font-size:14px; }}
  table.sign input:focus, table.sign select.cellsel:focus {{ outline:none; background:#eef4ff; }}
  .sig input {{ font-style:italic; color:#1f3fae; font-size:16px; }}

  .submit-bar {{ max-width:880px; margin:16px auto 0; }}
  .submit-bar button {{ width:100%; padding:15px; border:none; border-radius:8px;
    background:#1f3fae; color:#fff; font-weight:700; font-size:16px; cursor:pointer; font:inherit; }}
  .submit-bar button:active {{ transform:translateY(1px); }}
  .hint {{ max-width:880px; margin:8px auto 0; font-size:12px; color:#555; text-align:center; }}
  .reqd {{ color:#c0392b; }}
</style>
</head>
<body>
<form method="post" action="{action}" onsubmit="return packRows()">
  <div class="sheet">
    <div class="logo-band"><img src="{logo}" alt="Everton Construction &amp; Engineering"/></div>
    <div class="title-band">INSPECTION REPORT</div>

    <table class="grid">
      <tr>
        <td class="lbl">CERTIFICATE NUMBER</td>
        <td><input name="certificate_number" value="{_hv(h['certificate_number'])}" readonly/></td>
        <td class="lbl">DATE</td>
        <td><input name="date" value="{_hv(h['date'])}"/></td>
      </tr>
      <tr>
        <td class="lbl">CUSTOMER</td>
        <td><input name="customer" value="{_hv(h['customer'])}"/></td>
        <td class="lbl">JOB NO</td>
        <td><input name="job_no" value="{_hv(h['job_no'])}"/></td>
      </tr>
      <tr>
        <td class="lbl">JOB DESC</td>
        <td><input name="job_desc" value="{_hv(h['job_desc'])}"/></td>
        <td class="lbl">QCP NO</td>
        <td><input name="qcp_no" value="{_hv(h['qcp_no'])}"/></td>
      </tr>
      <tr>
        <td class="lbl">DRAWING NUMBER</td>
        <td><input name="drawing_number" value="{_hv(h['drawing_number'])}"/></td>
        <td class="lbl">EVE JOB</td>
        <td><input name="eve_job" value="{_hv(h['eve_job'])}"/></td>
      </tr>
      <tr>
        <td class="lbl">QUANTITY</td>
        <td><input name="quantity" value="{_hv(h['quantity'])}"/></td>
        <td class="lbl"></td>
        <td><input disabled/></td>
      </tr>
    </table>

    <div class="hscroll">
      <table class="meas">
        <colgroup>
          <col class="c-desc"/><col class="c-sm"/><col class="c-sm"/>
          <col class="c-xs"/><col class="c-xs"/><col class="c-sm"/><col class="c-xs"/>
        </colgroup>
        <thead>
          <tr>
            <th rowspan="2">DESCRIPTION</th>
            <th>DRAWING</th><th>DRAWING</th>
            <th colspan="2">ACTUAL SIZE</th>
            <th rowspan="2">FINISHED</th>
            <th>ACCEPT</th>
          </tr>
          <tr>
            <th>SIZE TOL (1)</th><th>SIZE TOL (2)</th>
            <th>REQ</th><th>ACT</th>
            <th>YES / NO</th>
          </tr>
        </thead>
        <tbody id="rows">{rows}</tbody>
      </table>
    </div>
    <div class="addrow"><button type="button" onclick="addRow()">+ Add row</button></div>

    <table class="result">
      <tr>
        <td class="lbl">QCP-PASS</td><td>{_yn_select("qcp_pass")}</td>
        <td class="lbl">QC-REJECT</td><td>{_yn_select("qc_reject")}</td>
        <td class="lbl">REWORK</td><td>{_yn_select("rework")}</td>
      </tr>
    </table>

    <table class="sign">
      <tr><th>INSPECTION EVERTON</th><th>CUSTOMER</th></tr>
      <tr>
        <td><table><tr><td class="lbl">NAME <span class="reqd">*</span></td><td>{_inspector_select("inspector_name")}</td></tr></table></td>
        <td><table><tr><td class="lbl">NAME</td><td><input name="customer_signed_name"/></td></tr></table></td>
      </tr>
      <tr>
        <td><table><tr><td class="lbl">DATE</td><td><input name="inspector_date" value="{_hv(h['date'])}"/></td></tr></table></td>
        <td><table><tr><td class="lbl">DATE</td><td><input name="customer_date"/></td></tr></table></td>
      </tr>
      <tr>
        <td class="sig"><table><tr><td class="lbl">SIGNATURE</td><td><input name="inspector_sign" placeholder="Type name"/></td></tr></table></td>
        <td class="sig"><table><tr><td class="lbl">SIGNATURE</td><td><input name="customer_sign" placeholder="Type name"/></td></tr></table></td>
      </tr>
    </table>
  </div>

  <div class="submit-bar"><button type="submit">Submit &amp; file to job</button></div>
  <div class="hint">On submit this files straight to the job's documents.</div>
  <input type="hidden" name="items_json" id="items_json"/>
</form>

<template id="rowtpl">{_meas_row()}</template>
<script>
  var tbody = document.getElementById('rows');
  var tpl = document.getElementById('rowtpl');
  function addRow() {{
    tbody.appendChild(tpl.content.cloneNode(true));
  }}
  function packRows() {{
    var out = [];
    tbody.querySelectorAll('tr').forEach(function(tr){{
      var o = {{}}, any = false;
      tr.querySelectorAll('[data-k]').forEach(function(el){{
        var v = (el.value || '').trim();
        o[el.getAttribute('data-k')] = v;
        if (v) any = true;
      }});
      if (any) out.push(o);
    }});
    document.getElementById('items_json').value = JSON.stringify(out);
    var insp = document.querySelector('[name=inspector_name]');
    if (insp && !insp.value) {{ alert('Please select the inspector (Inspection Everton · NAME).'); insp.focus(); return false; }}
    // Mirror the typed inspector signature from the name if left blank.
    var sign = document.querySelector('[name=inspector_sign]');
    if (sign && !sign.value && insp) {{ sign.value = insp.value; }}
    return true;
  }}
</script>
</body>
</html>"""


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
    return HTMLResponse(_form_html(token, job, h))


@router.get("/inspection-report/{token}/logo.png")
async def report_logo(token: str, db: AsyncSession = Depends(get_db)):
    """Serve the Everton logo for the public form (validated by token)."""
    exists = await db.scalar(
        select(InspectionReport.id).where(InspectionReport.token == token)
    )
    if not exists:
        raise HTTPException(status_code=404, detail="Not found")
    logo = inspection_report_service.LOGO_PATH
    if not logo.exists():
        raise HTTPException(status_code=404, detail="Logo not found")
    return Response(
        content=logo.read_bytes(),
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=86400"},
    )


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
        "date": g("inspector_date") or header["date"],
        "customer_signed_name": g("customer_sign") or g("customer_signed_name"),
        "customer_date": g("customer_date"),
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
