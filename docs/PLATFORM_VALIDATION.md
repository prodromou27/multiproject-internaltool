# Operations platform validation record

Reviewed through 2026-09-23 on DEV-3. This record covers the staged customer,
workload, reporting and administration changes; it is not a claim that every
screen or item in the redesign brief has been completed.

## Automated evidence

- Server suite: 108 passed locally; 21 PostgreSQL-specific checks skipped locally.
  CI runs those checks against PostgreSQL 16 as well as the in-memory backend.
- Client suite: 11 passed; production Vite build passed.
- Customer checks cover manager permissions, cross-customer links, source visits,
  recorded timeline pagination, mandatory recommendation history and atomic project
  conversion with stale/concurrent version protection. Asset checks cover technical
  identifier validation, manager-only access, duplicate tags, filters, encrypted-field
  round trips, version conflicts, deletion and retained customer history.
- Workload checks cover recorded estimates/availability, missing-data disclosures,
  configurable status factors, manager-only versioned policy edits, per-engineer
  visit effort, separate pressure components and concurrent input saves. Counts,
  logged hours and pressure points do not substitute for capacity.
- Report checks cover structural SQL restrictions, typed parameters, manager-only
  access, preview/export limits, Excel/CSV parity, formula escaping, saved-definition
  visibility/ownership/versioning and schedule recipient eligibility. Delivery
  tests stub SMTP; they send no real emails.
- Administration checks cover credential redaction, retaining/replacing/removing
  tokens, preserving SMTP passwords, rejecting malformed configuration and blocking
  loopback webhook URLs. HTML digest tests exercise stored-markup injection.
  Password-policy tests verify malformed values cannot disable expiry and explicit
  numeric zero remains supported.

### Update, 2026-09-21 (DEV-3)

Counts are from the CI run for commit `2dce978` (all checks passed).

| Suite | Result |
| --- | --- |
| Server, in-memory backend (`npm test`) | 137 tests: 114 passed, 23 skipped (need real PostgreSQL) |
| Server route integration tests on PostgreSQL 16 | 96 passed, 0 skipped |
| Schema and SQL check on PostgreSQL 16 | 3 passed: `init()` twice changes nothing and leaves no invalid index; about 550 static SQL statements accepted by PostgreSQL |
| Client unit tests | 14 passed |
| Browser tests (Playwright, mocked API) | 32 passed |

What the newer checks add:

- **Native SQL.** The SQLite-to-PostgreSQL rewriting was removed; `translate()` only
  converts `?`. A guard test fails on SQLite-only syntax, and the real-database
  statement check covered the rewritten queries.
- **Browser tests** cover sign-in and the signed-out redirect, task and visit lists, the
  page error boundary, the Activity Log form and team gating, dark-mode calendar
  colours, equal calendar columns, and that every Settings section and the Project
  page open without a missing reference. Two of them were checked to fail against the
  bugs they guard (a stray `0` printed for a false 0/1 flag; calendar columns
  stretched by long titles).
- **What they do not show.** The browser tests mock the API, so they prove the UI but
  not the API contract; statement checks prepare SQL but do not execute it; statements
  built with `${}` are not checked. Manual QA on staging data, real devices and screen
  readers is still pending, and mobile widths were not part of the 2026-09-21 visual
  review.

### Update, 2026-09-23 (DEV-3)

The workspace modernization series through commit `2c987ad` passed CI. Local final
validation reported 22 client unit tests and 43 Playwright browser tests passing.
The added browser coverage checks compact navigation, the operational dashboard,
shared project/task/visit list controls, customer service coverage filtering and
recovery, managed-customer health filters, report deep links and stale-report recovery.
The acceptance matrix also renders eight core workspaces at 390px in light mode and
768px in dark mode, rejects page-level overflow and runtime exceptions, and verifies
the skip link plus mobile-drawer focus isolation and restoration.
With this matrix included, the full production-build Playwright suite contains 60
passing checks; the client unit suite contains 22 passing checks.
The recommendation workflow includes scoped engineer/planner capture and task
conversion. Versioned role/user permission overrides cover managed services and
notification-rule administration; core modules retain their established role and
membership scopes.

## Reproducible browser smoke checks

The runner uses an installed Chrome/Chromium browser and Node 24's built-in
WebSocket client. It serves an isolated production bundle on loopback with
synthetic API responses. It does not connect to the app database, SMTP or webhook
services, install browser packages, or modify the user's browser profile.

From the repository root:

```powershell
npm.cmd run build --prefix client -- --outDir ../.tmp-client-build --emptyOutDir
node scripts/browser-smoke.cjs .tmp-client-build
```

Set `CHROME_BIN` if Chrome/Edge is not installed at a detected location. On Linux,
use `npm` in place of `npm.cmd`. The runner creates and removes its own temporary
browser profile; remove the temporary build directory after inspection.

Passed checks:

| Area | Evidence |
| --- | --- |
| Report Builder layout | No document overflow at 1440, 768 and 390 pixels |
| Saved definitions | Opens a valid definition omitting optional arrays; preview renders |
| Save dialog | Autofocus, Escape dismissal and focus restoration to the trigger |
| Schedule dialog | Shift+Tab wraps within the dialog; Escape dismisses |
| Settings | Mobile layout, Business/Technical navigation and root/deep links |
| Customer assets | Mobile inventory layout, add-dialog autofocus and coverage choices |
| Credential UI | Stored credentials remain absent from password input values |
| Switches | Native Enter activation changes the announced state |
| Failed metadata load | Visible error; Retry restores the builder |
| Role guard | Engineer cannot render the management Report Builder |
| Runtime | No uncaught browser exceptions during the matrix |

These checks caught and fixed a shared-modal focus-restoration defect: the trigger
must be recorded before child autofocus runs during the DOM commit.

## Deployment and remaining acceptance

Startup applies additive, transactional migrations for recommendations,
customer assets, workload planning inputs, saved reports and report schedules. Back up the database
and encrypted files before deploying. Keep the existing encryption keys; changing
them prevents decryption of retained data. Deploy the reviewed DEV-3 revision to
staging first and check `/api/health`. Saved-report schedules start disabled; their
delivery requires existing SMTP configuration and eligible recipients.

Scheduling uses UTC, monthly days 1-28, fixed saved date filters, atomic slot claims
and no automatic retry. Interrupted or failed slots may have partial delivery;
review their displayed outcome before changing/re-enabling a schedule.

Still pending:

- Full manual keyboard, responsive, dark-mode and screen-reader QA across all core
  screens using staging data; follow [STAGING_ACCEPTANCE.md](STAGING_ACCEPTANCE.md) and
  attach its release record. The synthetic matrix supports but cannot replace this pass.
- Remaining shared detail/calendar views and pagination of older large lists.
- Expansion of granular permission overrides beyond managed services and notification
  rules, with server enforcement and PostgreSQL route tests for every new capability.
- Further business/technical feature settings and a broader performance and deployment
  acceptance pass.
- Team/selected-user report sharing and relative date scheduling, if required:
  current definitions support private/management visibility and fixed date filters.

The delivery ledger remains in
[OPERATIONS_PLATFORM_ROADMAP.md](OPERATIONS_PLATFORM_ROADMAP.md).
