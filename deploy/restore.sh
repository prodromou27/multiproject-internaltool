#!/usr/bin/env bash
#
# Restore a PostgreSQL dump produced by deploy/backup.sh.
#
#   ./deploy/restore.sh <dev|prod> deploy/backups/app-YYYYmmdd-HHMMSS.sql.gz
#
# WARNING: this overwrites the current database contents (the dump is taken with
# --clean --if-exists, so it drops and recreates objects). Requires a confirmation.
set -euo pipefail

ENVIRONMENT="${1:-}"
DUMP="${2:-}"
case "$ENVIRONMENT" in
  dev)  COMPOSE=(-f docker-compose.yml) ;;
  prod) COMPOSE=(-f docker-compose.yml -f docker-compose.prod.yml) ;;
  *) echo "Usage: $0 <dev|prod> <dump.sql.gz>" >&2; exit 1 ;;
esac
[ -f "$DUMP" ] || { echo "ERROR: dump file not found: $DUMP" >&2; exit 1; }

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f .env ] && set -a && . ./.env && set +a
PGUSER="${POSTGRES_USER:-app}"
PGDB="${POSTGRES_DB:-app}"

read -r -p "This OVERWRITES the '$ENVIRONMENT' database '$PGDB'. Type 'yes' to continue: " ok
[ "$ok" = "yes" ] || { echo "Aborted."; exit 1; }

echo "==> Restoring $DUMP → '$PGDB'"
gunzip -c "$DUMP" | docker compose "${COMPOSE[@]}" exec -T db psql -U "$PGUSER" -d "$PGDB"
echo "==> Restore complete. Restarting app."
docker compose "${COMPOSE[@]}" restart app
