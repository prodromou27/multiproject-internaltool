# Engineering Operations platform: discovery and delivery

Reviewed on 2026-09-17 against DEV-3. This document tracks the requested extension
of SolutionsHub. It complements `APP_OVERVIEW.md`; it does not replace the existing
application or promise that every listed gap has already been resolved.

## Architecture to preserve

- React 18 SPA, React Router 7, Vite 5, Lucide icons and Recharts; route pages are
  lazy-loaded. Styling uses shared CSS tokens and hand-built components.
- Node 24 / Express 4 monolith serves `/api` and the compiled frontend. PostgreSQL
  is accessed through `server/db.js`, an asynchronous `pg` facade translating the
  established SQLite-shaped SQL syntax and `?` parameters.
- Schema initialization and transactional compatibility migrations run at startup.
  Fresh-install definitions and compatibility changes must remain aligned.
- Browser authentication uses HttpOnly cookies, session revocation through
  `token_version`, optional TOTP, forced password changes and CSRF protection.
  Scoped download tokens and bearer authentication remain supported.
- Existing roles are manager, engineer, planner and pm. Manager currently combines
  business-management and administrator privileges. Do not invent a separate admin
  or team-leader role without a deliberate permission migration.
- Project, visit, task and customer access depend on role and membership. Service
  activities additionally depend on team enablement and customer authorization.
  Historical activity reads are owner-scoped; current customer eligibility gates
  writes. Manager bypasses the team feature gate.
- Reuse shared Modal, StatusBadge, Toast, Confirm and the status configuration
  provider. Existing entity status values are configurable; avoid replacing them
  with the examples in the product brief.
- Daily visit reminders and the configurable weekly email digest run in the web
  process. Integrations include SMTP, Teams and Webex notifications, iCal feeds and
  Excel imports/exports. There is no external job queue or PDF generation pipeline.
- Docker Compose deploys the monolith and PostgreSQL. CI runs local unit/integration
  tests, PostgreSQL 16 route tests, dependency audits and Compose validation.

## Module inventory

| Module and entities | Current screens / permission model | Strengths | Gaps and next improvements |
| --- | --- | --- | --- |
| Dashboard | Dashboard; role-dependent content | Existing summaries and exception indicators | Make urgent work the first view; distinguish management exceptions from personal work; improve loading/error presentation |
| Personal work / time logs | EngineerHub (My Day), Tasks, Notes; own assignments and private notes | Per-user timer, time logging, recoverable note drafts | Consolidate due work, report obligations and activity follow-ups; do not expose private notes to management |
| Projects / assignments | Projects, ProjectDetail; manager manages, engineer assigned, pm reads | Customer links, pins, custom fields, milestones, tasks, timelines, closure requests | Consistent detail layout; explicit rejection/reopen history; list pagination; clarify dependencies before changing closure rules |
| Tasks / dependencies | Tasks and project detail; manager and engineer, owner updates | Project/ad-hoc work, comments, dependencies, bulk edits, export | Effort estimates and customer linkage require schema decisions; replace scattered row actions; paginate server-side |
| Maintenance visits / engineer assignments | MaintenanceVisits; manager/planner scheduling, assigned engineer execution | Atomic assignment replacement, report attribution, customer-report distinction | Reviewed recurring schedule suggestions, report due dates, persistent findings; do not auto-create schedules |
| Calendar / iCal | CalendarPage; role-scoped events | Project deadlines, tasks and visits; engineer subscription | Day/week views, report and service follow-up events, consistent scopes and filter validation |
| Customers / service profile | Customers and CustomerServiceProfile; management screens | Encrypted PII, contracts, team/engineer mappings, service summaries | Customer 360 combining authorized projects, tasks, visits, documents and audit events; encrypted search scalability |
| Users / teams | Users and AdminPanel; manager | Last-manager safeguards, active users, team memberships | Centralize UI capabilities using existing roles; separate business and technical settings visually |
| Service activities / technology tags | ActivityLog, ServiceOperations; enabled engineer/pm teams, own records; manager all | Customer eligibility, references, duration requirements, attachments, version conflicts, matching Excel/list filters | Faster contextual creation, details layout, due follow-up visibility; retention/file cleanup needs a separate lifecycle review |
| Approvals | Project closure controls and reports; manager approves | Atomic requests and approval transitions | Dedicated backlog; rejection comments and attribution; current schema lacks a generic approvals module |
| KPIs / scorecards / SLA | ProjectDetail, Scorecards, SLAPage; project KPIs differ from management evaluations | Configurable metrics, weighted evaluations, SLA exception calculations | Preserve project KPI visibility; verify management-sensitive export permissions independently of screen guards |
| Workload | Workload; manager | Batched engineer snapshot and four-week forecast | Existing forecast is not the requested full effort/capacity engine; add estimates and availability before claiming capacity percentages; keep pressure separate |
| Reports | Reports, ServiceOperations; management | Fixed operational reports, trend queries, Excel and weekly digest | Metadata-driven custom builder, definitions, typed filters, grouping, aggregation, query budgets and templates |
| Notifications | Shared bell; authenticated user's inbox | Assignment/reminder events and configurable integrations | Accurate failures, keyboard interaction, deduplication and configurable due-work reminders |
| Attachments / documents | ProjectDetail and ActivityLog; owner/entity access | Magic-byte checks, encryption, protected downloads, failure cleanup | Broader entity ownership requires deliberate schema design; reconcile storage with retention/deletion |
| Audit / activity | AdminPanel audit and project timeline; management / scoped project | Append-only audit with filtering and pagination | Shared timeline UI; customer timeline must check each related entity before revealing an event |
| Templates / checklists | Templates; manager | Existing project templates and template tasks | Extend existing model incrementally for checklists and visit templates; avoid a competing template subsystem |
| Search | Top bar and SearchPage; role-scoped | Quick and structured search, customer decryption, private task scoping | Cancel stale responses; consistent errors; extend to service activities and visits with their actual visibility rules |
| Administration / settings | AdminPanel; manager | Security, reporting, integrations, status configuration, logging, deployment health | Large page needs grouped business/technical navigation and smaller components; never return integration secrets |
| Recommendations / customer health | No standalone persisted module | Visits and customers provide source relationships | Add normalized recommendations, conversion links and authorization before health scoring; no fabricated scores |

