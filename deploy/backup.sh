#!/usr/bin/env bash
#
# Back up the bundled PostgreSQL database to a compressed dump.
#
#   ./deploy/backup.sh [dev|prod]      # default: dev
#
# Writes deploy/backups/<db>-YYYYmmdd-HHMMSS.sql.gz and prunes dumps older than
# BACKUP_RETENTION_DAYS (default 14). Cron example (daily 02:30):
#   30 2 * * * /opt/app/deploy/backup.sh prod >> /var/log/app-backup.log 2>&1
set -euo pipefail

ENVIRONMENT="${1:-dev}"
case "$ENVIRONMENT" in
  dev)  COMPOSE=(-f docker-compose.yml) ;;
  prod) COMPOSE=(-f docker-compose.yml -f docker-compose.prod.yml) ;;
  *) echo "Usage: $0 <dev|prod>" >&2; exit 1 ;;
esac

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f .env ] && set -a && . ./.env && set +a

PGUSER="${POSTGRES_USER:-app}"
PGDB="${POSTGRES_DB:-app}"
RETENTION="${BACKUP_RETENTION_DAYS:-14}"
OUTDIR="deploy/backups"
mkdir -p "$OUTDIR"
OUT="$OUTDIR/${PGDB}-$(date +%Y%m%d-%H%M%S).sql.gz"

echo "==> Dumping '$PGDB' → $OUT"
docker compose "${COMPOSE[@]}" exec -T db \
  pg_dump -U "$PGUSER" -d "$PGDB" --clean --if-exists \
  | gzip > "$OUT"

echo "==> Done ($(du -h "$OUT" | cut -f1)). Pruning dumps older than ${RETENTION} days."
find "$OUTDIR" -name "${PGDB}-*.sql.gz" -type f -mtime +"$RETENTION" -print -delete
