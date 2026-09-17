# SolutionsHub — Application Overview

A code-grounded description of the application: architecture, data model, security,
and every feature module with notes on how each is handled.

> Last reviewed: 2026-09-16.

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

**⚠️ Database dialect — read this before touching `server/db.js` or any route SQL.**
The app was originally written against `better-sqlite3` (synchronous calls,
`db.prepare(sql).get/all/run(...params)`) and was later migrated to PostgreSQL without
rewriting any of the ~25 route files. `server/db.js` now wraps a `pg` `Pool` behind an
async facade with the *same call shape*, and its `translate()` function rewrites
SQLite-flavored SQL into real Postgres SQL before every query: `?` → `$1, $2, …`,
`datetime('now')`/`date('now')` → `to_char(...)` text-timestamp expressions,
`GROUP_CONCAT` → `string_agg`, `LIKE` → `ILIKE`, `INSERT OR IGNORE` →
`ON CONFLICT DO NOTHING`, and a plain `INSERT` auto-appends `RETURNING id` (skipped for
a hardcoded allowlist of id-less junction tables, `NO_ID_TABLE_RE`). **Every route in
this codebase writes SQL in the SQLite-shaped dialect** — this is the established,
consistent convention, not a mix of styles. Writing raw Postgres placeholders (`$1`)
into a new route would be inconsistent with 100% of existing code and should be
avoided; use `?` and let `translate()` handle it.

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
- **maintenance_visits** + **maintenance_visit_engineers** (many-to-many) —
  scheduled date, dual report-sent tracking (internal + to-customer)
- **kpis**, **project_milestones**, **project_scorecards**, **project_custom_fields**,
  **project_status_updates**, **project_activity**, **project_templates** /
  **project_template_tasks**, **user_project_pins**
- **activity_categories** / **activity_subcategories** — admin-managed lookup for
  service activity classification, with a `require_attachment` flag per category
- **technologies** — admin-managed lookup (Firewall, M365, Intune, WAF, PAM, …), shared
  by service activities and intended as the base for a future Asset/Device model
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
Aggregated health: active projects, open/overdue tasks, this-week visits, KPI bars,
recent `project_activity`. Engineers see only their own scope.

### Projects
Full lifecycle with config-driven statuses (`not_started → in_progress →
waiting_customer/vendor → on_hold → pending_approval → closed/cancelled`, plus
delayed/reopened). Features: priority, deadline, **computed RAG status** (deadline
proximity + overdue-task ratio, overridable by manager), `completion_pct` (manual or
derived from task completion), member assignment, status updates, activity log,
milestones, KPIs, custom fields, task dependencies, attachments, Excel import,
templates, and a **closure-approval workflow** (request → manager approves/rejects).
Project detail decrypts the linked customer's contact fields for display.

Project creation saves memberships in the same transaction. Closure requests and
approvals save their status and update message atomically, and conditional writes
prevent duplicate lifecycle updates from concurrent requests. Project dates and
member lists are validated; deadlines can be cleared, and pinning respects project
visibility.

Manager role changes, account activation and deletion serialize within a transaction
and re-check the acting manager's session before enforcing the last-manager guard.
Admin user inputs validate types and bcrypt's 72-byte password limit; hashes are
computed asynchronously, duplicate emails return 409, and optional emails can be cleared.

### Tasks
Per-project or ad-hoc. Statuses validated against an enum; priorities
low/medium/high/critical. Supports comments with **@mention notifications**,
dependencies with a **transitive cycle check** (BFS) and `is_blocked` computation,
duplication, bulk status/delete (≤500 IDs, role-scoped), time logging, and Excel
export. Bulk edits enforce the same manager/engineer boundary as individual edits.
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
CRM-lite with encrypted PII, service-contract fields (see §3), and team/engineer
assignment. Validates text, finite non-negative included hours, and contract date ranges.
Partial edits preserve omitted contract values and allow explicitly clearing
optional contract fields.
Excel import (≤5,000 rows, duplicate detection by normalized
name, downloadable template). Engineers see only customers linked to their work
(project/visit assignment for the legacy modules; team/engineer assignment for Service
Activity Tracking).

### Maintenance Visits
Multi-engineer scheduled visits with **dual report tracking** (internal `report_sent` +
`report_sent_to_customer`), each with timestamp and actor. Inputs validate text and
real calendar dates; visit creation and reassignment
save the visit and engineer set atomically. Report submission preserves its first
actor/timestamp, undoing the internal report clears downstream forwarding metadata,
and cancelled visits cannot be reported, forwarded or completed.
Excel import/export, time logging, **automated next-day email reminders** (fired daily at 08:00, deduplicated per
visit/user/day), and a per-engineer **iCal subscription feed**.

### Service Activity Tracking (MSP Operations Log)
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
Month view (`?month=YYYY-MM`) unifying task deadlines, project deadlines, and visits —
each role-scoped (engineers see only their own; planners/PMs see visits within their
projects).

