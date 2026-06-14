#!/usr/bin/env bash
#
# WorkshopIQ backup — dumps the database and archives uploads.
# Output: backups/workshopiq-backup-YYYYmmdd-HHMMSS.tar.gz
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
else
  COMPOSE="docker-compose"
fi

# Load env
set -a
[ -f .env ] && . ./.env
set +a
PGUSER="${POSTGRES_USER:-workshopiq}"
PGDB="${POSTGRES_DB:-workshopiq}"

TS="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${ROOT_DIR}/backups"
WORK="${BACKUP_DIR}/tmp-${TS}"
mkdir -p "$WORK"

echo "==> Dumping database…"
$COMPOSE exec -T db pg_dump -U "$PGUSER" "$PGDB" > "${WORK}/database.sql"

echo "==> Archiving uploads…"
docker run --rm \
  -v workshopiq_uploads_data:/data:ro \
  -v "${WORK}:/backup" \
  alpine sh -c "tar czf /backup/uploads.tar.gz -C /data . || true"

OUT="${BACKUP_DIR}/workshopiq-backup-${TS}.tar.gz"
tar czf "$OUT" -C "$WORK" database.sql uploads.tar.gz
rm -rf "$WORK"

echo "==> Backup written to: $OUT"
