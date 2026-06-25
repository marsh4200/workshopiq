"""Render the Everton inspection report to a PDF that mirrors the paper sheet.

Pure reportlab (platypus) — no headless browser, so it runs on the VPS with no
extra system packages. Two entry points:

* :func:`render_report_pdf` — a filled report (header + measurement rows +
  sign-off) for a submitted inspection. Returns PDF bytes.
* :func:`render_blank_pdf` — a blank printable sheet (the official layout with
  empty measurement rows) for an employee to fill in by hand.

The layout, wording and column structure follow
``Inspection_Report_Everton_new_xl.xlsx`` (Everton Construction & Engineering).
"""
from __future__ import annotations

import io
from datetime import datetime, timezone
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    Image,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

LOGO_PATH = Path(__file__).resolve().parent.parent / "static" / "everton_logo.png"

INK = colors.HexColor("#111111")
GREY = colors.HexColor("#d9d9d9")
LIGHT = colors.HexColor("#f2f2f2")
LINE = colors.HexColor("#000000")
ACCENT = colors.HexColor("#1f3fae")

# Measurement table column widths (portrait A4 usable width ~ 180mm).
COL_WIDTHS = [
    52 * mm,  # DESCRIPTION
    24 * mm,  # DRG SIZE TOL (1)
    24 * mm,  # DRG SIZE TOL (2)
    18 * mm,  # REQ
    18 * mm,  # ACT
    22 * mm,  # FINISHED
    22 * mm,  # ACCEPT
]


def _styles() -> dict[str, ParagraphStyle]:
    return {
        "title": ParagraphStyle(
            "title", fontName="Helvetica-Bold", fontSize=12, leading=14,
            alignment=TA_CENTER, textColor=INK,
        ),
        "label": ParagraphStyle(
            "label", fontName="Helvetica-Bold", fontSize=7.5, leading=9,
            alignment=TA_LEFT, textColor=INK,
        ),
        "value": ParagraphStyle(
            "value", fontName="Helvetica", fontSize=8.5, leading=10,
            alignment=TA_LEFT, textColor=INK,
        ),
        "th": ParagraphStyle(
            "th", fontName="Helvetica-Bold", fontSize=7.5, leading=8.5,
            alignment=TA_CENTER, textColor=INK,
        ),
        "td": ParagraphStyle(
            "td", fontName="Helvetica", fontSize=8, leading=9.5,
            alignment=TA_LEFT, textColor=INK,
        ),
        "tdc": ParagraphStyle(
            "tdc", fontName="Helvetica", fontSize=8, leading=9.5,
            alignment=TA_CENTER, textColor=INK,
        ),
        "sign": ParagraphStyle(
            "sign", fontName="Helvetica-Oblique", fontSize=11, leading=13,
            alignment=TA_LEFT, textColor=ACCENT,
        ),
        "foot": ParagraphStyle(
            "foot", fontName="Helvetica", fontSize=6.5, leading=8,
            alignment=TA_CENTER, textColor=colors.HexColor("#888888"),
        ),
    }


def _logo_band() -> Table:
    """Black-bordered banner with the Everton logo (mirrors the sheet header)."""
    cell = ""
    if LOGO_PATH.exists():
        try:
            img = Image(str(LOGO_PATH))
            ratio = img.imageHeight / float(img.imageWidth or 1)
            img.drawWidth = 150 * mm
            img.drawHeight = 150 * mm * ratio
            cell = img
        except Exception:
            cell = Paragraph(
                "<b>Everton Construction &amp; Engineering</b>", _styles()["title"]
            )
    band = Table([[cell]], colWidths=[180 * mm])
    band.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 2.5, LINE),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return band


def _title_band(st) -> Table:
    t = Table([[Paragraph("INSPECTION REPORT", st["title"])]], colWidths=[180 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), GREY),
        ("BOX", (0, 0), (-1, -1), 0.75, LINE),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


def _kv(label: str, value: str, st) -> list:
    return [Paragraph(label, st["label"]), Paragraph(value or "&nbsp;", st["value"])]