### Workload (manager)
Per-engineer snapshot (open tasks, upcoming visits, tasks done this month, hours logged
this month) plus a **4-week capacity forecast** grid. Both are heavily batch-queried (4
and 2 queries respectively) to avoid N+1.

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

### Audit Log (manager)
Append-only record (user, role, entity type/id/title, action, detail, IP, timestamp)
with filtered, paginated retrieval (`?entity_type/user_id/action/date_from/date_to`,
max 500/page).

### Profile
Self-service name/email update (with format + uniqueness checks), avatar upload
(JPEG/PNG/GIF/WebP, ≤2 MB, SVG blocked), password change, and TOTP enable/disable —
each issuing a fresh token when identity fields change.

## 8. Background jobs

- **Daily visit reminders** — runs at startup and re-schedules for 08:00 daily, then
  every 24h.
- **Weekly report scheduler** — configurable day/hour/recipients via settings.
- Both started only after the server successfully binds.
- Service Activity Tracking has **no** background job — retention purge is a manual,
  manager-triggered admin action, not a scheduled task (see §11).

## 9. API surface (prefixes)

All endpoints under `/api/*`; all require a valid JWT except `/api/auth/login`,
`/api/auth/forgot-password`, `/api/auth/reset-password`, and the iCal feed (token in
query param).

| Prefix | Purpose |
|--------|---------|
| `/api/auth` | login, 2FA, password mgmt, profile, avatar, download-token |
| `/api/projects` | project CRUD, members, activity, Excel import |
| `/api/tasks` | task CRUD, comments, dependencies, bulk ops, export |
| `/api/customers` | customer CRUD, import, template, team/engineer assignment, service-activity summary, contract-hours |
| `/api/maintenance-visits` | visit CRUD, engineer assignment, reports, import/export |
| `/api/calendar` + `/api/calendar/ical` | month feed, iCal subscription |
| `/api/reports` | summary, monthly trends, projects, service-activity customer/engineer/team/overview reports + export |
| `/api/kpis`, `/api/milestones`, `/api/scorecards` | per-project metrics & evaluations |
| `/api/workload` | engineer load + 4-week forecast |
| `/api/time-logs` | hour logging + summaries |
| `/api/sla` | live SLA overview |
| `/api/attachments` | per-project file upload/download (encrypted) |
| `/api/teams` | team CRUD, membership, `/teams/mine` (module access check) |
| `/api/activity-categories`, `/api/technologies` | Service Activity Tracking lookups (admin CRUD + read for all) |
| `/api/service-activities` | activity CRUD, complete, duplicate, follow-up-task, attachments, export, `/meta` |
| `/api/service-activity-settings` | module-wide toggles, retention status/purge |
| `/api/notifications`, `/api/notes`, `/api/search` | bell, scratchpad, global search |
| `/api/settings`, `/api/report-settings`, `/api/statuses` | configuration |
| `/api/templates`, `/api/audit`, `/api/admin` | templates, audit log, user admin |

## 10. Testing

- `server/test/*.test.js` — pure-function unit tests (`node --test`, no external
  dependencies): SQL dialect translation, field encryption round-trips, SSRF guard
  range checks, upload magic-byte validation, JWT scope checks, activity-reference
  formatting.
- `server/test/serviceActivities.integration.test.js` — route-level integration tests
  for the Service Activity Tracking module (team-gating, IDOR resistance, customer
  authorization, manager view-all, historical-completion creation, reference
  uniqueness, direct-URL bypass rejection), run against an in-memory Postgres
  (`pg-mem`) rather than pure functions, since this behavior only exists at the route
  handler level. `server/index.js` isn't booted directly for tests (its TLS/rate-limit/
  scheduler bootstrap isn't structured for import) — a minimal Express app mounts the
  real route modules instead. The harness also checks task custom-field ownership,
  project relationships and typed validation. CI repeats the route tests against
  PostgreSQL 16 in a fresh disposable database (`TEST_DATABASE_URL`). Other modules
  still need broader route coverage.
- CI (`.github/workflows/ci.yml`) runs `npm test` + `npm audit` for both server and
  client, and validates `docker compose config`, on push to `DEV-2`/`DEV-3`/`dev`/`main` and on
  any pull request.

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
- **Database and browser coverage.** CI checks the schema and route integration tests
  on PostgreSQL 16 as well as `pg-mem`. Most older modules still need integration
  tests, and a manual browser QA pass remains necessary before production use.
- **Service Activity retention is manual, not automatic.** By design (see §7) — an
  automatic background purge was deliberately not added without being asked, but if
  that's wanted, the fields/status endpoint already exist to build on.
- **No PDF export anywhere in the app** (Excel/`exceljs` only) — intentional (no PDF
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
  `AdminPanel.jsx` alone is 3000+ lines.
- **List pagination is inconsistent across the app.** Service Activity Tracking uses
  real server-side `LIMIT`/`OFFSET` pagination; most older modules (Tasks, Projects,
  Customers) fetch the full table and filter/paginate client-side. Fine at current
  data volumes; a scaling risk if any of those tables grow large.
