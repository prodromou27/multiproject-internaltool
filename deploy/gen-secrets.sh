#!/usr/bin/env bash
#
# Generate a repo-root .env for an environment with fresh, strong secrets.
#
#   ./deploy/gen-secrets.sh <dev|prod>
#   APP_URL=http://host:8080 APP_PORT=8080 ./deploy/gen-secrets.sh dev
#
# Starts from deploy/env.<env>.example and fills in POSTGRES_PASSWORD,
# JWT_SECRET, CUSTOMER_FIELD_KEY, and ATTACHMENT_KEY with openssl-generated
# values. APP_URL and APP_PORT may be overridden from the shell environment.
# Refuses to overwrite an existing .env (back it up / remove it first).
set -euo pipefail

ENVIRONMENT="${1:-}"
case "$ENVIRONMENT" in dev|prod) ;; *) echo "Usage: $0 <dev|prod>" >&2; exit 1 ;; esac

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="deploy/env.${ENVIRONMENT}.example"
[ -f "$TEMPLATE" ] || { echo "ERROR: $TEMPLATE not found" >&2; exit 1; }

if [ -e .env ]; then
  echo "ERROR: .env already exists. Remove or back it up first to regenerate." >&2
  exit 1
fi
command -v openssl >/dev/null || { echo "ERROR: openssl is required." >&2; exit 1; }

PG_PW="$(openssl rand -hex 24)"
JWT="$(openssl rand -hex 48)"
KEY="$(openssl rand -hex 32)"
ATTACHMENT_KEY="$(openssl rand -hex 32)"
APP_URL_OVERRIDE="${APP_URL:-}"
APP_PORT_OVERRIDE="${APP_PORT:-}"

# Substitute every CHANGE_ME_* value with a generated secret.
SED_ARGS=(
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${PG_PW}|"
  -e "s|^JWT_SECRET=.*|JWT_SECRET=${JWT}|"
  -e "s|^CUSTOMER_FIELD_KEY=.*|CUSTOMER_FIELD_KEY=${KEY}|"
  -e "s|^ATTACHMENT_KEY=.*|ATTACHMENT_KEY=${ATTACHMENT_KEY}|"
)
[ -z "$APP_URL_OVERRIDE" ] || SED_ARGS+=(-e "s|^APP_URL=.*|APP_URL=${APP_URL_OVERRIDE}|")
[ -z "$APP_PORT_OVERRIDE" ] || SED_ARGS+=(-e "s|^APP_PORT=.*|APP_PORT=${APP_PORT_OVERRIDE}|")

sed "${SED_ARGS[@]}" "$TEMPLATE" > .env

chmod 600 .env
echo "==> Wrote .env for '$ENVIRONMENT' with generated secrets (mode 600)."
echo "    IMPORTANT: back up CUSTOMER_FIELD_KEY and ATTACHMENT_KEY."
echo "    Review .env (APP_PORT, TRUST_PROXY, etc.), then: ./deploy/deploy.sh ${ENVIRONMENT}"
