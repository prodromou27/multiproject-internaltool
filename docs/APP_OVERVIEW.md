# SolutionsHub — Application Overview

A code-grounded description of the application: architecture, data model, security,
and every feature module with notes on how each is handled.

> Last reviewed: 2026-09-21.

---

## 1. What it is

**SolutionsHub** is a full-stack operations-management platform for an engineering
services organization, including MSP (managed services provider) teams. It runs the
full lifecycle of client **projects**, field **maintenance visits**, **task**
execution, day-to-day **service activity logging** for MSP engineers, engineer
**workload** and **performance scoring**, **SLA** tracking, and a secure **customer**
database — behind role-based access control, 2FA, and field-level PII encryption.

## 2. Architecture & stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express |
| Database | **PostgreSQL** via the `pg` driver (see "Database dialect" note below — this is not obvious from reading route files in isolation) |
| Frontend | React 18 + Vite SPA (built to `client/dist`, served statically by Express) |
| Transport | HTTPS on port 443 (self-signed certs in `server/certs`), HTTP:80 → HTTPS redirect; falls back to HTTP:3001/8080 if no certs |
| Auth | JWT (stateless), bcrypt password hashing, TOTP 2FA |
| Config | Hand-rolled `.env` loader at startup (no dotenv dependency) |
| Deployment | Docker multi-stage build (`Dockerfile`) + `docker-compose.yml`/`docker-compose.prod.yml`, Postgres as a separate compose service |

**Single-process deployment:** Express serves both the JSON API (`/api/*`) and the
compiled React app (SPA catch-all). Unknown `/api/*` paths return a JSON 404 *before*
the SPA fallback so API misses don't return HTML.

**⚠️ Database access — read this before touching `server/db.js` or any route SQL.**
The app began on `better-sqlite3` and was later moved to PostgreSQL. `server/db.js`
keeps the old call shape as an async facade over a `pg` `Pool`
(`await db.prepare(sql).get/all/run(...params)`, `db.transaction(async tx => …)`), so
routes use `?` placeholders. **The SQL itself is native PostgreSQL.** The only rewriting
left is in `translate()`, which converts `?` to `$1, $2, …`; `run()` also appends
`RETURNING id` to a plain `INSERT` so callers get `lastInsertRowid` (skipped for
`ON CONFLICT`, an explicit `RETURNING`, and a hardcoded list of id-less junction
tables, `NO_ID_TABLE_RE` — add a new id-less table there).

Timestamps are `TEXT` (`YYYY-MM-DD HH:MM:SS`, UTC), so "now" and "today" come from two
SQL functions that `init()` creates: **`app_now()`** and **`app_today()`**. A month or
day prefix of a stored timestamp is `substr(col, 1, 7)` / `substr(col, 1, 10)`. Use
`string_agg`, `ILIKE` (case-insensitive search) and `ON CONFLICT DO NOTHING`; do **not**
write SQLite-only syntax (`datetime('now')`, `strftime`, `date(col)`, `GROUP_CONCAT`,
`INSERT OR IGNORE`, `LIKE ?`). `server/test/nativeSql.test.js` fails the build if any of
it comes back, and `server/test/postgres.schema.test.js` prepares every static SQL
statement against a real PostgreSQL server in CI, so a typo or renamed column fails
there instead of on the one screen that uses it. Keep using `?` placeholders in new
code, as all existing routes do.

`db.js` is also **self-migrating**: `init()` runs a full `CREATE TABLE IF NOT EXISTS`
schema (the "final state," so fresh installs get every column immediately) followed by
`applyCompatibilityMigrations()` — a hand-maintained, ordered list of
`[migration_id, sql]` tuples tracked in a `schema_migrations` table, each applied once
inside a transaction, for `ALTER TABLE ADD COLUMN IF NOT EXISTS` changes needed on
already-deployed databases. Both paths must be kept in sync when adding a column — see
existing migration tuples for the pattern. After schema/migrations, it seeds default
status configuration, service-activity lookups (categories/technologies), creates
performance indexes, and — if the `users` table is empty — seeds a first-run `admin`
manager account with a forced password change on first login.

### Layering and code layout

The app is a conventional **three-tier deployment**: a React SPA in the browser, an
Express API, and PostgreSQL. The browser talks only to `/api` (through
`client/src/api.js`); every permission is enforced on the server, and the client's
role checks only decide what to show.

Inside the API tier the code is **route-centred ("fat routes")**. Handlers in
`server/routes/*.js` hold input validation, business rules and SQL together; there is
no separate service or repository layer. Logic that several routes share lives in
modules at the top of `server/`:

| Module | Holds |
|--------|-------|
| `db.js` | pool, schema (`init()`), migrations, `prepare`/`transaction` facade, seeds |
| `serviceActivities.js` | Service Activity authorization helpers and the reference-number generator |
| `taskFilters.js`, `maintenanceVisitFilters.js` | shared list/export filter builders (list and Excel export stay identical) |
| `workloadModel.js`, `workloadPolicy.js`, `workloadPolicyStore.js` | capacity and pressure calculations and their configurable weights |
| `customReports.js`, `reportExecution.js`, `reportTemplates.js`, `reportAccess.js`, `reportSchedule.js`, `customReportScheduler.js` | the custom report engine, templates, scheduling |
| `reportScheduler.js`, `weeklyReport.js`, `notifications.js`, `email.js` | weekly digest, reminders, in-app/Teams/Webex/email delivery |
| `fieldCipher.js`, `cipher.js`, `uploadUtils.js`, `security.js`, `config.js` | PII/attachment encryption, upload validation, SSRF guard, startup config checks |
| `auditLog.js`, `integrationSettings.js`, `update-manager.js` | audit writes, integration settings, in-app update lifecycle |

Splitting routes into services and repositories would be a sizeable refactor; until
then, put logic that is reused by a second route into one of these modules.

### Frontend structure and UI system

```
client/src/
  App.jsx            auth context, layout, routes, command palette (Ctrl+K), quick create
  navigation.js      the page registry (path, roles, feature flags) used by the sidebar,
                     command palette and route guards; the server stays authoritative
  api.js             every request: cookie session, X-SolutionsHub-Request header,
                     401 handling, one wrapper per endpoint
  pages/             one lazy-loaded file per route
    admin/           Settings sections, one file per group (UsersTab, WeeklyReportTab,
                     StatusManagementTab, SystemTabs, ServiceActivityAdmin, ...)
    project/         parts of the Project page (TaskViews list + Kanban, GanttMilestones,
                     ScorecardTab, CustomFieldsTab, ProjectPrintView, Dialogs, ...)
  components/        Shared (Modal, badges, dates), PageLayout (PageHeader, PageState),
                     ErrorBoundary, Toast, Confirm, ServiceCharts, activityLedger,
                     OperationalFocus, ReportBuilder, ...
  hooks/             useStatuses, useLatestRequest (cancels superseded loads), ...
  styles/foundations.css   refinement layer loaded after index.css
```

