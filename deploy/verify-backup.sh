#!/usr/bin/env bash
# Restore a backup into an isolated temporary database and record the result.
# Usage: ./deploy/verify-backup.sh <dev|prod> deploy/backups/app-YYYYmmdd-HHMMSS.sql.gz
set -euo pipefail

ENVIRONMENT="${1:-}"
DUMP="${2:-}"
case "$ENVIRONMENT" in
  dev)  COMPOSE=(-f docker-compose.yml) ;;
  prod) COMPOSE=(-f docker-compose.yml -f docker-compose.prod.yml) ;;
  *) echo "Usage: $0 <dev|prod> <dump.sql.gz>" >&2; exit 1 ;;
esac

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "$DUMP" ] || { echo "ERROR: dump file not found: $DUMP" >&2; exit 1; }
[ -f .env ] && set -a && . ./.env && set +a
PGUSER="${POSTGRES_USER:-app}"
PGDB="${POSTGRES_DB:-app}"
VERIFY_DB="${PGDB}_verify_$(date +%s)_$$"

db_exec() { docker compose "${COMPOSE[@]}" exec -T db "$@"; }
cleanup() { db_exec dropdb -U "$PGUSER" --if-exists --force "$VERIFY_DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> Verifying archive integrity"
gzip -t "$DUMP"
echo "==> Restoring into temporary database '$VERIFY_DB'"
db_exec createdb -U "$PGUSER" "$VERIFY_DB"
gunzip -c "$DUMP" | db_exec psql -v ON_ERROR_STOP=1 -U "$PGUSER" -d "$VERIFY_DB" >/dev/null
db_exec psql -v ON_ERROR_STOP=1 -U "$PGUSER" -d "$VERIFY_DB" -tA \
  -c "SELECT 'users='||COUNT(*) FROM users UNION ALL SELECT 'migrations='||COUNT(*) FROM schema_migrations;"

cleanup
trap - EXIT
VERIFIED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
BACKUP_FILE="$(basename "$DUMP")"
db_exec psql -v ON_ERROR_STOP=1 -U "$PGUSER" -d "$PGDB" \
  -v verified_at="$VERIFIED_AT" -v backup_file="$BACKUP_FILE" \
  -c "INSERT INTO settings(key,value) VALUES ('last_restore_verification',json_build_object('completed_at',:'verified_at','file',:'backup_file')::text) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value;" >/dev/null
echo "==> Restore verification passed and was recorded."
