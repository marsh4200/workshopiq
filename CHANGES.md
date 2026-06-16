# WorkshopIQ — Samba auto-backup patch

## New files (4)
- `backend/app/services/samba_service.py` — SMB client (pure-Python smbprotocol): test / push / rotate-keep-2
- `backend/app/services/samba_scheduler.py` — 6-hourly loop, single-runner via advisory lock + DB timestamp
- `backend/app/api/samba.py` — `/api/settings/samba` GET/PUT, `/test`, `/backup-now` (admin only)
- `frontend/src/pages/Samba.tsx` — the Samba tab/page

## Edited files (8)
- `backend/app/main.py` — register router + start/stop scheduler in lifespan
- `backend/app/schemas/__init__.py` — SambaUpdate / SambaStatusOut / SambaConfigOut
- `backend/app/services/settings_service.py` — new `smb_*` default keys
- `backend/requirements.txt` — `smbprotocol==1.16.1`  ← **new dependency**
- `frontend/src/App.tsx` — `/samba` admin route
- `frontend/src/components/Layout.tsx` — "Samba" nav item (Administration, admin only)
- `frontend/src/api/client.ts` — getSamba / updateSamba / testSamba / backupNowSamba
- `frontend/src/types/index.ts` — SambaStatus / SambaUpdate / SambaActionResult

## ⚠️ Must rebuild — not a hot file-drop
`requirements.txt` gained `smbprotocol`, so the backend image has to rebuild or
it'll crash on import. Tag a release + run your normal update (which rebuilds),
don't just drop files onto a running container.

## How it works
- Tab → enter server IP, share name, username, password, optional subfolder.
- "Test Connection" saves + verifies auth/path. "Back Up Now" pushes immediately.
- Toggle **Enable automatic backup** (needs server+share). Then every 6h a full
  backup zip is pushed and the share is trimmed to the newest 2 (`workshopiq-auto-*.zip`).
  New copy replaces the oldest → always two, ~6h apart.
- Password is write-only: stored, never sent back. Blank on save = keep existing.
- Multi-worker safe: only one worker runs each backup (advisory lock + `smb_last_backup_at`).
