# WorkshopIQ — Inspection Reports: doc-delete sync + customer folders

## Edited files (2)
- `backend/app/api/jobs.py` — deleting a filed inspection-report PDF from a
  job's Documents now also deletes the linked report record, so the
  Inspection Reports page no longer shows a "Filed" row pointing at a PDF
  that's gone. A timeline event is logged
  ("Inspection report ECE-xxxx deleted with its document").
- `frontend/src/pages/InspectionReports.tsx` — reports are now grouped into
  one collapsible folder per customer, exactly like the Jobs page (folder
  icons, count chips, single folder auto-opens, Expand all / Collapse all).
  Folders with pending reports show an amber "N pending" chip. The redundant
  customer name was dropped from the rows since the folder is the customer.

## Hot file-drop safe
No new dependencies, no DB migration (uses the existing
`inspection_reports.document_id` link). Drop the two files in and rebuild
the frontend as usual.

## How it works
- Document delete (admin, job page) → looks up any inspection report whose
  `document_id` matches the doc, deletes the report row(s), logs to the job
  timeline, then removes the file + document as before. The certificate
  number is simply retired; generate a fresh QR to redo the report.
- Pending (unsubmitted) reports are untouched — they still get removed from
  the Inspection Reports page itself, same as before.
