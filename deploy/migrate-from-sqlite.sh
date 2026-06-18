#!/usr/bin/env bash
#
# One-time data import: copy a legacy SQLite app.db into the running PostgreSQL.
# Use this on the PROD box to carry existing data over from the old Windows app.
#
#   ./deploy/migrate-from-sqlite.sh <dev|prod> /path/to/app.db
#
# Runs the migration (server/scripts/sqlite-to-postgres.js) inside a throwaway
# node:20 container joined to the compose network, so it can reach the `db`
# service. The slim runtime image omits better-sqlite3 (dev-only), which is why
# this uses a full node image instead of the app container.
#
# Safe to re-run: the migration inserts with ON CONFLICT DO NOTHING.
set -euo pipefail

ENVIRONMENT="${1:-}"
SQLITE="${2:-}"
case "$ENVIRONMENT" in
  dev)  COMPOSE=(-f docker-compose.yml) ;;
  prod) COMPOSE=(-f docker-compose.yml -f docker-compose.prod.yml) ;;
  *) echo "Usage: $0 <dev|prod> /path/to/app.db" >&2; exit 1 ;;
esac
[ -f "$SQLITE" ] || { echo "ERROR: SQLite file not found: $SQLITE" >&2; exit 1; }

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f .env ] && set -a && . ./.env && set +a
PGUSER="${POSTGRES_USER:-app}"
PGDB="${POSTGRES_DB:-app}"
PGPASS="${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}"

# Discover the compose network from the running db container.
db_cid="$(docker compose "${COMPOSE[@]}" ps -q db)"
[ -n "$db_cid" ] || { echo "ERROR: db service is not running. Deploy first." >&2; exit 1; }
network="$(docker inspect "$db_cid" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')"

abs_sqlite="$(cd "$(dirname "$SQLITE")" && pwd)/$(basename "$SQLITE")"

echo "==> Importing $abs_sqlite into '$PGDB' (network: $network)"
docker run --rm \
  --network "$network" \
  -e DATABASE_URL="postgres://${PGUSER}:${PGPASS}@db:5432/${PGDB}" \
  -v "$(pwd)/server:/src:ro" \
  -v "$abs_sqlite:/data/app.db:ro" \
  node:20 \
  sh -c "cp -r /src /tmp/app && cd /tmp/app && npm ci --no-audit --no-fund && node scripts/sqlite-to-postgres.js /data/app.db"

echo "==> Import complete."