- **Styling.** `index.css` defines the design tokens and shared classes; there is no
  component library (hand-built CSS plus `lucide-react` icons). **Dark mode** is the
  `[data-theme="dark"]` attribute, switched from the sidebar and remembered in
  `localStorage` (`hub_theme`). `styles/foundations.css` refines the shared building
  blocks (sentence-case labels, readable muted text, flat buttons, stat tiles, empty
  and error states, reduced-motion and touch-size rules); deleting it and its import in
  `main.jsx` restores the previous look. Feature CSS (`billingMix.css`,
  `ServiceCharts.css`, `ActivityLedger.css`, `ActivityForm.css`, `ServiceOperations.css`,
  `ServiceReport.css`) is scoped under its page class.
- **Colours must be theme tokens.** Status panels use `--danger-light`, `--warning-light`,
  `--success-light`, `--primary-light`, `--surface`, `--gray-*`, plus `--tone-*` (text
  on those panels) and `--cal-*` (calendar event types), which flip together in dark
  mode. Do not hardcode light hex backgrounds: they stay pale in dark mode.
- **Billing colours** (`--mix-included/billable/internal/other`) are validated for
  colour-blind separation and used only for the billing split in Service Activity charts.
- **Errors.** Each page renders inside an `ErrorBoundary` (in `PrivateRoute`): a render
  error shows a message with *Try again* and *Back to dashboard* inside the layout
  instead of a blank screen, and clears when the person navigates. A lazy page that
  fails to download after a deploy offers *Reload*.
- **Numeric flags.** The database returns `0`/`1` for flags such as `report_sent`,
  `is_adhoc` and `is_blocked`. In JSX write `!!row.flag && <X />`; `row.flag && <X />`
  prints a literal `0`.

---

## 3. Data model (core tables)

- **users** — name, email (unique, optional), bcrypt password, role, active flag,
  avatar, TOTP secret/enabled/exempt, `must_change_password`, `password_changed_at`,
  `token_version` (bumped to invalidate outstanding JWTs on sensitive changes)
- **teams** / **team_members** — MSP/engineering team grouping with a
  `service_activity_enabled` flag gating the Service Activity Tracking module per team;
  many-to-many membership via `team_members`
- **projects** — title, description, status (free-text, config-driven), priority,
  deadline, `customer_id`, `completion_pct`, `rag_override`, closure tracking,
  `pending_from_customer`
- **tasks** — project link (nullable for ad-hoc), title, status, priority,
  `assigned_to`, `is_adhoc`, deadline
- **task_dependencies**, **task_comments**, **task_custom_values**
- **customers** — name + encrypted PII fields (name, contact name/email/phone,
  address, notes, primary_contact, location, service_notes — **encrypted**, see §6);
  plus service-tracking fields: `customer_code`, `active`, `service_activity_enabled`,
  contract fields (`contract_type`, `contract_start_date`/`end_date`,
  `reporting_frequency`, `included_hours`, `contract_hour_period`), and per-customer
  activity-logging requirement toggles (`require_duration`, `require_ticket_reference`,
  `require_technology`, `require_category`, `require_notes`,
  `require_billable_classification`)
- **customer_teams** / **customer_engineers** — many-to-many customer↔team assignment,
  plus an optional explicit customer↔engineer allowlist for tighter restriction
- **customer_assets** / **customer_asset_history** — manager-maintained customer
  inventory for gateways, hosts, servers and other equipment. Records include asset
  identity, vendor/model/serial, hostname/IP/MAC, software or firmware version,
  location, environment, criticality, lifecycle, technology, support/warranty dates,
  and an explicit Managed / Under support / Neither coverage classification. Sensitive
  technical text uses the customer field-encryption key; normalized asset-tag hashes
  enforce per-customer uniqueness without exposing tag values. Updates use versions.
  Managers can attach support documents, diagrams, configuration exports, and warranty
  records. Asset files use signature validation and optional AES-256-GCM encryption at rest.
  **service_activity_assets** and **maintenance_visit_assets** link the exact equipment
  serviced to activities and planned visits with database-enforced customer consistency;
  linked equipment is retained for operational history and must be retired or
  decommissioned instead of deleted.
- **maintenance_visits** + **maintenance_visit_engineers** (many-to-many) —
  scheduled date, dual report-sent tracking (internal + to-customer)
- **kpis**, **project_milestones**, **project_scorecards**, **project_custom_fields**,
  **project_status_updates**, **project_activity**, **project_templates** /
  **project_template_tasks**, **user_project_pins**
- **activity_categories** / **activity_subcategories** — admin-managed lookup for
  service activity classification, with a `require_attachment` flag per category
- **technologies** — admin-managed lookup (Firewall, M365, Intune, WAF, PAM, …), shared
  by service activities and customer assets
- **service_activities** — the core MSP operations-log row: human-readable
  `activity_reference` (`ACT-YYYY-NNNNNN`, unique), customer/team/engineer FKs,
  date/time/duration, category/subcategory, title/description, status, priority, work
  location, billable classification, ticket/case references, follow-up fields,
  optional links to an existing project/task/maintenance visit, an optional
  "Change Details" block (change type/reason/previous-new state/risk/rollback/approval,
  shown only for Configuration/Security Change categories), and audit columns
  (`created_by/at`, `updated_by/at`, `completed_at`)
- **service_activity_technologies** — many-to-many activity↔technology tagging
- **time_logs**, **personal_notes**, **personal_todos**
- **notifications**, **audit_log**, **password_reset_tokens**, **settings** (generic
  key/value JSON store — used for `status_config` and `service_activity_settings`),
  **attachments** (encryption IV/tag columns; links to *either* `project_id` *or*
  `service_activity_id`, both nullable — see §11 for why this isn't a clean
  polymorphic design)

## 4. Authentication & session handling

**Login** (`POST /api/auth/login`):
- Email is normalized (`trim().toLowerCase()`) to match stored form; password compared
  with asynchronous `bcrypt.compare` (constant-time even on "user not found" to avoid a timing
  oracle).
- Deactivated accounts are rejected (403); `last_login` is stamped.
- Password expiry is checked (configurable, default 90 days) — sets
  `must_change_password` if elapsed.
- If TOTP is enabled (and not exempt), returns a **5-minute partial token** and
  `requires_2fa: true` instead of a session token.
- Otherwise returns a **24-hour JWT** (`{id, name, email, role, token_version}`) plus
  `must_change_password` / `password_expired` flags.

**JWT** is signed with a module-private secret (`JWT_SECRET` from `.env`; in production
the server refuses to start without one ≥32 chars; in dev it falls back to a random
per-process secret). The secret is never exported. Every authenticated request
re-fetches the user and compares `token_version`, so role/password/active-status
changes invalidate all of that user's outstanding tokens immediately rather than
waiting up to 24h.

**Browser sessions** use a 24-hour `HttpOnly`, `SameSite=Strict` cookie scoped to
`/api`; HTTPS deployments (`APP_URL=https://...`) also set `Secure`. The browser
loads its current identity from `/api/auth/me` rather than trusting saved user data.
State-changing cookie requests require `X-SolutionsHub-Request: 1` and reject
untrusted origins. Logout clears the cookie and revokes the user's current sessions.
Bearer tokens remain supported for API clients, and login responses retain the
token for compatibility. Required password changes are enforced by the API,
including downloads, and resume after a browser reload.

**2FA (TOTP)** via `speakeasy` + `qrcode`:
- `/2fa/setup` generates a secret, stores it, returns only the QR data-URL (raw secret
  never sent in a response).
