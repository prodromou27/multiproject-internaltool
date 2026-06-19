# SolutionsHub — Application Overview

A code-grounded description of the application: architecture, data model, security,
and every feature module with notes on how each is handled.

> Last reviewed: 2026-06-16.

---

## 1. What it is

**SolutionsHub** is a full-stack operations-management platform for an engineering
services organization. It runs the full lifecycle of client **projects**, field
**maintenance visits**, **task** execution, engineer **workload** and **performance
scoring**, **SLA** tracking, and a secure **customer** database — behind role-based
access control, 2FA, and field-level PII encryption.

## 2. Architecture & stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express |
| Database | SQLite via `better-sqlite3` (synchronous, single-file `app.db`, WAL mode, foreign keys ON) |
| Frontend | React 18 + Vite SPA (built to `client/dist`, served statically by Express) |
| Transport | HTTPS on port 443 (self-signed certs in `server/certs`), HTTP:80 → HTTPS redirect; falls back to HTTP:3001 if no certs |
| Auth | JWT (stateless), bcrypt password hashing, TOTP 2FA |
| Config | Hand-rolled `.env` loader at startup (no dotenv dependency) |

**Single-process deployment:** Express serves both the JSON API (`/api/*`) and the
compiled React app (SPA catch-all `app.get('*')`). Unknown `/api/*` paths return a
JSON 404 *before* the SPA fallback so API misses don't return HTML.

The DB layer (`db.js`) is **self-migrating**: on every startup it creates missing
tables, runs idempotent `ALTER TABLE` column additions, performs table-rebuild
migrations (relaxing status `CHECK` constraints, making email optional), seeds
default status configuration, creates performance indexes, and — if the users table
is empty — seeds a first-run `admin@company.com` manager with a randomly generated
password printed once to the console.

## 3. Data model (core tables)

- **users** — name, email (unique, optional), bcrypt password, role, active flag,
  avatar, TOTP secret/enabled/exempt, `must_change_password`, `password_changed_at`
- **projects** — title, description, status (free-text, config-driven), priority,
  deadline, `customer_id`, `completion_pct`, `rag_override`, closure tracking,
  `pending_from_customer`
- **tasks** — project link (nullable for ad-hoc), title, status, priority,
  `assigned_to`, `is_adhoc`, deadline
- **task_dependencies**, **task_comments**, **task_custom_values**
- **customers** — name + 5 **encrypted** PII fields (contact name/email/phone,
  address, notes)
- **maintenance_visits** + **maintenance_visit_engineers** (many-to-many) —
  scheduled date, dual report-sent tracking (internal + to-customer)
- **kpis**, **project_milestones**, **project_scorecards**, **project_custom_fields**,
  **project_status_updates**, **project_activity**, **project_templates** /
  **project_template_tasks**, **user_project_pins**
- **time_logs**, **personal_notes**, **personal_todos**
- **notifications**, **audit_log**, **password_reset_tokens**, **settings** (key/value),
  **attachments** (with encryption IV/tag columns)

## 4. Authentication & session handling

**Login** (`POST /api/auth/login`):
- Email is normalized (`trim().toLowerCase()`) to match stored form; password compared
  with `bcrypt.compareSync` (constant-time even on "user not found" to avoid a timing
  oracle).
- Deactivated accounts are rejected (403); `last_login` is stamped.
- Password expiry is checked (configurable, default 90 days) — sets
  `must_change_password` if elapsed.
- If TOTP is enabled (and not exempt), returns a **5-minute partial token** and
  `requires_2fa: true` instead of a session token.
- Otherwise returns a **24-hour JWT** (`{id, name, email, role}`) plus
  `must_change_password` / `password_expired` flags.

**JWT** is signed with a module-private secret (`JWT_SECRET` from `.env`; in production
the server refuses to start without one ≥32 chars; in dev it falls back to a random
per-process secret). The secret is never exported.

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
  **account enumeration**.

**Download tokens:** file-download links that must put a token in a URL use a dedicated
60-second scoped token (`download: true` claim) so the 24h session JWT never lands in
proxy/access logs.

## 5. Authorization (roles)

Four roles: **manager**, **planner**, **pm**, **engineer**. Enforced by middleware
(`requireAuth`, `requireManager`, `requireManagerOrPlanner`) plus per-route ownership
checks:

- **Manager** — full access; only role that reaches `/api/admin/*`, reports,
  scorecards, workload, audit.
- **Planner / PM** — broad project visibility (scoped to assigned projects for some
  views); **no task list visibility** (`GET /tasks` returns `[]`); cannot edit tasks.
- **Engineer** — sees only their own assigned tasks, visits, and the customers tied to
  them; can update only their own tasks, log time only to their own work, create tasks
  only on projects they're a member of, and view only their own scorecards.

Data isolation is enforced at the **SQL level** (engineers' customer/visit/task queries
are filtered by `project_assignments` / `maintenance_visit_engineers` membership), not
just hidden in the UI.