def _header_grid(h: dict, st) -> Table:
    """4-column label/value grid covering every header field on the sheet."""
    rows = [
        _kv("CERTIFICATE NUMBER", h.get("certificate_number", ""), st)
        + _kv("DATE", h.get("date", ""), st),
        _kv("CUSTOMER", h.get("customer", ""), st)
        + _kv("JOB NO", h.get("job_no", ""), st),
        _kv("JOB DESC", h.get("job_desc", ""), st)
        + _kv("QCP NO", h.get("qcp_no", ""), st),
        _kv("DRAWING NUMBER", h.get("drawing_number", ""), st)
        + _kv("EVE JOB", h.get("eve_job", ""), st),
        _kv("QUANTITY", h.get("quantity", ""), st)
        + [Paragraph("", st["label"]), Paragraph("", st["value"])],
    ]
    t = Table(rows, colWidths=[34 * mm, 56 * mm, 24 * mm, 66 * mm])
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, LINE),
        ("BACKGROUND", (0, 0), (0, -1), LIGHT),
        ("BACKGROUND", (2, 0), (2, -1), LIGHT),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("SPAN", (3, 4), (3, 4)),
    ]))
    return t


def _measure_table(items: list[dict], st, *, min_rows: int = 12) -> Table:
    header_top = [
        Paragraph("DESCRIPTION", st["th"]),
        Paragraph("DRAWING", st["th"]),
        Paragraph("DRAWING", st["th"]),
        Paragraph("ACTUAL SIZE", st["th"]),
        Paragraph("", st["th"]),
        Paragraph("FINISHED", st["th"]),
        Paragraph("ACCEPT", st["th"]),
    ]
    header_sub = [
        Paragraph("", st["th"]),
        Paragraph("SIZE TOL (1)", st["th"]),
        Paragraph("SIZE TOL (2)", st["th"]),
        Paragraph("REQ", st["th"]),
        Paragraph("ACT", st["th"]),
        Paragraph("", st["th"]),
        Paragraph("YES / NO", st["th"]),
    ]
    data = [header_top, header_sub]

    body_rows = list(items)
    while len(body_rows) < min_rows:
        body_rows.append({})

    for it in body_rows:
        accept = (it.get("accept") or "").upper()
        data.append([
            Paragraph(str(it.get("description", "") or ""), st["td"]),
            Paragraph(str(it.get("tol1", "") or ""), st["tdc"]),
            Paragraph(str(it.get("tol2", "") or ""), st["tdc"]),
            Paragraph(str(it.get("req", "") or ""), st["tdc"]),
            Paragraph(str(it.get("act", "") or ""), st["tdc"]),
            Paragraph(str(it.get("finished", "") or ""), st["tdc"]),
            Paragraph(accept, st["tdc"]),
        ])

    t = Table(data, colWidths=COL_WIDTHS, repeatRows=2)
    style = [
        ("GRID", (0, 0), (-1, -1), 0.5, LINE),
        ("BACKGROUND", (0, 0), (-1, 1), GREY),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        # Merge the two header rows for single-line columns.
        ("SPAN", (0, 0), (0, 1)),   # DESCRIPTION
        ("SPAN", (3, 0), (4, 0)),   # ACTUAL SIZE over REQ/ACT
        ("SPAN", (5, 0), (5, 1)),   # FINISHED
        ("SPAN", (6, 0), (6, 0)),   # ACCEPT top
    ]
    t.setStyle(TableStyle(style))
    return t


def _yn(value: str | None) -> str:
    v = (value or "").strip().upper()
    if v in ("Y", "YES"):
        return "Y  /  <strike>N</strike>"
    if v in ("N", "NO"):
        return "<strike>Y</strike>  /  N"
    return "Y  /  N"


