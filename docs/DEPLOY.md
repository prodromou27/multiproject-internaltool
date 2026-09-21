# Deployment — Linux / Docker / PostgreSQL

The app runs as a single Node container (Express API + built React SPA) against a
PostgreSQL database. This replaces the previous Windows/SQLite setup. For the
Linux/Docker/PostgreSQL deployment path, `dev` is the test/staging branch and `prod`
is the production branch.

## Stack

- **App image** — multi-stage `Dockerfile`: builds the client with Vite, then runs
  the Express server on `node:24-alpine`, serving the API and the built SPA over
  **HTTP on `PORT` (default 8080)**. TLS is terminated by an upstream reverse proxy /
  load balancer (no certs in the container).
- **Database** — PostgreSQL 16. The data layer (`server/db.js`) is an async `pg`
  wrapper; the SQL in the app is native PostgreSQL. The schema, migrations and two SQL
  helper functions (`app_now()`, `app_today()`) are created on startup by `db.init()`,
  which is safe to run on every start (CI checks that it can run twice).

## Required environment

| Var | Required | Notes |
|-----|----------|-------|
| `DATABASE_URL` | yes | `postgres://user:pass@host:5432/db` |
| `JWT_SECRET` | yes (prod) | ≥32 chars; server refuses to start in production without it |
| `CUSTOMER_FIELD_KEY` | yes (prod) | 64-char hex; required for customer PII encryption at rest |
| `ATTACHMENT_KEY` | yes (prod) | 64-char hex; required for uploaded-file encryption at rest |
| `APP_URL` | yes (prod) | public HTTP(S) base URL used in password reset links |
| `PORT` | no | defaults to 8080 |
| `ADMIN_PASSWORD` | no | first-run password; defaults to `admin` and forces immediate change |

See `server/.env.example`.

## Run on DEV (Docker Compose)

Fresh server install and future updates can use the same command:

```bash
sudo APP_URL=http://SERVER_IP:8080 DEPLOY_BRANCH=DEV-3 ./deploy/bootstrap.sh dev
```

This installs Docker when needed, generates `.env` secrets on first run, preserves
existing secrets/data on updates, deploys the branch, and verifies container health.

```bash
# from the repo root
cp deploy/env.dev.example .env    # set POSTGRES_PASSWORD / JWT_SECRET / encryption keys
docker compose up --build
```

Compose starts `db` (postgres:16, healthchecked, named volume `pgdata`) and `app`
(waits for the db to be healthy, schema auto-creates, first-run admin printed once to
the app logs). The app is published on `http://localhost:8080`. Uploads persist on the
`uploads` volume.

For the server deploy path, use the helper script. It will generate a dev `.env`
automatically if one is missing:

```bash
./deploy/deploy.sh dev
```

To deploy a development test branch such as `DEV-2` from the same folder and Docker
stack, override only the branch:

```bash
DEPLOY_BRANCH=DEV-3 ./deploy/deploy.sh dev
```

On a first deploy with no `.env`, you can also set the public URL/port in that
same command:

```bash
APP_URL=http://dev.example.com:8080 APP_PORT=8080 DEPLOY_BRANCH=DEV-3 ./deploy/deploy.sh dev
```

## Verification checklist (run against the live container)

```bash
BASE=http://localhost:8080
# 1. login (first empty-database credentials are admin / admin)
TOKEN=$(curl -s $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin","password":"admin"}' | jq -r .token)
# 2. core reads
curl -s -o /dev/null -w '%{http_code}\n' $BASE/api/projects        -H "Authorization: Bearer $TOKEN"  # 200
curl -s -o /dev/null -w '%{http_code}\n' $BASE/api/reports/summary -H "Authorization: Bearer $TOKEN"  # 200
curl -s -o /dev/null -w '%{http_code}\n' $BASE/api/projects                                           # 401
# 3. customer PII round-trip: create one, confirm the API returns plaintext…
curl -s $BASE/api/customers -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -X POST -d '{"name":"QA Co","contact_email":"qa@co.com"}'
# …and the DB stores ciphertext (enc:…) when CUSTOMER_FIELD_KEY is set:
docker compose exec db psql -U app -d app -c "SELECT contact_email FROM customers WHERE name='QA Co';"
```

Also exercise: `/api/search?q=…` (PII substring match), the iCal feed-token flow
(`POST /api/auth/ical-token` → use it on `/api/calendar/ical?token=…`), bulk Excel
import, and the admin last-manager guards.

For a repeatable baseline check, run:

```bash
SMOKE_PASSWORD='<admin password>' ./deploy/smoke-test.sh
```

Use [`docs/SECURITY_OWASP.md`](SECURITY_OWASP.md) as the OWASP Top 10 release
checklist before promoting DEV to PROD.

## PROD promotion

PROD uses the same Docker/PostgreSQL architecture as DEV. Promote only the exact DEV
commit that passed verification:

```bash
git fetch origin
git checkout prod
git merge --ff-only dev
git push origin prod
```

If `prod` does not exist yet, create it from the verified DEV commit:

```bash
git checkout -b prod dev
git push -u origin prod
```

Then run `./deploy/deploy.sh prod` on the PROD box. To carry existing data over from
the old SQLite database, run the one-time migration from a full (non-`--omit=dev`)
install with the legacy `app.db` available:

```bash
cd server
DATABASE_URL=postgres://… node scripts/sqlite-to-postgres.js /path/to/app.db
```

It copies every table in FK-safe order preserving ids, resets the sequences, and is
re-runnable (ON CONFLICT DO NOTHING). Verify row counts per table and confirm a known
customer decrypts through the API afterward.

## Notes / known items

- pg-mem (used for local data-layer tests) can't parse Postgres `CREATE FUNCTION`
  bodies, so the authoritative schema + endpoint test is this Docker run. CI also runs
  the route integration tests and a schema/SQL check (`test/postgres.schema.test.js`)
  against a PostgreSQL 16 container on every push.
- The database user must be allowed to create functions in the `public` schema:
  startup runs `CREATE OR REPLACE FUNCTION` for `round(double precision, integer)`,
  `app_now()` and `app_today()`.
- The weekly-report module (`weeklyReport.js`) still references legacy status values
  (`active`, `done`, `pending_closure`) in a few aggregate queries — a pre-existing
  issue carried over from the SQLite version, not introduced by the migration. The
  feature is disabled by default; clean up the status vocabulary when re-enabling it.

## Staged operations platform changes

The current review branch is DEV-3. Startup applies additive database migrations
for recommendations, effort/availability inputs, saved reports and delivery schedules.
Keep encryption keys unchanged and back up retained database/files before updating.
Saved-report delivery reuses existing SMTP settings, starts disabled, and checks
current manager eligibility. Review UTC times, fixed date filters and delivery
outcomes in Reports before enabling schedules. No extra environment variables
are needed. See [PLATFORM_VALIDATION.md](PLATFORM_VALIDATION.md) for reproducible
browser smoke checks, validation scope and remaining staging acceptance.
