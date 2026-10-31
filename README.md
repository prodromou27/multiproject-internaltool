# TeamHub

An operations platform for engineering-services and managed-services (MSP) teams:
customers and their assets, contracts and licences, service activity logging, tasks,
projects, maintenance visits, reminders, workload and skills, SLAs, customer reports,
and a Webex/Teams chat bot, behind role-based access, Microsoft 365 sign-in and
optional two-factor authentication. Customer personal data and files are encrypted at rest.

- **Frontend:** React 19 + Vite single-page app (`client/`).
- **Backend:** Node 24 + Express API (`server/`), which also serves the built app.
- **Database:** PostgreSQL 16.
- **Production:** Docker Compose behind a Caddy proxy on HTTPS (443), or plain HTTP on 80 without a certificate.

## Help for people using the app

The app has its own help: **Help** in the menu (every topic, searchable, by role) and the
**?** button at the top (help for the page you are on). The chat bot answers `help` too.
The text lives in [client/src/help/helpContent.js](client/src/help/helpContent.js); update
it with any change people will notice.

## Documentation

| Read | For |
|------|-----|
| [docs/APP_OVERVIEW.md](docs/APP_OVERVIEW.md) | The full description: architecture, data model, sign-in and permissions, security, every feature module, background jobs, API, tests, limitations |
| [deploy/README.md](deploy/README.md) | The runbook: server setup (AlmaLinux), secrets, deploy, promoting DEV-3 to LIVE, HTTPS, backups, common operations |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Deployment in brief: stack, environment, verification checklist |
| [docs/STAGING_ACCEPTANCE.md](docs/STAGING_ACCEPTANCE.md) | What to check on DEV before promoting to LIVE |
| [docs/KEY_ROTATION.md](docs/KEY_ROTATION.md) | Rotating the encryption keys |
| [docs/SECURITY_OWASP.md](docs/SECURITY_OWASP.md) | OWASP Top 10 mitigations and the release checklist |
| [docs/PLATFORM_VALIDATION.md](docs/PLATFORM_VALIDATION.md) and [docs/PERFORMANCE.md](docs/PERFORMANCE.md) | What has been tested, with numbers, and what has not |
| [docs/OPERATIONS_PLATFORM_ROADMAP.md](docs/OPERATIONS_PLATFORM_ROADMAP.md), [docs/UI_KPI_MODERNIZATION_PLAN.md](docs/UI_KPI_MODERNIZATION_PLAN.md) | Earlier design plans, kept for their reasoning (historical) |

## Branches and releases

- **DEV-3** is where changes are made and tested; CI (`.github/workflows/ci.yml`) runs on every push.
- **LIVE** is production. It is only fast-forwarded to a DEV-3 commit that passed CI and was approved
  (`git checkout LIVE && git merge --ff-only origin/DEV-3 && git push origin LIVE`), then deployed
  on the server with `./deploy/deploy.sh prod`. See [deploy/README.md](deploy/README.md).

## Run it locally

You need Node 24 and a PostgreSQL database. For everything the tests cover you also need
OpenSSL on the `PATH` (the Microsoft sign-in tests make a certificate; Git for Windows
ships one), the PostgreSQL 16 client tools `pg_dump` and `psql` (in-app backups and their
tests; `PG_BIN_DIR` points to them if they are not on the `PATH`), and a disposable
PostgreSQL database in `TEST_DATABASE_URL` for the tests that skip themselves on the
in-memory database.

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

On first start with an empty database the server creates the manager account **admin**
(admin@company.com) with the password `admin`, or `ADMIN_PASSWORD` when set, and prints it
once. The password must be changed at the first sign-in.

## Tests

```bash
cd server && npm test                 # unit + route integration tests (in-memory Postgres)
cd server && TZ=UTC npm test          # the same in UTC, as CI and Docker run
cd client && npm test                 # unit tests
cd client && npx playwright test      # browser tests (Playwright, uses installed Chrome)

# Real PostgreSQL checks (a disposable database only):
cd server && TEST_DATABASE_URL=postgres://user:pass@localhost:5432/testdb npm test
```

With `TEST_DATABASE_URL` set, the integration tests run on the real database and the
PostgreSQL-only checks run too. CI also runs a list of suites, each on a fresh database
(the loop in `.github/workflows/ci.yml`): add a new suite that seeds its own data there.

## Repository layout

```
client/            React app: pages/, components/, help/ (in-app help text), styles/, e2e/ browser tests, dist/ (built, committed)
server/            Express app: routes/, schema/ (tables, migrations, seeds), activityBot/ (chat bot), shared modules, test/
deploy/            Deploy and bootstrap scripts, Caddy configuration, secrets, backup/restore/verify, smoke test, nginx and systemd examples
docs/              Documentation (see above)
scripts/           Standalone tooling (browser smoke runner)
Dockerfile, docker-compose*.yml
```

## Conventions worth knowing before you change code

- **SQL is native PostgreSQL** with `?` placeholders. "Now" is `app_now()`, "today" is
  `app_today()` (the organisation's time zone); in JavaScript use `appTime.today()`.
- **Schema changes** go in a new dated migration in `server/schema/migrations.js`
  (and the final-state table in `server/schema/baseTables.js` where it is defined there),
  so fresh and existing installs match.
- **Authorization is enforced on the server.** The client's role checks only decide
  what to show. The chat bot calls the app's API as the person writing, so the same
  rules apply to it.
- **`client/dist` is the built app and is committed**: production serves it as committed.
  After a client change run `npm run build` in `client/` and commit `client/dist` with it.
- **Colours are theme tokens** so dark mode works; do not hardcode light backgrounds.
- **People-facing changes** update the in-app help (`client/src/help/helpContent.js`).