def _signoff(d: dict, st) -> list:
    # Result strip: QCP-PASS | QC-REJECT | REWORK
    strip = Table(
        [[
            Paragraph("QCP-PASS", st["label"]),
            Paragraph(_yn(d.get("qcp_pass")), st["value"]),
            Paragraph("QC-REJECT", st["label"]),
            Paragraph(_yn(d.get("qc_reject")), st["value"]),
            Paragraph("REWORK", st["label"]),
            Paragraph(_yn(d.get("rework")), st["value"]),
        ]],
        colWidths=[28 * mm, 30 * mm, 28 * mm, 30 * mm, 26 * mm, 38 * mm],
    )
    strip.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, LINE),
        ("BACKGROUND", (0, 0), (0, 0), LIGHT),
        ("BACKGROUND", (2, 0), (2, 0), LIGHT),
        ("BACKGROUND", (4, 0), (4, 0), LIGHT),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
    ]))

    def _sign_col(title: str, name: str, date: str) -> Table:
        inner = Table(
            [
                [Paragraph(title, st["th"])],
                [_kv_row("NAME", name, st)],
                [_kv_row("DATE", date, st)],
                [_sign_row("SIGNATURE", name, st)],
            ],
            colWidths=[88 * mm],
        )
        inner.setStyle(TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.5, LINE),
            ("BACKGROUND", (0, 0), (0, 0), GREY),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        return inner

    cols = Table(
        [[
            _sign_col("INSPECTION EVERTON", d.get("inspector_name", ""), d.get("date", "")),
            _sign_col("CUSTOMER", d.get("customer_signed_name", ""), d.get("customer_date", "")),
        ]],
        colWidths=[90 * mm, 90 * mm],
    )
    cols.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (0, 0), 4),
        ("LEFTPADDING", (1, 0), (1, 0), 4),
    ]))
    return [strip, Spacer(1, 4), cols]


def _kv_row(label: str, value: str, st) -> Table:
    t = Table([[Paragraph(label, st["label"]), Paragraph(value or "&nbsp;", st["value"])]],
              colWidths=[24 * mm, 64 * mm])
    t.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    return t


def _sign_row(label: str, name: str, st) -> Table:
    sig = f'<i>{name}</i>' if name else "&nbsp;"
    t = Table([[Paragraph(label, st["label"]), Paragraph(sig, st["sign"])]],
              colWidths=[24 * mm, 64 * mm])
    t.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    return t


def _build(report: dict, *, blank: bool) -> bytes:
    st = _styles()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=15 * mm, rightMargin=15 * mm,
        topMargin=12 * mm, bottomMargin=12 * mm,
        title="Inspection Report",
    )
    header = report.get("header", {})
    items = [] if blank else report.get("items", [])
    signoff = report.get("signoff", {})

    story = [
        _logo_band(), Spacer(1, 6),
        _title_band(st), Spacer(1, 6),
        _header_grid(header, st), Spacer(1, 8),
        _measure_table(items, st, min_rows=22 if blank else 12), Spacer(1, 8),
    ]
    story += _signoff(signoff, st)
    story += [
        Spacer(1, 8),
        Paragraph(
            "Everton Construction &amp; Engineering · Machinists and General "
            "Engineering · Generated by WorkshopIQ",
            st["foot"],
        ),
    ]
    doc.build(story)
    return buf.getvalue()


def render_report_pdf(report: dict) -> bytes:
    """Render a filled inspection report. ``report`` shape::

        {
          "header": {certificate_number, date, customer, job_no, job_desc,
                     drawing_number, qcp_no, quantity, eve_job},
          "items": [{description, tol1, tol2, req, act, finished, accept}, ...],
          "signoff": {qcp_pass, qc_reject, rework, inspector_name, date,
                      customer_signed_name, customer_date},
        }
    """
    return _build(report, blank=False)


def render_blank_pdf(certificate_number: str = "") -> bytes:
    """Render a blank printable sheet for hand completion."""
    today = datetime.now(timezone.utc).strftime("%d/%m/%Y")
    return _build(
        {
            "header": {"certificate_number": certificate_number, "date": ""},
            "items": [],
            "signoff": {"date": ""},
        },
        blank=True,
    )