## Findings that affect implementation order

1. Navigation, command palette and route roles are declared separately and already
   differ: planner/pm calendar access is routed but missing from their navigation.
   A shared page registry can unify discovery without weakening API permissions.
2. The management service-activity export uses a manager-or-planner download guard,
   while its read endpoints require manager. Fix this before expanding reporting.
3. The shell already has global search and notifications; add Quick Create to it
   rather than creating another shell. Creation must use actual server permissions:
   manager projects; manager/engineer tasks; manager/planner visits; manager or
   team-enabled engineer/pm activities.
4. Many older lists fetch full datasets. New report previews and exports must have
   explicit limits and query execution budgets. Do not build reports by downloading
   all entities into the browser.
5. Customer names/PII are encrypted. SQL grouping should use stable customer IDs;
   authorized labels may be decrypted after querying. Expose approved fields only.
6. Workload currently lacks the complete availability/estimate model required for
   honest capacity reporting. Avoid equating task count or logged hours with load.
7. Existing project KPIs are visible to assigned engineers. Management evaluations
   and sensitive reports are a distinct permission concern; preserve working KPI
   functionality unless a reviewed visibility setting replaces it.
8. Integration tests cover many mutation and security flows, but there is no browser
   automation suite. Builds cannot prove responsive layout or keyboard usability.

## Delivery stages and acceptance

Each stage receives a separate logical commit, validation and push to DEV-3.
Update this ledger as stages finish. No destructive production data migration is
part of the foundation work.

| Stage | Scope | Acceptance | Status |
| --- | --- | --- | --- |
| 1 | Discovery, module inventory and dependency map | Code-grounded architecture, gap list and ordered plan recorded | Complete |
| 2 | Management report export permission correction | Unauthorized roles and download tokens rejected; manager export remains functional | Complete |
| 3 | Shared page registry, grouped navigation and responsive shell | Shared role/feature registry, grouped navigation, access states and mobile focus handling implemented; browser QA pending | Complete |
| 4 | Global Quick Create | Authorized actions launch the existing forms; direct-link creation remains guarded; no duplicate forms | Planned |
| 5 | Operational dashboards and approval flow | Personal due-work view; management exceptions; closure rejection/reopen with history and scoped tests | Planned |
| 6 | Core detail/list and calendar improvements | Shared detail/timeline patterns; report/follow-up events; server pagination where justified | Planned |
| 7 | Customer 360 and recommendations | Scoped customer history; persisted findings and follow-up workflow; safe additive migrations | Planned |
| 8 | Workload model | Estimates/availability and configurable weighting; capacity and pressure shown separately | Planned |
| 9 | Custom report engine | Approved source metadata, parameterized filters/grouping/aggregations, bounded preview, permission tests | Planned |
| 10 | Report Builder UI and saved reports | Field selection, typed filters, grouping, sorts, preview, definitions with private/management visibility and Excel/CSV | Planned |
| 11 | Report templates and scheduling | Templates use engine; recipient validation; scheduling extends existing jobs after engine is stable | Planned |
| 12 | Admin organization and feature settings | Business/technical sections; capability-based visibility; secrets remain protected | Planned |
| 13 | Cross-module quality review | Targeted security/performance tests, responsive and accessibility QA, deployment instructions and final change summary | Planned |

## Reporting design constraints

Keep report execution in the Express/PostgreSQL application. Add an approved source
registry that defines fields, types, joins, operators, aggregations and permission
scope. Definitions must reference registry keys, never SQL identifiers supplied by
the browser. Parameterize values and validate all structural input. Apply permission
scope again on each run and export, including saved definitions shared by another
user. Start with existing management access; wider team/user sharing requires scoped
access tests before release. Exclude passwords, TOTP secrets, tokens, integration
credentials and private notes from all source metadata.

Preview must have a small row cap, stable sorting and execution timeout; exports need
their own cap and clear truncation behavior. Saved definitions should store owner,
visibility, timestamps and a version to avoid silently replacing another edit. Audit
definition mutations. Scheduling is a subsequent stage and must validate recipients
and their eligibility rather than treating a saved definition as permanent authority.

## Verification and deployment

Use `npm test` in server/client and a production client build after meaningful code
milestones. PostgreSQL CI is authoritative for locking and queries unsupported by
pg-mem. Preserve the existing Docker/Node versions, environment validation and
PostgreSQL migration conventions. Record new migrations, configuration and jobs
alongside the stage that introduces them. Do manual responsive/keyboard QA before
production deployment; report only checks actually performed.
