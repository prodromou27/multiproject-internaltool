#!/usr/bin/env bash
#
# First install and all later updates with one command:
#   sudo APP_URL=http://server:8080 DEPLOY_BRANCH=DEV-2 ./deploy/bootstrap.sh dev
#   sudo APP_URL=https://app.example.com ./deploy/bootstrap.sh prod
#
# Installs Docker when missing, generates strong secrets when .env is missing,
# starts Docker, and delegates the idempotent deployment to deploy.sh.
set -euo pipefail

ENVIRONMENT="${1:-dev}"
case "$ENVIRONMENT" in dev|prod) ;; *) echo "Usage: $0 <dev|prod>" >&2; exit 1 ;; esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: Run bootstrap with sudo so it can install and start Docker." >&2
  echo "Example: sudo APP_URL=http://server:8080 DEPLOY_BRANCH=DEV-2 $0 dev" >&2
  exit 1
fi

install_base_packages() {
  if command -v dnf >/dev/null 2>&1; then
    dnf -y install git curl ca-certificates openssl
  elif command -v apt-get >/dev/null 2>&1; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y git curl ca-certificates openssl
  else
    echo "ERROR: Supported package manager not found (dnf or apt-get required)." >&2
    exit 1
  fi
}

install_base_packages

if ! command -v docker >/dev/null 2>&1; then
  echo "==> Docker not found; installing Docker Engine and Compose plugin."
  installer="$(mktemp)"
  trap 'rm -f "${installer:-}"' EXIT
  curl --fail --silent --show-error --location https://get.docker.com --output "$installer"
  sh "$installer"
  rm -f "$installer"
  trap - EXIT
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl enable --now docker
fi

docker compose version >/dev/null 2>&1 || {
  echo "ERROR: Docker Compose v2 plugin is unavailable after installation." >&2
  exit 1
}

chmod +x deploy/*.sh
git config --global --add safe.directory "$ROOT" >/dev/null 2>&1 || true

if [ ! -f .env ]; then
  if [ "$ENVIRONMENT" = "dev" ]; then
    export APP_PORT="${APP_PORT:-8080}"
  fi
  if [ -z "${APP_URL:-}" ]; then
    if [ "$ENVIRONMENT" = "prod" ]; then
      echo "ERROR: APP_URL=https://your-domain is required for the first production install." >&2
      exit 1
    fi
    host_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
    export APP_URL="http://${host_ip:-localhost}:8080"
  fi
  echo "==> Creating .env with generated database and encryption secrets."
  ./deploy/gen-secrets.sh "$ENVIRONMENT"
fi

# Open a direct HTTP port only when firewalld is active and APP_PORT is a plain
# numeric host port. Reverse-proxy bindings such as 127.0.0.1:8080 stay private.
set -a; . ./.env; set +a
if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1 \
   && printf '%s' "${APP_PORT:-}" | grep -qE '^[0-9]+$'; then
  firewall-cmd --add-port="${APP_PORT}/tcp" --permanent >/dev/null
  firewall-cmd --reload >/dev/null
fi

export DEPLOY_BRANCH="${DEPLOY_BRANCH:-$([ "$ENVIRONMENT" = dev ] && echo dev || echo prod)}"
./deploy/deploy.sh "$ENVIRONMENT"

echo
echo "==> Installation/update complete: ${APP_URL}"
echo "==> Future updates use the same bootstrap command or:"
echo "    DEPLOY_BRANCH=${DEPLOY_BRANCH} ./deploy/deploy.sh ${ENVIRONMENT}"
