"""Render the Everton inspection report to a PDF that mirrors the paper sheet.

Pure reportlab (platypus) — no headless browser, so it runs on the VPS with no
extra system packages. Two entry points:

* :func:`render_report_pdf` — a filled report for a submitted inspection.
* :func:`render_blank_pdf` — a blank printable sheet for hand completion.

Layout, wording, column structure and field pairing follow
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
LIGHT = colors.HexColor("#eef0f3")
LINE = colors.HexColor("#000000")
ACCENT = colors.HexColor("#1f3fae")

USABLE_W = 180 * mm

# Measurement table columns (sum == USABLE_W).
COL_WIDTHS = [
    50 * mm,  # DESCRIPTION
    23 * mm,  # DRAWING SIZE TOL (1)
    23 * mm,  # DRAWING SIZE TOL (2)
    17 * mm,  # ACTUAL SIZE — REQ
    17 * mm,  # ACTUAL SIZE — ACT
    25 * mm,  # FINISHED
    25 * mm,  # ACCEPT (YES / NO)
]

BODY_ROW_H = 8.4 * mm   # comfortable, even for blank rows
HEAD_ROW_H = 7.2 * mm


def _styles() -> dict[str, ParagraphStyle]:
    return {
        "title": ParagraphStyle(
            "title", fontName="Helvetica-Bold", fontSize=13, leading=15,
            alignment=TA_CENTER, textColor=INK,
        ),
        "label": ParagraphStyle(
            "label", fontName="Helvetica-Bold", fontSize=8.5, leading=10,
            alignment=TA_LEFT, textColor=INK,
        ),
        "value": ParagraphStyle(
            "value", fontName="Helvetica", fontSize=9.5, leading=11,
            alignment=TA_LEFT, textColor=INK,
        ),
        "th": ParagraphStyle(
            "th", fontName="Helvetica-Bold", fontSize=8, leading=9.5,
            alignment=TA_CENTER, textColor=INK,
        ),
        "td": ParagraphStyle(
            "td", fontName="Helvetica", fontSize=9, leading=11,
            alignment=TA_LEFT, textColor=INK,
        ),
        "tdc": ParagraphStyle(
            "tdc", fontName="Helvetica", fontSize=9, leading=11,
            alignment=TA_CENTER, textColor=INK,
        ),
        "sign": ParagraphStyle(
            "sign", fontName="Helvetica-Oblique", fontSize=13, leading=15,
            alignment=TA_LEFT, textColor=ACCENT,
        ),
        "foot": ParagraphStyle(
            "foot", fontName="Helvetica", fontSize=7, leading=9,
            alignment=TA_CENTER, textColor=colors.HexColor("#888888"),
        ),
    }


def _logo_band() -> Table:
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
    band = Table([[cell]], colWidths=[USABLE_W])
    band.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 3, LINE),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return band


def _title_band(st) -> Table:
    t = Table([[Paragraph("INSPECTION REPORT", st["title"])]], colWidths=[USABLE_W])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), GREY),
        ("BOX", (0, 0), (-1, -1), 1, LINE),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t


def _header_grid(h: dict, st) -> Table:
    """Label/value grid matching the sheet's field pairing exactly.

    Left labels : CERTIFICATE NUMBER, CUSTOMER, JOB DESC, DRAWING NUMBER, QUANTITY
    Right labels:        (none),       DATE,    JOB NO,     QCP NO,        EVE JOB
    """
    def L(t):
        return Paragraph(t, st["label"])

    def V(t):
        return Paragraph((t or "").replace("\n", "<br/>") or "&nbsp;", st["value"])

    rows = [
        [L("CERTIFICATE NUMBER"), V(h.get("certificate_number", "")), L(""), V("")],
        [L("CUSTOMER"), V(h.get("customer", "")), L("DATE"), V(h.get("date", ""))],
        [L("JOB DESC"), V(h.get("job_desc", "")), L("JOB NO"), V(h.get("job_no", ""))],
        [L("DRAWING NUMBER"), V(h.get("drawing_number", "")), L("QCP NO"), V(h.get("qcp_no", ""))],
        [L("QUANTITY"), V(h.get("quantity", "")), L("EVE JOB"), V(h.get("eve_job", ""))],
    ]
    t = Table(rows, colWidths=[34 * mm, 56 * mm, 24 * mm, 66 * mm], rowHeights=[8.4 * mm] * 5)
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.75, LINE),
        ("BACKGROUND", (0, 0), (0, -1), LIGHT),
        ("BACKGROUND", (2, 0), (2, -1), LIGHT),
        ("SPAN", (1, 0), (3, 0)),          # certificate value spans the full right side
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t


def _measure_table(items: list[dict], st, *, rows_total: int) -> Table:
    head1 = [
        Paragraph("DESCRIPTION", st["th"]),
        Paragraph("DRAWING", st["th"]),
        Paragraph("DRAWING", st["th"]),
        Paragraph("ACTUAL SIZE", st["th"]),
        Paragraph("", st["th"]),
        Paragraph("FINISHED", st["th"]),
        Paragraph("ACCEPT", st["th"]),
    ]
    head2 = [
        Paragraph("", st["th"]),
        Paragraph("SIZE TOL (1)", st["th"]),
        Paragraph("SIZE TOL (2)", st["th"]),
        Paragraph("REQ", st["th"]),
        Paragraph("ACT", st["th"]),
        Paragraph("", st["th"]),
        Paragraph("YES / NO", st["th"]),
    ]
    data = [head1, head2]

    body = list(items)
    while len(body) < rows_total:
        body.append({})

    for it in body:
        accept = (it.get("accept") or "").upper()
        accept = {"YES": "Y", "NO": "N"}.get(accept, accept)
        data.append([
            Paragraph(str(it.get("description", "") or ""), st["td"]),
            Paragraph(str(it.get("tol1", "") or ""), st["tdc"]),
            Paragraph(str(it.get("tol2", "") or ""), st["tdc"]),
            Paragraph(str(it.get("req", "") or ""), st["tdc"]),
            Paragraph(str(it.get("act", "") or ""), st["tdc"]),
            Paragraph(str(it.get("finished", "") or ""), st["tdc"]),
            Paragraph(accept, st["tdc"]),
        ])

    row_heights = [HEAD_ROW_H, HEAD_ROW_H] + [BODY_ROW_H] * len(body)
    t = Table(data, colWidths=COL_WIDTHS, rowHeights=row_heights, repeatRows=2)
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.75, LINE),
        ("BACKGROUND", (0, 0), (-1, 1), GREY),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("SPAN", (0, 0), (0, 1)),   # DESCRIPTION
        ("SPAN", (3, 0), (4, 0)),   # ACTUAL SIZE over REQ / ACT
        ("SPAN", (5, 0), (5, 1)),   # FINISHED
    ]))
    return t


def _yn(value: str | None) -> str:
    v = (value or "").strip().upper()
    if v in ("Y", "YES"):
        return "<b>Y</b>  /  <strike>N</strike>"
    if v in ("N", "NO"):
        return "<strike>Y</strike>  /  <b>N</b>"
    return "Y  /  N"


def _kv_row(label: str, value: str, st, *, sign: bool = False) -> Table:
    if sign:
        rhs = Paragraph(f"<i>{value}</i>" if value else "&nbsp;", st["sign"])
    else:
        rhs = Paragraph(value or "&nbsp;", st["value"])
    t = Table([[Paragraph(label, st["label"]), rhs]], colWidths=[26 * mm, 62 * mm],
              rowHeights=[8 * mm])
    t.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BACKGROUND", (0, 0), (0, 0), LIGHT),
        ("LINEBELOW", (0, 0), (-1, -1), 0.75, LINE),
        ("LINEAFTER", (0, 0), (0, 0), 0.75, LINE),
    ]))
    return t


def _signoff(d: dict, st) -> list:
    strip = Table(
        [[
            Paragraph("QCP-PASS", st["label"]),
            Paragraph(_yn(d.get("qcp_pass")), st["value"]),
            Paragraph("QC-REJECT", st["label"]),
            Paragraph(_yn(d.get("qc_reject")), st["value"]),
            Paragraph("REWORK", st["label"]),
            Paragraph(_yn(d.get("rework")), st["value"]),
        ]],
        colWidths=[26 * mm, 32 * mm, 26 * mm, 32 * mm, 24 * mm, 40 * mm],
        rowHeights=[9 * mm],
    )
    strip.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.75, LINE),
        ("BACKGROUND", (0, 0), (0, 0), LIGHT),
        ("BACKGROUND", (2, 0), (2, 0), LIGHT),
        ("BACKGROUND", (4, 0), (4, 0), LIGHT),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ]))

    def col(title, name, date):
        head = Table([[Paragraph(title, st["th"])]], colWidths=[88 * mm], rowHeights=[8 * mm])
        head.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), GREY),
            ("BOX", (0, 0), (-1, -1), 0.75, LINE),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        inner = Table(
            [[head],
             [_kv_row("NAME", name, st)],
             [_kv_row("DATE", date, st)],
             [_kv_row("SIGNATURE", name, st, sign=True)]],
            colWidths=[88 * mm],
        )
        inner.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.75, LINE),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        return inner

    cols = Table(
        [[col("INSPECTION EVERTON", d.get("inspector_name", ""), d.get("date", "")),
          col("CUSTOMER", d.get("customer_signed_name", ""), d.get("customer_date", ""))]],
        colWidths=[90 * mm, 90 * mm],
    )
    cols.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (0, 0), 0),
        ("RIGHTPADDING", (0, 0), (0, 0), 4),
        ("LEFTPADDING", (1, 0), (1, 0), 4),
        ("RIGHTPADDING", (1, 0), (1, 0), 0),
    ]))
    return [strip, Spacer(1, 6), cols]


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
    rows_total = 14 if blank else max(len(items) + 2, 8)

    story = [
        _logo_band(), Spacer(1, 8),
        _title_band(st), Spacer(1, 8),
        _header_grid(header, st), Spacer(1, 10),
        _measure_table(items, st, rows_total=rows_total), Spacer(1, 10),
    ]
    story += _signoff(signoff, st)
    story += [
        Spacer(1, 10),
        Paragraph(
            "Everton Construction &amp; Engineering · Machinists and General "
            "Engineering · Generated by WorkshopIQ",
            st["foot"],
        ),
    ]
    doc.build(story)
    return buf.getvalue()


def render_report_pdf(report: dict) -> bytes:
    """Render a filled inspection report.

    ``report`` shape::

        {"header": {certificate_number, date, customer, job_no, job_desc,
                    drawing_number, qcp_no, quantity, eve_job},
         "items": [{description, tol1, tol2, req, act, finished, accept}, ...],
         "signoff": {qcp_pass, qc_reject, rework, inspector_name, date,
                     customer_signed_name, customer_date}}
    """
    return _build(report, blank=False)


def render_blank_pdf(certificate_number: str = "") -> bytes:
    """Render a blank printable sheet for hand completion."""
    return _build(
        {"header": {"certificate_number": certificate_number}, "items": [],
         "signoff": {}},
        blank=True,
    )