- `/2fa/enable` verifies a code before flipping `totp_enabled`.
- `/2fa/verify` (login step) re-checks the account is still active, enforces **replay
  prevention** (a used code is rejected for ~90 s via an in-memory map), then issues
  the full token.
- `DELETE /2fa` disables 2FA, requiring the current password.

**Password management:**
- `change-password` (requires current password, min 12 chars), `change-password-first`
  (for forced changes — no current password needed since the user just authenticated),
  and a **forgot/reset** flow using a SHA-256-hashed, 1-hour, single-use token emailed
  as a reset link. Forgot-password always returns identical responses to prevent
  **account enumeration**, and counts successful responses toward its rate limit.
  New passwords must contain at least 12 characters and at most 72 UTF-8 bytes
  (bcrypt's input limit). Password hashing is asynchronous, password changes reject
  stale sessions, and reset tokens are consumed atomically so concurrent requests
  cannot reuse a link.

**Download tokens:** file-download links that must put a token in a URL use a dedicated
60-second scoped token (`download: true` claim) so the 24h session JWT never lands in
proxy/access logs.

## 5. Authorization (roles + team scoping)

Four roles: **manager**, **planner**, **pm**, **engineer**. Enforced by middleware
(`requireAuth`, `requireManager`, `requireManagerOrPlanner`) plus per-route ownership
checks:

- **Manager** — full access; only role that reaches `/api/admin/*`, reports,
  scorecards, workload, audit, and Service Activity Tracking admin settings.
- Customer recommendations are visible to managers and planners, and to engineers
  with an assigned project, visit, customer, or customer team. Planners and engineers
  may author recommendations; non-managers edit only their own records. Task
  conversion requires an existing project for the same customer, an active engineer,
  and for engineer callers, their own assignment to that project.
- **Planner / PM** — broad project visibility (scoped to assigned projects for some
  views); **no task list visibility** (`GET /tasks` returns `[]`); cannot edit tasks.
- **Engineer** — sees only their own assigned tasks, visits, and the customers tied to
  them; can update only their own tasks, log time only to their own work, create tasks
  only on projects they're a member of, and view only their own scorecards.

Data isolation is enforced at the **SQL level** (engineers' customer/visit/task queries
are filtered by `project_assignments` / `maintenance_visit_engineers` membership), not
just hidden in the UI.

**Service Activity Tracking module** adds a second, orthogonal scoping axis:
**team membership**, independent of role. An engineer only sees the module (nav, route,
API) if they belong to ≥1 team with `service_activity_enabled = true`
(`requireServiceActivityAccess` middleware on every route in
`routes/serviceActivities.js`); managers bypass this check entirely. Within the module,
an engineer may only act on a customer that is (a) active, (b) has service tracking
enabled, (c) is assigned to a team the engineer belongs to, and (d) — if the customer
has an explicit `customer_engineers` allowlist — includes that engineer. All four
conditions are re-verified server-side on every create/update
(`isCustomerAuthorizedForEngineer` in `server/serviceActivities.js`); `engineer_id`/
`team_id` are **always derived from the authenticated session**, never trusted from the
request body. This module deliberately does **not** introduce a granular
permission-table system (e.g. `ServiceActivity.ViewOwn`) — it reuses the existing
role+membership pattern rather than adding a second authorization paradigm. See §11 for
the tradeoff.

**Admin safety guards:** the system cannot be left with zero admins — demoting,
deactivating, or deleting the **last active manager** is blocked; self-deactivation and
self-deletion are blocked; deleting a user who authored records, or a **customer with
logged service activity** (`ON DELETE RESTRICT`), returns an actionable 409 (suggesting
deactivation) instead of a raw FK error.

## 6. Security mechanisms

- **Customer PII encryption** — AES-256-GCM field-level encryption (`fieldCipher.js`)
  on customer columns (name, contact name/email/phone, address, notes,
  primary_contact, location, service_notes), stored as `enc:<iv>.<tag>.<ciphertext>`,
  fresh random 96-bit IV per write, key memoized from `CUSTOMER_FIELD_KEY`. Transparent
  decrypt on read across customers, projects, maintenance-visits, service-activity, and
  search routes. Backward-compatible plaintext passthrough; an idempotent backfill
  script (`scripts/encrypt-existing-customers.js`) encrypts legacy rows.
  **Caveat**: because `customers.name` is encrypted, it can't be matched with SQL
  `LIKE`/`ILIKE` — routes that need to search by customer name decrypt-and-filter in
  the application layer instead (see `search.js`'s `matchingCustomerIds()` /
  `searchCustomers()`, and the duplicate-name check in `customers.js`). This means
  **every** customer row is decrypted on every create/update (to check name
  uniqueness) and on every name-search — see §11 for the scaling concern.
- **Attachment encryption** — uploaded files encrypted at rest (AES-GCM via `cipher.js`)
  with IV/tag stored per row; decrypted in-memory on download. Shared, factored-out
  validation (`server/uploadUtils.js`: MIME allowlist, magic-byte content sniffing,
  safe filename handling) is reused by both the project-attachment and
  service-activity-attachment routes.
- **Helmet** — CSP (no inline scripts, no framing), HSTS when TLS present,
  `X-Content-Type-Options: nosniff`.
- **Rate limiting** — 20 failed attempts/15 min on all auth endpoints (successful logins
  not counted); 10 imports/5 min on bulk-import endpoints.
- **CORS** — same-origin only by default (`origin: false`), opt-in via `ALLOWED_ORIGIN`.
- **Upload hardening** — MIME allowlists (SVG excluded to block XSS), size caps (2 MB
  avatars, 20 MB attachments, 10 MB imports), forced `Content-Disposition: attachment`
  for non-avatar files.
- **Path-traversal guards** — downloads use `path.basename` + equality check; download
  filenames sanitized against header injection.
- **SSRF guard** (`security.js`) — webhook URLs validated against
  private/loopback/link-local/metadata ranges for both IPv4 and IPv4-mapped/compatible
  IPv6 literals (the IPv6 branch delegates to the same range check as IPv4 rather than
  maintaining a second prefix list).
- **SQL injection** — fully parameterized; the only string interpolation into SQL is
  generated `?` placeholder lists and static fragments.
- **Global error handler** — Express 4 async handlers are wrapped by
  `express-async-errors`, so rejected promises reach the error handler instead of
  terminating the process. Production responses contain a generic message.

## 7. Feature modules

### Dashboard
The dashboard now starts with a role-scoped operational focus panel: overdue work,
due tasks, closure requests, pending visit reports, due service follow-ups and
upcoming commitments. Manager totals span the organization; engineer totals and
sample items use their assignments/ownership. Planner and PM dashboards retain
their existing views. Existing customizable widgets remain available below it.
`GET /api/operations/overview` is manager/engineer-only, accepts a validated optional
`as_of=YYYY-MM-DD`, and caps each attention/commitment list at five rows. Counts
use server aggregates rather than the sample rows. Weekly service counts, hours
and distinct customers include all matching records, not just a list page.
Follow-ups include earlier activities, exclude cancellations and completed linked
tasks, and remain pending after activity completion until resolved. Disabled
engineer teams receive no service-activity totals. My Work reuses this overview
and retains its timer, timesheet, Kanban, notes, reminders and bookmarked projects.
Partial load errors stay visible; stale refreshes cannot overwrite newer results.

Aggregated health: active projects, open/overdue tasks, this-week visits, KPI bars,
recent `project_activity`. Engineers see only their own scope.

### Projects
Project/task lists show retryable loading failures and cancel superseded reads.
Project detail applies only the latest request, clears forms and child data on
project navigation, and prevents rendering the previous project under a new URL.
Missing/forbidden projects have explicit states; refresh failures remain visible.
Refresh callbacks captured before a project or role change are ignored before
they can cancel a new load or start an old one.
Detail and timeline reads validate positive safe-integer project IDs before SQL.
Milestones load in the guarded detail batch, so failures cannot silently appear as
an empty timeline. No migration, configuration or background job is required.

Full lifecycle with config-driven statuses (`not_started → in_progress →
waiting_customer/vendor → on_hold → pending_approval → closed/cancelled`, plus
delayed/reopened). Features: priority, deadline, **computed RAG status** (deadline
proximity + overdue-task ratio, overridable by manager), `completion_pct` (manual or
derived from task completion), member assignment, status updates, activity log,
milestones, KPIs, custom fields, task dependencies, attachments, Excel import,
templates, and a **closure-approval workflow** (request → manager approves/rejects).
Project detail decrypts the linked customer's contact fields for display.

The project page (`pages/ProjectDetail.jsx`, with its parts in `pages/project/`) offers
the task list and a **Kanban** board (drag a card to change status), a **Gantt**
timeline with milestones, manager-only **KPIs** and **Scorecard** tabs, **Custom
fields**, **Attachments**, task detail modals (comments, dependencies, time
logs, waiting-on-customer reasons), Excel task import, task duplication, and a
print-friendly project summary.

Project creation saves memberships in the same transaction. Closure requests and
approvals save their status and update message atomically, and conditional writes
prevent duplicate lifecycle updates from concurrent requests. Project dates and
member lists are validated; deadlines can be cleared, and pinning respects project
visibility.

Manager role changes, account activation and deletion serialize within a transaction
and re-check the acting manager's session before enforcing the last-manager guard.
Admin user inputs validate types and bcrypt's 72-byte password limit; hashes are
computed asynchronously, duplicate emails return 409, and optional emails can be cleared.

### Closure approvals
Ordinary project edits cannot enter or leave pending approval: use the closure
request and review controls. Metadata remains editable while awaiting review.
Updates guard the current status and closure request version, returning HTTP 409
if a closure transition occurred while an edit was being saved.

Project closure reviews now have a dedicated manager-only `/approvals` page and
paginated `GET /api/projects/approvals` API. Rejection uses
`POST /api/projects/:id/reject-closure` with a required `comment` (at most 2,000
characters), saving reopening, reviewer metadata, status history and assigned-user
notifications in one transaction. Requests record their actor and increment
`closure_request_version`; both review endpoints accept `request_version` to reject
stale reviews. The browser sends this version. The approval endpoint still accepts
older clients that omit it. Review actors and comments are available through the
existing scoped project detail API; prior decision cycles remain in project history.
Migration `20260917_project_closure_review` adds six nullable/defaulted fields and
preserves existing projects. Legacy request actors remain unknown rather than guessed.
An index on `(status, closure_requested_at, id)` supports the backlog. No new
environment variables or background jobs are required.

### Tasks
The Tasks screen uses 25-row server pages with stable global sorting and debounced
search. Tab counts cover the full owner/search/priority scope, rather than just the
current page. Filters and sorting reset the page; deleting the last page's contents
returns to a valid page. Bulk selection applies to this page and clears on reload.
Excel export includes every matching task, independent of pagination, in server
sort order. Logged-hour/dependency enrichment is limited to returned rows. Reference
lists are cached per account/role and refreshed by Refresh. Providing `page` or
`page_size` to GET `/api/tasks` returns `{rows,total,counts,page,page_size}`; page
size is 1–100. Omitting pagination preserves the array API used by project details
and My Work. Both reads and export reject malformed pagination; export ignores
valid page limits. No migration, configuration or background job is required.

Task list and Excel export share parameterized filter validation for status views,
priority, literal title/assignee/project search, project and assignment IDs, local
as-of dates and whitelisted sorts. Engineer ownership is always enforced, including
when another assignee ID is supplied. The UI exports its current filters. Due Today
and Pending Approval are explicit views; Due Next 7 Days includes today through
today plus six calendar dates. Dashboard links and changed filter URLs select the
correct views; overdue projects excludes pending closure review. Logged hours load
in one scoped batch. No migration, configuration or background job is required.

Task comments and dependencies enforce current task visibility for every read or
mutation, including comment deletion after reassignment. Engineers receive a
restricted dependency placeholder and blocking indicator for another owner's task,
without its title, deadline, priority or detailed status. Managers retain full
dependency details. Mention notifications are limited to active managers and the
task's current engineer assignee, and link to Tasks. Relationship IDs are validated;
missing dependency targets return 404 and database failures use safe server errors.
No schema, configuration or background-job changes are required.

Per-project or ad-hoc. Statuses validated against an enum; priorities
low/medium/high/critical. Supports comments with **@mention notifications**,
dependencies with a **transitive cycle check** (BFS) and `is_blocked` computation,
duplication, bulk status/delete (≤500 IDs, role-scoped), time logging, and Excel
export. Bulk edits enforce the same manager/engineer boundary as individual edits.
Bulk status changes use one atomic update, check engineer ownership at write time,
and return the actual number of unique matching tasks. Waiting reasons can be
submitted for the entire batch; legacy requests that omit a reason retain existing
notes. Leaving a waiting status clears its note. Task and project waiting dialogs
retain drafts and display errors on failed saves, and prevent duplicate submissions
or dismissal while saving.
Managers can clear an assignee or deadline; task inputs validate text, dates and
references, and new assignments require an active engineer.
Task time logs follow task visibility (manager or assigned engineer); maintenance
visit logging retains planner/PM access. Aggregate hours are restricted to the
current user unless requested by a manager. Time log IDs, hours and date filters
are validated before querying or storing data.
Engineers self-assign and are confined to their own tasks and member projects.

### My Day timer
The engineer timer is stored per user and validates saved values before resuming.
Saving disables further submissions; failed saves keep the timer available to retry.
Timers exceeding the 24-hour entry limit require manually logging the correct hours.
A confirmed Discard action clears a timer without recording time. Legacy shared
timers are not resumed because their owner cannot be determined safely.

### Customers
The Customer 360 action extends the existing service profile. Its manager-only
overview API returns capped project, project-linked task, visit and document
sections with full counts, plus a 25-event paginated customer timeline. Events use
recorded creation, project history, document upload and current report timestamps;
completion dates are not inferred from general update timestamps. Ad-hoc tasks
are excluded because they have no customer relationship. Document storage names,
encryption metadata and private notes are not exposed. Existing service activities,
charts and contract-hour views remain available through a separate section.
CRM-lite with encrypted PII, service-contract fields (see §3), and team/engineer
assignment. Validates text, finite non-negative included hours, and contract date ranges.
Partial edits preserve omitted contract values and allow explicitly clearing
optional contract fields.
Excel import (≤5,000 rows, duplicate detection by normalized
name, downloadable template). Engineers see only customers linked to their work
(project/visit assignment for the legacy modules; team/engineer assignment for Service
Activity Tracking).

### Maintenance Visits
Customer recommendations are persisted separately from report text. Managers can
record findings from visit details or Customer 360, set risk, owner, due date,
status and follow-up notes, and convert a recommendation into a customer-linked
project. Conversion carries the finding, recommendation, due date and active
engineer owner assignment. Version checks reject stale edits; conversion, project
creation and mandatory recommendation history save in one transaction. Customer
timeline includes recommendation history. Lists use 25-row pages and bounded
reference choices. Existing inactive owners can be retained on edits.
Migration `20260918_customer_recommendations` adds recommendation/history tables
and indexes without changing existing records. Composite foreign keys prevent
source visits and converted projects from moving to another customer or being
deleted while referenced. Customer deletion preserves recommendations; close
records rather than deleting history. The initial recommendation workflow is
manager-only; engineer/planner capture and task conversion are subsequent work.
Multi-engineer scheduled visits with **dual report tracking** (internal `report_sent` +
`report_sent_to_customer`), each with timestamp and actor. Inputs validate text and
real calendar dates; visit creation and reassignment
save the visit and engineer set atomically. Report submission preserves its first
actor/timestamp, undoing the internal report clears downstream forwarding metadata,
and cancelled visits cannot be reported, forwarded or completed.
Month loads cancel superseded requests and guard account/role scope; failed loads
show Retry and hide stale rows and counts. Workflow actions catch errors and prevent
duplicate submissions; notes remain editable after a failed save. Internal report
submission undo is manager-only, while managers and planners may undo forwarding.
Visit titles provide keyboard-accessible detail buttons. Upcoming/past views use
the browser's local date; dashboard filter links update an already open list.
Excel export uses the same month, status view, literal customer/title/engineer
search and local as-of date as the list, with stable date/ID ordering. Both endpoints
validate single-valued filters, safe positive IDs, real dates/months and 0/1 flags;
zero-valued flags do not activate filters. Month selection uses a date range.
Existing calls without filters still return all authorized visits; manager/planner
export permissions remain unchanged. Customer-name search follows authorization
and decryption because customer names are encrypted at rest.
Excel import/export, time logging, **automated next-day email reminders** (fired daily at 08:00, deduplicated per
visit/user/day), and a per-engineer **iCal subscription feed**.

### Service Activity Tracking (MSP Operations Log)
Attachment uploads propagate asynchronous failures to the central error handler and
remove uploaded files when encryption or database storage fails. Attachment deletion
removes its database row before deleting the file, preserving downloads if the
database operation fails. Activity detail loads support cancellation and visible Retry
actions instead of an endless loading state.

Managers have module-wide access. Engineers and PMs require an enabled team and
may read only their own activities; customer authorization is rechecked on writes.
Planners have no tracking access, even through an enabled team. Follow-up task
creation is limited to manager/engineer roles, matching Tasks permissions.
Quick Log exposes customer-required fields and expands required details before
saving. Edit fetches the complete activity so summary rows cannot erase its notes,
category or technology selections. Payload validation includes follow-up dates,
24-hour time values, reference IDs, boolean flags and bounded text fields.

Lets engineers on enabled teams log day-to-day operational work (support, maintenance,
upgrades, config changes, monitoring, customer meetings, etc.) against authorized
customers, for engineer/customer/team-level history and MSP reporting.

- **Activity Log** (`/activity-log`) — engineer-facing list with Today/This
  Week/This Month/custom-range presets, customer/category/status/technology/billable
  filters, search, server-side pagination, and row actions: view, edit, duplicate
  (copies customer/category/title/etc., resets date to today and status to the
  default, does **not** copy duration/status/attachments/audit metadata), mark
  complete, create follow-up task. Search is debounced, superseded list requests
  are cancelled, out-of-range pages are corrected, and failed loads show a Retry
  action rather than an empty list.
- **Quick Log form** — primary fields (customer, date, category, title, duration,
  status, notes) up front; a collapsible "More Details" section for
  subcategory/technology/times/location/ticket/billable/related-entity/follow-up
  fields; a further collapsible "Change Details" section that only appears for
  Configuration/Security Change categories. Client-side validation mirrors the
  server's.
- **Reference numbers** — `ACT-YYYY-NNNNNN`, allocated inside the create transaction
  by an atomic per-year counter in `service_activity_sequences`, initialized from
  existing references on upgrade. Concurrent creates cannot collide, and deleted
  references are not reused. This module is the first place in the codebase to
  introduce human-readable reference numbers (everything else uses raw DB ids).
- **Categories/subcategories/technologies** — admin-managed lookups (22 seeded
  categories, 12 seeded technologies), each category optionally requiring an
  attachment before an activity in it can be marked Completed (checked at the
  Completed-transition point, not at creation — see §11 for why).
- **Customer-specific rules** — per-customer toggles requiring duration, ticket
  reference, technology, category, notes, and/or billable classification, enforced
  server-side on create and on the merged state of partial updates. Updates also
  recheck customer authorization and validate retained related-entity links; activity
  fields and technology assignments are saved in one transaction.
- **Follow-up tasks** — "Create Follow-Up Task" reuses the existing Tasks module
  (creates a real `tasks` row, links it back via `related_task_id`) rather than
  duplicating task data. The dedicated `follow_up_task_id` preserves independently
  selected related tasks and allows ad-hoc follow-ups without invalid project links.
  Row locking makes repeated/concurrent follow-up requests return the existing task.
- **Contract hour tracking** — for customers with `included_hours` +
  `contract_hour_period` set, `GET /customers/:id/contract-hours` sums
  "Included in Contract"-classified activity minutes for the current monthly/annual
  period and returns consumed/remaining hours, shown as a progress bar on the
  Customer Service Profile page.
- **Customer Service Profile** (`/customers/:id/service-profile`, manager) — activity
  timeline, summary tiles, and category/engineer/technology/billable breakdown charts
  for one customer, with the same filter set as the main list.
- **Engineer dashboard card** — Activities Today/This Week, hours logged, customers
  worked on, follow-ups pending, recent activities; shown on `/my-day` only when the
  engineer has ≥1 enabled team.
- **Service Operations dashboard** (`/service-operations`, manager) — month-to-date (or
  custom range) totals, customer-facing vs. internal hours, and activities-by-team/
  engineer/customer/category/technology charts.
- **Reports** (`Reports` page, "Service Activity" tab) — Customer, Engineer, and Team
  activity reports (filterable, with summary + Excel export), plus a **Monthly MSP
  Service Report** mode (customer + month picker, computes the month's date bounds
  and reuses the customer-report endpoint with a formatted header).
- **Admin settings** (`Settings → Service Activity Tracking`) — team creation/
  membership/enablement, category/technology management (with per-category
  require-attachment toggle), and module-wide settings (`allow_attachments`,
  `allow_follow_up_task_creation`, `retention_days` — enforced server-side, e.g. the
  attachment-upload and follow-up-task routes 403 when disabled). Retention is a
  **manual, audited** purge action (shows how many activities are past the cutoff, a
  manager clicks to delete them) — deliberately not an automatic background job.
- **Audit trail** — activity create/update/status-change/customer-change/billable-
  change/complete/follow-up-created/attachment-upload/delete all call the existing
  `logAudit()` helper, same convention as every other module.

### Calendar
Month and agenda views include unresolved service follow-ups on their follow-up
dates. Managers see all; enabled engineers/PMs see their own; planners and disabled
teams receive none. Cancelled activities and follow-ups linked to terminal tasks
are excluded, while completed activities can still have pending follow-ups.
Task/project events honor configured terminal statuses. Activity links open the
existing authorized detail modal through a consumed `?activity=<id>` URL intent.
Pending completed/in-progress visit reports appear on the visit date, explicitly
labelled as such because there is no report deadline field. Report/follow-up entries
cannot be dragged to reschedule. Agenda lists every filtered event in the month,
including events beyond the grid's three-per-day preview. This extends the browser
month feed only; the existing iCal feed is unchanged.

The month feed validates real months (1900–9998) and uses the existing module
visibility rules: engineers see their assignments, planners see visits, and PMs
read projects and visits without tasks. The browser cancels superseded loads,
shows retryable failures, and uses local dates for Today. Events open in the shared
accessible modal; PMs have no report submission action. Schedule changes are
serialized in the UI and failures reload the current month instead of restoring
a stale snapshot. No migration, environment setting or background job is required.

Month view (`?month=YYYY-MM`) unifying task deadlines, project deadlines, and visits —
each role-scoped (engineers see only their own; planners/PMs see visits within their
projects).

### Workload (manager)
The Effort and Availability section records remaining task/visit estimates and net
weekly engineer capacity with version checks and audited edits. Migration
`20260918_workload_planning_inputs` adds estimate/availability tables. The four-week
view uses UTC Monday buckets based on an explicit local planning date; overdue
outstanding work goes into the first week. Visit estimates are per engineer,
including multi-engineer visits. No default hours or unknown effort are fabricated.
Missing effort/availability or zero capacity yields an unavailable percentage.
Counts include every selected item even when the per-week detail list is capped
at 50. Dataset budgets reject oversize reads instead of returning partial totals.
This initial capacity view excludes reports, service follow-ups and undated/future
work explicitly; broader coverage and configurable weighting remain pending.
Per-engineer snapshot (open tasks, upcoming visits, tasks done this month, hours logged
this month) plus a **4-week scheduled-item forecast** grid. Both are heavily batch-queried (4
and 2 queries respectively) to avoid N+1.

**Operational pressure** (`/api/workload/pressure`, manager-only, the first tab) ranks
engineers by weighted open work as of a date. Each open item scores *base × status
weight*, plus a bonus if it is overdue or due within seven days. The base is the task's
priority weight (low/medium/high/critical), or the pending-report or service-follow-up
weight; a visit counts 1. Status weights (up to 100 per work type, for example
`waiting_customer` 0.25) come from the policy. Each engineer's result carries total
points, a breakdown by task/visit/report/follow-up, and counts of overdue and undated
items. Pressure is a ranking signal, not capacity: it never substitutes for the hours
in Effort and Availability. The weights are one versioned row in `workload_policy`
(`GET/PUT /api/workload/pressure/policy`); saves are audited, validated (unknown keys
and prototype names rejected) and return HTTP 409 `WORKLOAD_POLICY_CONFLICT` if the
version moved.

### Scorecards (manager)
Post-project engineer evaluation across 5 weighted dimensions — delivery quality (30%),
communication/ownership (20%), customer feedback (20%), timeline (15%), documentation
(15%) — each 1–5. A **difficulty multiplier** (0.90–1.10) yields an adjusted score
capped at 100, mapped to a rating band (Exceptional ≥90 … Performance Concern <60).
Includes a "pending projects" view (closed/completed projects with unscored engineers),
per-engineer summaries, and trend history. One scorecard per engineer per project
(unique constraint).

### SLA (manager)
Computed live (`/sla/overview`) across four SLAs using **working-day** math: MV report
completion (7 working days), project status-update cadence (7 calendar days),
high-priority task first response (1 working day), and closure-approval turnaround
(3 working days). Each item is classified on-time / at-risk / breached / late-complete.

### Time Logs
Hours logged against a task or visit (positive, ≤24/entry), with strict ownership checks
on read/write and manager-only deletion of others' logs. Monthly summaries per user.

### Reports (manager)
The custom report engine at `/api/reports/custom` exposes approved source/field
metadata and manager-only preview/Excel execution for projects, tasks, visits,
service activities and recommendations. Definitions use registry keys rather than
SQL identifiers. Typed parameterized filters, explicit source grain, grouping,
numeric aggregations and stable sorts are validated before execution. Metadata
excludes credentials, private notes, customer contact PII and integration secrets.
Previews return at most 100 rows with an explicit truncation flag. Excel exports
reject results exceeding 5000 rows; execution runs read-only with a five-second
statement timeout. The Reports page includes a Report Builder with approved field
selection, typed filters, grouping, aggregation, stable sorts and a bounded preview.
Excel and UTF-8 CSV exports apply the same definition and reject over 5000 rows;
CSV escapes cells and protects against spreadsheet formula interpretation.
Migration `20260918_saved_custom_reports` stores versioned private or management-shared
definitions. Only their owner can modify/delete them; managers recheck visibility
on every saved run, and stale edits return HTTP 409 `REPORT_CONFLICT`.
Eleven report templates load editable definitions through the same engine for monthly
activity, engineer/team/customer summaries, service time, projects, overdue projects,
visits, pending reports, recommendations and approval backlog. Dates are explicit
UTC snapshots; saved copies retain their date filters. Overdue projects exclude
configured terminal states. Capacity reporting links to the dedicated workload
model. Saved-report delivery extends `reportScheduler.js` with a minute poll and additive
migration `20260918_custom_report_schedules`. Owners configure daily, weekly or
monthly UTC times (monthly days 1-28) and up to 20 active manager recipients.
Private reports may reach only their owner. Before querying and again before
sending, jobs check the owner's current access, recipients, visibility and definition.
CSV generation retains the five-second read-only query and 5000-row export limits.
Atomic database claims advance the next run before delivery so replicas/restarts
cannot automatically resend a slot. Failed or interrupted slots are not retried;
partial SMTP delivery is possible and the schedule displays its latest outcome.
Access/definition changes block and disable delivery until reviewed and enabled.
SMTP configuration is reused, with bounded connection and socket timeouts. New
schedules default to disabled and no additional environment variables are required.
Summary stats, by-status breakdown, engineer load, KPI health (sorted worst-first),
6-month trend charts (tasks created/completed/on-time, visits scheduled/completed/
reported, hours logged — built with batched range queries), pending-closure list, a
scheduled **weekly email digest** (`reportScheduler.js`), and the Service Activity
report tab described above.

### Search
**Quick search** (top-bar) and **smart structured search** (entity + status/priority/
customer/date/overdue filters). Because PII columns are encrypted and can't be
`LIKE`-matched in SQL, customer search — and any filter that matches *by* customer name
(project/task/maintenance-visit search) — uses decrypt-and-filter helpers
(`searchCustomers()`, `matchingCustomerIds()`) that enforce role visibility, decrypt
candidates, then substring-match in the app layer.

### Notifications
In-app bell + optional **Microsoft Teams** (MessageCard webhook) and **Cisco Webex**
(Bot API, direct/space) channels, all fire-and-forget. Events: task/project/visit
assignment, @mentions, report submitted, visit reminders, scorecard-pending. Per-event
toggles in settings.

### Notes
Scratchpad saves are serialized; failed saves remain unsaved and display an error.
Per-user browser drafts recover unsaved text on return, and editing is disabled when
the original note cannot load. To-do failures preserve the current item or input
instead of displaying a successful change. The API validates note/title types and
boolean completion values.
Private per-user scratchpad (`personal_notes`, one row per user, ≤50 k chars) and
personal todos — not visible to managers.

### Admin Panel (manager)
User CRUD (create forces password change on first login), password reset,
activate/deactivate, role change, 2FA exemption toggle; consolidated system stats
(single query); cross-entity activity feed; settings tabs for localization, security
policy (password expiry), integrations (Teams/Webex webhooks, event toggles), reporting
schedule, status configuration (label/color/order per project/task/visit/**service
activity** status — the status editor is now shared across four entity types via the
same generic `settings.status_config` JSON blob), the audit log, and the Service
Activity Tracking admin tab described above.

Settings (`/settings/:section`, manager-only) has 18 sections in two areas plus an
overview. *Business*: Users & Access, Projects, Maintenance Visits, Status Workflow,
Service Activity Tracking. *Technical*: Integrations, Weekly Report, Localization,
Security Policy, Audit Log, Logging, System Alerts, System Stats, Activity Feed,
Deployment Health, Data Export, System Update. Search covers all sections and old
`/admin/...` URLs redirect. The code for each section is in `client/src/pages/admin/`.

**System Update** lets a manager check for outdated packages, install them, rebuild the
client and restart the server (`/api/settings/system-update/*`, backed by
`update-manager.js`, with a live log). It is disabled when `NODE_ENV=production` unless
`ALLOW_IN_APP_UPDATES=true`; production deploys go through the Docker/branch pipeline
instead (see DEPLOY.md).

### Audit Log (manager)
Append-only record (user, role, entity type/id/title, action, detail, IP, timestamp)
with filtered, paginated retrieval (`?entity_type/user_id/action/date_from/date_to`,
max 500/page).

### Customer Responses
A library of ready-to-send customer email texts (Closing Ticket, Chargeable Task,
CRM - Chargeable, Late Response, Notification of Asset Upgrade) with one-click copy, for
every role, under *Personal* in the sidebar (`/customer-responses`). It is static
client-side content: no API, no database, no audit. To change a text, edit the
`TEMPLATES` list in `pages/CustomerResponses.jsx`.

### Users (manager)
`/users` is a searchable team directory grouped by role (managers, engineers, planners,
PMs) with join dates. It is read-only; accounts are created and changed in Settings →
Users & Access.

### Profile
Self-service name/email update (with format + uniqueness checks), avatar upload
(JPEG/PNG/GIF/WebP, ≤2 MB, SVG blocked), password change, and TOTP enable/disable —
each issuing a fresh token when identity fields change.

## 8. Background jobs

- **Daily visit reminders** — runs at startup and re-schedules for 08:00 daily, then
  every 24h.
- **Weekly report scheduler** — configurable day/hour/recipients via settings.
- **Saved custom-report delivery** (`customReportScheduler.js`, started with the weekly
  scheduler) — polls every minute for due schedules, claims each slot atomically,
  rechecks the owner's access and recipients, and does not retry a failed slot (see
  Reports in §7). Stopped on graceful shutdown.
- All started only after the server successfully binds.
- Service Activity Tracking has **no** background job — retention purge is a manual,
  manager-triggered admin action, not a scheduled task (see §11).

## 9. API surface (prefixes)

All endpoints under `/api/*`; all require a valid JWT except `/api/auth/login`,
`/api/auth/forgot-password`, `/api/auth/reset-password`, and the iCal feed (token in
query param).

| Prefix | Purpose |
|--------|---------|
| `/api/auth` | login, 2FA, password mgmt, profile, avatar, download-token |
| `/api/projects` | project CRUD, members, activity, Excel import, closure approvals, `/:projectId/custom-fields` |
| `/api/tasks` | task CRUD, comments, dependencies, bulk ops, export |
| `/api/customers` | customer CRUD, import, template, team/engineer assignment, service-activity summary, contract-hours; `/:id/overview` (Customer 360), `/:id/recommendations`, `/:id/assets` (inventory + attachments) |
| `/api/maintenance-visits` | visit CRUD, engineer assignment, reports, import/export |
| `/api/calendar` + `/api/calendar/ical` | month feed, iCal subscription |
| `/api/reports` | summary, monthly trends, projects, service-activity customer/engineer/team/overview reports + export; `/custom` (report builder, saved reports, schedules, templates) |
| `/api/kpis`, `/api/milestones`, `/api/scorecards` | per-project metrics & evaluations |
| `/api/workload` | engineer load + 4-week forecast; `/planning` (effort/availability inputs), `/pressure` (ranking + policy) |
| `/api/time-logs` | hour logging + summaries |
| `/api/sla` | live SLA overview |
| `/api/attachments` | per-project file upload/download (encrypted) |
| `/api/teams` | team CRUD, membership, `/teams/mine` (module access check) |
| `/api/activity-categories`, `/api/technologies` | Service Activity Tracking lookups (admin CRUD + read for all) |
| `/api/service-activities` | activity CRUD, complete, duplicate, follow-up-task, attachments, export, `/meta` |
| `/api/service-activity-settings` | module-wide toggles, retention status/purge |
| `/api/operations` | role-scoped Dashboard / My Work overview (`GET /overview?as_of=`, manager and engineer) |
| `/api/notifications`, `/api/notes`, `/api/search` | bell, scratchpad, global search |
| `/api/settings`, `/api/report-settings`, `/api/statuses` | configuration; `/settings/system-update/*` (disabled in production by default) |
| `/api/templates`, `/api/audit`, `/api/admin` | templates, audit log, user admin |

## 10. Testing

Run everything locally with `cd server && npm test` and `cd client && npm test`
(unit) and `cd client && npm run test:e2e` (browser). CI runs all of it.

**Server** (`node --test`, `server/test/`):
- Unit tests: placeholder conversion, field encryption round-trips, SSRF guard, upload
  magic bytes, JWT scope and session checks, activity-reference formatting, workload
  model and policy, report schedule and weekly digest, integration-setting redaction.
- `nativeSql.test.js` fails if SQLite-only SQL is written back into the source.
- `serviceActivities.integration.test.js` — route-level tests that mount the real route
  modules on a minimal Express app (`server/index.js` is not booted; its TLS/rate-limit
  bootstrap is not importable). Without `TEST_DATABASE_URL` it runs on an in-memory
  Postgres (`pg-mem`, with a few rewrites for what pg-mem lacks, such as `app_now()`);
  with it, it runs on a real PostgreSQL server and adds the tests that need one
  (locks, concurrent writes, rollbacks, correlated subqueries). Coverage includes
  team gating, IDOR resistance, customer authorization, optimistic-lock conflicts,
  exports matching list filters, workload, reports, recommendations and closure review.
- `postgres.schema.test.js` (real PostgreSQL only) checks that `init()` can run twice
  without changing migration records or leaving an invalid index, and that **every
  static SQL statement in the server source** is accepted by PostgreSQL (prepared, not
  executed). `test/lib/extractSql.js` finds the statements; about 550 are checked,
  and statements built with `${}` are not.

**Client** (`client/test/`, `node --test`): API wrapper behaviour, navigation and
role visibility, task filters, and the error-message helper.

**Browser** (`client/e2e/`, Playwright with the installed Chrome): the production build
is served with the API mocked at the network level (`e2e/support/mockApi.js`), so the
tests need no database. They cover sign-in, the signed-out redirect, page rendering, the
error boundary, the Activity Log form (the browser sends no `engineer_id`/`team_id`;
team gating), dark-mode calendar chips, equal calendar columns, the stray-`0` badge
regression, and that **every Settings section and the Project page open without a
missing reference** (catches names lost when a large module is split, which the build
cannot see). `npm run test:e2e` builds to `.e2e-dist`, never `client/dist`. Mocked data
proves the UI, not the API contract; the server tests own that.
`scripts/browser-smoke.cjs` is a separate, older headless-Chrome smoke runner for
the Report Builder and Settings (see PLATFORM_VALIDATION.md).

**CI** (`.github/workflows/ci.yml`, on push to `DEV-2`/`DEV-3`/`dev`/`main` and on any
pull request): server tests and `npm audit`; the route integration tests and the schema
and SQL check against a PostgreSQL 16 container; client tests, production build,
Playwright tests (report uploaded on failure) and `npm audit`; and
`docker compose config` validation.

Not covered: a manual browser and screen-reader pass on real staging data, real-device
testing, and end-to-end runs of the browser against the real API.

## 11. Known limitations / improvement targets

Flagged for a reviewer (human or AI) looking to improve functionality, UI, or security:

- **No granular permission system.** All authorization is role checks (`manager`/
  `planner`/`pm`/`engineer`) plus ad-hoc per-route membership checks
  (`project_assignments`, `maintenance_visit_engineers`, and now `team_members`/
  `customer_teams`/`customer_engineers`). This is simple and consistent, but there's no
  single place to audit "who can do what" — a real RBAC/permission table would be a
  significant architectural improvement if the app's user base or role complexity
  grows.
- **Service Activity mutation authorization** uses shared ownership and customer
  authorization middleware for completion, duplication, follow-ups and attachments.
  Historical read routes retain ownership checks so users can see their own history.
- **Encrypted-field search doesn't scale.** Because `customers.name` (and other PII)
  is encrypted, every duplicate-name check and every name-based search decrypts *every*
  customer row in memory (AES-GCM per row) rather than using an index. Fine at current
  scale; would need a blind-index/hash column (or moving uniqueness enforcement off
  the encrypted column) if the customer table grows large.
- **Attachments aren't cleanly polymorphic.** The `attachments` table has two nullable
  owner columns (`project_id`, `service_activity_id`) instead of a generic
  `entity_type`/`entity_id` pair. Works for two owners; a third would make this
  layout genuinely awkward.
- **Test coverage.** CI checks the schema, every static SQL statement and the route
  integration tests on PostgreSQL 16, plus mocked-API browser tests. Most older
  modules still lack their own route integration tests, SQL built with `${}` is not
  statically checked, and a manual browser QA pass on real data remains necessary
  before production use.
- **Route-centred backend.** Validation, rules and SQL live together in route handlers
  (see "Layering and code layout"). This is consistent and simple, but harder to unit
  test and to reuse; a service/repository split is the natural next refactor.
- **Service Activity retention is manual, not automatic.** By design (see §7) — an
  automatic background purge was deliberately not added without being asked, but if
  that's wanted, the fields/status endpoint already exist to build on.
- **No PDF export anywhere in the app** (Excel/`exceljs` and custom-report CSV) — intentional (no PDF
  library is present), but worth a deliberate decision if PDF reports become a
  requirement rather than leaving it unaddressed.
- **Shared UI:** dialogs trap keyboard focus, restore the triggering control on
  close, lock background scrolling, and let Escape dismiss only the top dialog.
  Confirmation dialogs initially focus Cancel. Status badges select configured
  labels/colors by entity type, so overlapping task/project/visit/activity values
  use the correct configuration.
- **UI**: no component library (hand-rolled CSS + `lucide-react` icons + heavy inline
  `style={{}}` objects throughout). Consistent, but a design-system pass (shared
  form components, consistent spacing tokens, etc.) could reduce duplication —
  the largest pages were split into per-section files under `pages/admin/` and
  `pages/project/`, but many pages still rely on inline `style={{}}` objects.
- **List pagination is inconsistent across the app.** Service Activity Tracking and Tasks use
  real server-side `LIMIT`/`OFFSET` pagination; older modules (Projects, Customers)
  fetch the full table and filter/paginate client-side. Fine at current
  data volumes; a scaling risk if any of those tables grow large.


### Service activity editing and export safeguards

Service activity detail and list responses include an integer `version`. Update requests must send the version fetched with the editing snapshot. Missing versions return HTTP 428; invalid versions return HTTP 400. The server atomically checks and increments the version when saving, returning HTTP 409 with code `ACTIVITY_CONFLICT` if another change intervened. Completion and follow-up linking also increment the version. The edit form preserves drafts on conflicts and offers an explicit reload that replaces the draft after confirmation.

The Activity Log Excel export uses the same customer, category, status, technology, billing, date and search filters and ownership rules as the list, in the same sort order. It exports all matching rows regardless of pagination. Both endpoints reject malformed or repeated filter values, impossible calendar dates, reversed date ranges, non-positive IDs and invalid pagination with HTTP 400. Page size must be between 1 and 200.

Weekly digest settings await database reads and preserve stored SMTP passwords when
unchanged; reads expose only `password_set`. Preview HTML escapes stored user/record
text. Weekly recipient configuration is bounded to 20 eligible managers, and
current manager access is checked again when resolving delivery addresses.

Settings separates Overview, Business and Technical areas while preserving section
URLs and existing manager permissions. Search spans all areas. Business links reuse
the page capability registry for Customers, Templates, Workload, Approvals and Reports.
Integration reads expose configuration flags instead of stored Webex tokens or Teams
webhook URLs; blank edits retain them, explicit removal flags clear them, and tests
resolve credentials server-side. New webhook URLs retain outbound SSRF validation.
Failed integration loads offer Retry and do not expose writable default settings;
settings switches support native keyboard activation and announce their state.

A reproducible headless Chrome smoke runner now checks the Report Builder and
Settings with synthetic APIs at desktop/tablet/mobile widths, keyboard dialog
behavior, retries and role guards. See docs/PLATFORM_VALIDATION.md for the actual
coverage and remaining manual staging QA; backend integration tests remain the
authority for database permissions and mutations.

Password-policy writes reject non-integer or out-of-range expiry values rather than
coercing malformed input into disabled expiry. Explicit numeric 0 disables expiry;
valid values are 0-3650. The policy and authentication lookup key update atomically.