**Admin safety guards:** the system cannot be left with zero admins — demoting,
deactivating, or deleting the **last active manager** is blocked; self-deactivation and
self-deletion are blocked; deleting a user who authored records returns an actionable
409 (suggesting deactivation) instead of a raw FK 500.

## 6. Security mechanisms

- **Customer PII encryption** — AES-256-GCM field-level encryption (`fieldCipher.js`) on
  5 customer columns, stored as `enc:<iv>.<tag>.<ciphertext>`, fresh random 96-bit IV
  per write, key memoized from `CUSTOMER_FIELD_KEY`. Transparent decrypt on read across
  customers, projects, maintenance-visits, and search routes. Backward-compatible
  plaintext passthrough; an idempotent backfill script
  (`scripts/encrypt-existing-customers.js`) encrypts legacy rows.
- **Attachment encryption** — uploaded files encrypted at rest (AES-GCM via `cipher.js`)
  with IV/tag stored per row; decrypted in-memory on download.
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
- **SSRF guard** — webhook URLs validated against private/loopback/link-local/metadata
  ranges.
- **SQL injection** — fully parameterized; the only string interpolation into SQL is
  generated `?` placeholder lists and static fragments.
- **Global error handler** — keeps stack traces out of responses (generic message in
  production).

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

### Tasks
Per-project or ad-hoc. Statuses validated against an enum; priorities
low/medium/high/critical. Supports comments with **@mention notifications**,
dependencies with a **transitive cycle check** (BFS) and `is_blocked` computation,
duplication, bulk status/delete (≤500 IDs, role-scoped), time logging, and Excel
export. Engineers self-assign and are confined to their own tasks and member projects.

### Customers
CRM-lite with encrypted PII. Excel import (≤5,000 rows, duplicate detection by
normalized name, downloadable template). Engineers see only customers linked to their
work.

### Maintenance Visits
Multi-engineer scheduled visits with **dual report tracking** (internal `report_sent` +
`report_sent_to_customer`), each with timestamp and actor. Excel import/export, time
logging, **automated next-day email reminders** (fired daily at 08:00, deduplicated per
visit/user/day), and a per-engineer **iCal subscription feed**.

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
reported, hours logged — built with batched range queries), pending-closure list, and a
scheduled **weekly email digest** (`reportScheduler.js`).

### Search
**Quick search** (top-bar) and **smart structured search** (entity + status/priority/
customer/date/overdue filters). Because PII columns are encrypted and can't be
`LIKE`-matched in SQL, customer search uses a shared **decrypt-and-filter** helper that
enforces role visibility, decrypts candidates, then substring-matches
name/contact/email in the app layer.

### Notifications
In-app bell + optional **Microsoft Teams** (MessageCard webhook) and **Cisco Webex**
(Bot API, direct/space) channels, all fire-and-forget. Events: task/project/visit
assignment, @mentions, report submitted, visit reminders, scorecard-pending. Per-event
toggles in settings.

### Notes
Private per-user scratchpad (`personal_notes`, one row per user, ≤50 k chars) and
personal todos — not visible to managers.

### Admin Panel (manager)
User CRUD (create forces password change on first login), password reset,
activate/deactivate, role change, 2FA exemption toggle; consolidated system stats
(single query); cross-entity activity feed; plus settings tabs for localization,
security policy (password expiry), integrations (Teams/Webex webhooks, event toggles),
reporting schedule, status configuration (label/color/order per project/task/visit
status), and the audit log.

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

## 9. API surface (prefixes)

All endpoints under `/api/*`; all require a valid JWT except `/api/auth/login`,
`/api/auth/forgot-password`, `/api/auth/reset-password`, and the iCal feed (token in
query param).

| Prefix | Purpose |
|--------|---------|
| `/api/auth` | login, 2FA, password mgmt, profile, avatar, download-token |
| `/api/projects` | project CRUD, members, activity, Excel import |
| `/api/tasks` | task CRUD, comments, dependencies, bulk ops, export |
| `/api/customers` | customer CRUD, import, template |
| `/api/maintenance-visits` | visit CRUD, engineer assignment, reports, import/export |
| `/api/calendar` + `/api/calendar/ical` | month feed, iCal subscription |
| `/api/reports` | summary, monthly trends, projects |
| `/api/kpis`, `/api/milestones`, `/api/scorecards` | per-project metrics & evaluations |
| `/api/workload` | engineer load + 4-week forecast |
| `/api/time-logs` | hour logging + summaries |
| `/api/sla` | live SLA overview |
| `/api/attachments` | per-project file upload/download (encrypted) |
| `/api/notifications`, `/api/notes`, `/api/search` | bell, scratchpad, global search |
| `/api/settings`, `/api/report-settings`, `/api/statuses` | configuration |
| `/api/templates`, `/api/audit`, `/api/admin` | templates, audit log, user admin |

## 10. Known open item

The next major session-hardening improvement is to move browser sessions from
`localStorage` bearer tokens to `HttpOnly`, `Secure`, `SameSite` cookies with CSRF
protection. The current JWTs are version-checked against the database and scoped
tokens are used for downloads and iCal feed URLs, but cookie-backed sessions would
reduce token exposure if browser-side script injection ever occurred.
