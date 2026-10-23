#!/usr/bin/env sh
#
# Smoke test a live DEV/PROD deployment.
#
# Required:
#   SMOKE_PASSWORD=<admin-or-planner-password> ./deploy/smoke-test.sh
#
# Optional:
#   BASE_URL=http://localhost:8080
#   SMOKE_EMAIL=admin@company.com
#
# The customer PII check creates one QA customer. It verifies ciphertext in
# Postgres only when CUSTOMER_FIELD_KEY is present in the repo-root .env.
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

BASE_URL="${BASE_URL:-http://localhost:8080}"
SMOKE_EMAIL="${SMOKE_EMAIL:-admin@company.com}"
SMOKE_PASSWORD="${SMOKE_PASSWORD:-}"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

ok() {
  echo "OK: $*"
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

tmp_body="$(mktemp)"
cleanup() {
  rm -f "$tmp_body"
}
trap cleanup EXIT

status="$(curl -sS -o "$tmp_body" -w '%{http_code}' "$BASE_URL/api/health")" || fail "health request failed"
[ "$status" = "200" ] || fail "health returned $status: $(cat "$tmp_body")"
ok "health endpoint returned 200"

status="$(curl -sS -o "$tmp_body" -w '%{http_code}' "$BASE_URL/api/projects")" || fail "unauthorized projects request failed"
[ "$status" = "401" ] || fail "unauthorized /api/projects returned $status, expected 401"
ok "unauthorized API access is rejected"

[ -n "$SMOKE_PASSWORD" ] || fail "set SMOKE_PASSWORD to run authenticated smoke checks"

email_json="$(json_escape "$SMOKE_EMAIL")"
password_json="$(json_escape "$SMOKE_PASSWORD")"
login_body="{\"email\":\"$email_json\",\"password\":\"$password_json\"}"

status="$(curl -sS -o "$tmp_body" -w '%{http_code}' \
  -H 'Content-Type: application/json' \
  -d "$login_body" \
  "$BASE_URL/api/auth/login")" || fail "login request failed"
[ "$status" = "200" ] || fail "login returned $status: $(cat "$tmp_body")"

if grep -q '"requires_2fa":true' "$tmp_body"; then
  fail "login requires 2FA; use a smoke-test account exempt from 2FA"
fi

TOKEN="$(sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$tmp_body")"
[ -n "$TOKEN" ] || fail "login response did not include token: $(cat "$tmp_body")"
ok "login succeeded"

status="$(curl -sS -o "$tmp_body" -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/api/projects")" || fail "authenticated projects request failed"
[ "$status" = "200" ] || fail "authenticated /api/projects returned $status: $(cat "$tmp_body")"
ok "authenticated project list returned 200"

qa_name="QA Smoke $(date +%Y%m%d%H%M%S)"
qa_email="qa-smoke-$(date +%s)@example.com"
customer_body="{\"name\":\"$(json_escape "$qa_name")\",\"contact_email\":\"$(json_escape "$qa_email")\"}"

status="$(curl -sS -o "$tmp_body" -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "$customer_body" \
  "$BASE_URL/api/customers")" || fail "customer create request failed"

case "$status" in
  200|201) ok "customer create returned $status" ;;
  403) fail "customer create forbidden; use a manager/planner smoke account" ;;
  *) fail "customer create returned $status: $(cat "$tmp_body")" ;;
esac

if [ -n "${CUSTOMER_FIELD_KEY:-}" ] && command -v docker >/dev/null 2>&1; then
  db_user="${POSTGRES_USER:-app}"
  db_name="${POSTGRES_DB:-app}"
  stored="$(docker compose exec -T db psql -U "$db_user" -d "$db_name" -tA \
    -c "SELECT contact_email FROM customers WHERE name = '$qa_name' ORDER BY id DESC LIMIT 1;" 2>/dev/null || true)"
  [ -n "$stored" ] || fail "could not read smoke customer from Postgres"
  case "$stored" in
    enc:*) ok "customer PII is encrypted in Postgres" ;;
    *) fail "customer PII was stored without enc: prefix" ;;
  esac
else
  echo "SKIP: Postgres ciphertext check needs CUSTOMER_FIELD_KEY and docker CLI"
fi

ok "smoke test completed"
