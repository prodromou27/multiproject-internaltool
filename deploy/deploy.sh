#!/usr/bin/env bash
#
# One-command deploy for a single machine.
#
#   ./deploy/deploy.sh dev      # DEV box  → tracks the 'dev' branch
#   ./deploy/deploy.sh prod     # PROD box → tracks the 'main' branch
#
# What it does: pulls the right branch, rebuilds the image, brings the stack up
# with the correct compose overrides, and waits for the app to report healthy.
#
# Requirements on the box: git, docker, docker compose plugin, and a .env file at
# the repo root (copy from deploy/env.<env>.example and fill in the secrets).
#
# Override the branch with DEPLOY_BRANCH=... if your branch names differ.
set -euo pipefail

ENVIRONMENT="${1:-}"
case "$ENVIRONMENT" in
  dev)
    BRANCH="${DEPLOY_BRANCH:-dev}"
    COMPOSE=(-f docker-compose.yml)
    ;;
  prod)
    BRANCH="${DEPLOY_BRANCH:-main}"
    COMPOSE=(-f docker-compose.yml -f docker-compose.prod.yml)
    ;;
  *)
    echo "Usage: $0 <dev|prod>" >&2
    exit 1
    ;;
esac

# Move to the repo root (parent of this script's dir).
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Deploying '$ENVIRONMENT' from branch '$BRANCH'"

# 1. Secrets must exist and be filled in.
if [ ! -f .env ]; then
  echo "ERROR: .env not found at repo root." >&2
  echo "       ./deploy/gen-secrets.sh ${ENVIRONMENT}   # generates one with fresh secrets" >&2
  echo "       (or: cp deploy/env.${ENVIRONMENT}.example .env  &&  edit it)" >&2
  exit 1
fi

# Preflight: validate the secrets so we fail before a long build, not after.
set -a; . ./.env; set +a
errs=0
if grep -q 'CHANGE_ME' .env; then
  echo "ERROR: .env still contains CHANGE_ME placeholders — fill in real secrets." >&2; errs=1
fi
if [ -z "${POSTGRES_PASSWORD:-}" ]; then
  echo "ERROR: POSTGRES_PASSWORD is empty." >&2; errs=1
fi
if [ "${#JWT_SECRET}" -lt 32 ]; then
  echo "ERROR: JWT_SECRET must be at least 32 characters (got ${#JWT_SECRET})." >&2; errs=1
fi
if [ -n "${CUSTOMER_FIELD_KEY:-}" ] && ! printf '%s' "$CUSTOMER_FIELD_KEY" | grep -qE '^[0-9a-fA-F]{64}$'; then
  echo "ERROR: CUSTOMER_FIELD_KEY must be exactly 64 hex chars (or empty to disable encryption)." >&2; errs=1
fi
[ "$errs" -eq 0 ] || { echo "Fix .env and re-run." >&2; exit 1; }

# 2. Pull the target branch (fast-forward only — never silently rebases local edits).
git fetch --all --prune
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"
echo "==> Now at $(git rev-parse --short HEAD): $(git log -1 --pretty=%s)"

# 3. Validate the compose config, then build + start.
docker compose "${COMPOSE[@]}" config -q
docker compose "${COMPOSE[@]}" up -d --build

# 4. Wait for the app container to become healthy.
echo "==> Waiting for app health…"
cid="$(docker compose "${COMPOSE[@]}" ps -q app)"
for i in $(seq 1 40); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$cid" 2>/dev/null || echo unknown)"
  if [ "$status" = "healthy" ]; then
    echo "==> App is healthy."
    break
  fi
  if [ "$status" = "unhealthy" ]; then
    echo "ERROR: app reported unhealthy. Recent logs:" >&2
    docker compose "${COMPOSE[@]}" logs --tail=40 app >&2
    exit 1
  fi
  sleep 3
done

docker compose "${COMPOSE[@]}" ps
echo "==> Deploy of '$ENVIRONMENT' complete."
echo "    First run prints the seeded admin password in: docker compose ${COMPOSE[*]} logs app | grep -A4 'admin account'"
