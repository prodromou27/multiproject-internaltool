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

# 1. Secrets must exist.
if [ ! -f .env ]; then
  echo "ERROR: .env not found at repo root." >&2
  echo "       cp deploy/env.${ENVIRONMENT}.example .env  &&  edit the secrets." >&2
  exit 1
fi

# 2. Pull the target branch (fast-forward only — never silently rebases local edits).
git fetch --all --prune
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"
echo "==> Now at $(git rev-parse --short HEAD): $(git log -1 --pretty=%s)"

# 3. Build + start.
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
