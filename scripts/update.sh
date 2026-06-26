#!/usr/bin/env bash
#
# WorkshopIQ updater.
#
#   ./scripts/update.sh           Run an update now (backup -> pull -> rebuild -> restart)
#   ./scripts/update.sh --watch   Run as a host watcher for the in-app "Apply Update" button.
#
# Progress is written into the uploads volume so the app can display it live:
#   .update-status   one word: queued | running | done | error
#   .update-log      human-readable progress log
#   .update-version  the version that was applied (consumed by the backend on restart)
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
else
  COMPOSE="docker-compose"
fi

VOLUME="${WORKSHOPIQ_VOLUME:-workshopiq_uploads_data}"
MARKER=".update-requested"

vol_sh() { docker run --rm -v "${VOLUME}:/data" alpine sh -c "$1" 2>/dev/null || true; }

marker_present() { docker run --rm -v "${VOLUME}:/data:ro" alpine sh -c "[ -f /data/${MARKER} ]" 2>/dev/null; }
marker_content() { docker run --rm -v "${VOLUME}:/data:ro" alpine sh -c "cat /data/${MARKER} 2>/dev/null" 2>/dev/null || true; }
clear_marker()   { vol_sh "rm -f /data/${MARKER}"; }
set_status()     { vol_sh "printf '%s' '$1' > /data/.update-status"; }
reset_log()      { vol_sh "echo '[$(date '+%H:%M:%S')] $1' > /data/.update-log"; }
log()            { echo "$1"; vol_sh "echo '[$(date '+%H:%M:%S')] $1' >> /data/.update-log"; }

do_update() {
  # $1 = backup mode: "on" (default) creates a pre-update safety backup that is
  # auto-pruned to the newest few; "off" skips the backup entirely (update only,
  # you take manual backups yourself). The choice comes from the in-app
  # "Back up before updating" toggle (passed via the request marker), or from a
  # --no-backup flag on a manual run.
  local backup_mode="${1:-on}"

  set_status "running"
  reset_log "Update started"

  if [ "$backup_mode" = "off" ]; then
    log "Backup skipped — 'Back up before updating' is off. Running update only."
  else
    log "Backing up database and uploads (rollback safety)..."
    if BACKUP_KEEP="${BACKUP_KEEP:-2}" bash "${ROOT_DIR}/scripts/backup.sh" >/dev/null 2>&1; then
      log "Backup complete. Keeping the newest ${BACKUP_KEEP:-2}; older ones pruned."
    else
      log "WARNING: backup failed, continuing."
    fi
  fi

  log "This software has been created on custom code."

  local applied_version=""
  if [ -d "${ROOT_DIR}/.git" ]; then
    log "Fetching latest from GitHub..."
    # --force so a moved/re-pointed tag updates the local copy instead of being
    # rejected ("would clobber existing tag") and leaving us stuck rebuilding
    # the old commit the stale tag still points at.
    git -C "$ROOT_DIR" fetch --all --tags --prune --force >/dev/null 2>&1 || log "WARNING: git fetch had issues."
    LATEST_TAG="$(git -C "$ROOT_DIR" tag -l 'v*' --sort=-v:refname | head -n1)"
    if [ -n "$LATEST_TAG" ]; then
      log "Checking out ${LATEST_TAG}..."
      git -C "$ROOT_DIR" checkout -f "$LATEST_TAG" >/dev/null 2>&1
      applied_version="${LATEST_TAG#v}"
      # Single source of truth = the deployed git tag. Record it into .env so
      # compose injects it into the backend (and it survives restarts/reboots).
      # This is what makes the dashboard version track GitHub automatically,
      # with no code edit per release.
      if grep -q '^APP_VERSION=' "${ROOT_DIR}/.env" 2>/dev/null; then
        sed -i "s/^APP_VERSION=.*/APP_VERSION=${applied_version}/" "${ROOT_DIR}/.env"
      else
        echo "APP_VERSION=${applied_version}" >> "${ROOT_DIR}/.env"
      fi
      # Write the version marker BEFORE rebuilding, so it already exists when
      # the freshly-built backend boots and runs its startup version sync.
      # (If written after the rebuild, the backend boots first, sees no marker,
      # and only picks it up a restart later.) The backend consumes it on boot.
      vol_sh "printf '%s' '$applied_version' > /data/.update-version"
    else
      log "No tags found; pulling default branch..."
      git -C "$ROOT_DIR" pull --ff-only >/dev/null 2>&1 || log "WARNING: pull failed."
    fi
  else
    log "Not a git checkout; skipping source update."
  fi

  log "Rebuilding containers (this can take a few minutes)..."
  if $COMPOSE up -d --build >/dev/null 2>&1; then
    log "Containers rebuilt and restarted."
  else
    log "ERROR: rebuild failed."
    if [ "$backup_mode" != "off" ]; then
      LAST_BACKUP="$(ls -1t "${ROOT_DIR}/backups"/workshopiq-backup-*.tar.gz 2>/dev/null | head -n1 || true)"
      if [ -n "$LAST_BACKUP" ]; then
        log "Your pre-update backup is safe at: $(basename "$LAST_BACKUP")"
        log "Restore it from Settings → Backup & Restore if needed."
      fi
    fi
    set_status "error"
    clear_marker
    return 1
  fi

  if [ -n "$applied_version" ]; then
    log "Updated to version ${applied_version}."
  fi

  log "Update complete."
  set_status "done"
  clear_marker
}

if [ "${1:-}" = "--watch" ]; then
  echo "==> WorkshopIQ update watcher started (polling every 15s). Ctrl-C to stop."
  while true; do
    if marker_present; then
      echo "==> [$(date '+%F %T')] Update request detected."
      # The marker content carries the backup choice: "update-nobackup" = skip
      # the pre-update backup (update only); anything else = back up first.
      REQ="$(marker_content)"
      if [ "$REQ" = "update-nobackup" ]; then
        do_update "off" || echo "ERROR: update failed."
      else
        do_update "on" || echo "ERROR: update failed."
      fi
      # An update may have replaced THIS script with newer logic. Re-exec the
      # freshly-checked-out update.sh so its changes take effect immediately —
      # no manual `systemctl restart` needed after an updater change. `exec`
      # keeps the same PID, so systemd still sees the service as running, and
      # do_update has already cleared the request marker so we don't loop.
      echo "==> Reloading watcher to pick up any updater changes."
      exec /usr/bin/env bash "${ROOT_DIR}/scripts/update.sh" --watch
    fi
    sleep 15
  done
elif [ "${1:-}" = "--no-backup" ]; then
  do_update "off"
else
  do_update "on"
fi
