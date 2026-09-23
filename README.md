# TeamHub

An operations-management platform for engineering-services and MSP teams: projects,
tasks, maintenance visits, **service activity logging**, customer records (PII
encrypted at rest), workload and capacity planning, scorecards, SLA tracking,
reporting and administration, behind role-based access control and optional 2FA.

- **Frontend:** React 18 + Vite single-page app (`client/`).
- **Backend:** Node 24 + Express API (`server/`), which also serves the built app.
- **Database:** PostgreSQL 16.

## Documentation

| Read | For |
|------|-----|
| [docs/APP_OVERVIEW.md](docs/APP_OVERVIEW.md) | The full description: architecture, data model, authentication and authorization, security, every feature module, jobs, API, tests, limitations |
| [docs/DEPLOY.md](docs/DEPLOY.md) and [deploy/README.md](deploy/README.md) | Docker/Linux deployment, environment, backups, promotion from DEV to PROD |
| [docs/SECURITY_OWASP.md](docs/SECURITY_OWASP.md) | OWASP Top 10 mitigations and the release checklist |
| [docs/PLATFORM_VALIDATION.md](docs/PLATFORM_VALIDATION.md) | What has been tested, with numbers, and what has not |
| [docs/OPERATIONS_PLATFORM_ROADMAP.md](docs/OPERATIONS_PLATFORM_ROADMAP.md) | Design constraints and the delivery ledger |

## Run it locally

You need Node 24 and a PostgreSQL database.

```bash
# 1. Server: copy server/.env.example to server/.env and set DATABASE_URL,
#    JWT_SECRET (32+ characters), CUSTOMER_FIELD_KEY and ATTACHMENT_KEY (64 hex characters each)
cd server
npm install
npm run dev          # API on http://localhost:3001 when no TLS certs are present (PORT overrides);
                     # the schema is created on first start

# 2. Client, in a second terminal
cd client
npm install
npm run dev          # Vite dev server on http://localhost:3000; proxies /api to :3001
```

On first start with an empty database the server creates an `admin` manager account
and prints its password once; you must change it at first sign-in.

## Tests

```bash
cd server && npm test                 # unit + route integration tests (in-memory Postgres)
cd client && npm test                 # unit tests
cd client && npm run test:e2e         # browser tests (Playwright, uses installed Chrome)

# Real PostgreSQL checks (a disposable database only):
cd server && TEST_DATABASE_URL=postgres://user:pass@localhost:5432/testdb npm test
```

With `TEST_DATABASE_URL` set, the integration tests run on the real database and the
schema/SQL checks in `server/test/postgres.schema.test.js` run too. CI does this on
every push and pull request (`.github/workflows/ci.yml`).

## Repository layout

```
client/            React app (pages/, components/, styles/, e2e/ browser tests)
server/            Express app: routes/, db.js (schema + migrations), shared modules, test/
deploy/            Docker Compose helpers, backup/restore, smoke test, nginx and systemd examples
docs/              Documentation (see above)
scripts/           Standalone tooling (browser smoke runner)
Dockerfile, docker-compose*.yml
```

## Conventions worth knowing before you change code

- **SQL is native PostgreSQL** with `?` placeholders. "Now" is `app_now()`, "today" is
  `app_today()`. SQLite-only syntax fails a test.
- **Schema changes** go in both the final-state `CREATE TABLE` in `server/db.js` and a
  new dated migration tuple, so fresh and existing installs match.
- **Authorization is enforced on the server.** The client's role checks only decide
  what to show.
- **`client/dist` is committed build output;** do not edit it by hand or commit a
  local build. Browser tests build to `client/.e2e-dist` instead.
- **Colours are theme tokens** so dark mode works; do not hardcode light backgrounds.
