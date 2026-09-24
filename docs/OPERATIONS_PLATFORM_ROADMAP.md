# Engineering Operations platform: discovery and delivery

Reviewed on 2026-09-17 against DEV-3. This document tracks the requested extension
of TeamHub. It complements `APP_OVERVIEW.md`; it does not replace the existing
application or promise that every listed gap has already been resolved.

## Architecture to preserve

- React 18 SPA, React Router 7, Vite 5, Lucide icons and Recharts; route pages are
  lazy-loaded. Styling uses shared CSS tokens and hand-built components.
- Node 24 / Express 4 monolith serves `/api` and the compiled frontend. PostgreSQL
  is accessed through `server/db.js`, an asynchronous `pg` wrapper that keeps the
  `db.prepare(sql).get/all/run` call shape and `?` parameters. The SQL is native
  PostgreSQL (`app_now()`/`app_today()`, `substr`, `string_agg`, `ILIKE`); a test
  rejects SQLite-only syntax.
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
| KPIs / scorecards / SLA | ProjectDetail, Scorecards, SLAPage; KPI access requires explicit management permissions | Configurable metrics, weighted evaluations, SLA exception calculations, server-enforced engineer exclusion | Extend the secured KPI model into definitions, calculation previews, history and administration |
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
7. KPI data is management-sensitive. `kpis.view` and `kpis.manage` are restricted to
   eligible management roles, and engineers cannot be granted either permission by a
   role or user override. APIs and report summaries enforce the boundary server-side.
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
| 4 | Global Quick Create | Authorized actions launch existing forms through consumed URL intents; shared operational headers; browser QA pending | Complete |
| 5 | Operational dashboards and approval flow | Personal due-work view; management exceptions; closure rejection/reopen with history and scoped tests | Complete |
| 5a | Project closure reviews and backlog | Atomic approval/rejection with required revision comments, actors, request versions, audit history and notifications; manager-only paginated backlog | Complete |
| 5b | Action-focused dashboards | Bounded scoped summaries, accurate service follow-up totals and operational exception cards implemented; browser QA pending | Complete |
| 5c | Closure workflow integrity | Ordinary status edits cannot bypass closure requests or reviews; concurrent edits cannot overwrite closure transitions | Complete |
| 5d | Managed-report review queue | Capability-scoped paginated backlog, protected downloads, versioned decisions, direct notifications and management-dashboard visibility | Complete; PostgreSQL CI tracked per commit |
| 6 | Core detail/list and calendar improvements | Shared detail/timeline patterns; report/follow-up events; server pagination where justified | In progress |
| 6a | Calendar reliability and access | Valid month boundaries, module-aligned scopes, cancellable loads, visible failures and shared accessible event dialog | Complete; browser QA pending |
| 6b | Follow-up/report calendar and agenda | Owner/feature-scoped pending service follow-ups; reports shown on visit dates; agenda exposes all monthly events and activity detail links | Complete; browser QA pending |
| 6c | Task relationship privacy | Dependency details respect task ownership; mentions require task visibility; comment deletion checks current assignment; relationship IDs validated | Complete |
| 6d | Core list/detail loading | Latest-request cancellation and scope guards for delayed refreshes, visible retry states, project access/not-found states and cleared forms on navigation | Complete; browser QA pending |
| 6e | List filter and export consistency | Dashboard overdue/due/approval links select their views; common task list/export validation and filters; explicit seven-date range | Complete; PostgreSQL CI and browser QA tracked per commit |
| 6f | Server-paged Tasks | 25-row UI pages, server filters/sorts and full scoped counts; bounded row enrichment; current-page bulk actions; full matching exports; legacy arrays preserved | Complete; browser QA pending |
| 6g | Reliable waiting-status saves | Shared dialogs retain failed drafts; atomic bulk updates validate reasons and check current ownership; duplicate IDs count once | Complete; PostgreSQL CI and browser QA tracked per commit |
| 6h | Maintenance visit reliability | Scoped cancellable month loads, visible retry and unavailable counts; safe action submissions; manager-only submission undo; keyboard detail access | Complete; browser QA pending |
| 6i | Maintenance filter/export consistency | Shared validated scopes and filters; matching Excel selection/order; literal decrypted customer search; inactive zero flags and month date ranges | Complete; PostgreSQL CI and browser QA tracked per commit |
| 6j | Server-paged project and customer directories | Validated 25-row pages, server-applied search/views, full-result counts, debounced stale-safe loads and legacy array compatibility | Complete; PostgreSQL CI and browser QA tracked per commit |
| 7 | Customer 360 and recommendations | Scoped customer history; persisted findings and follow-up workflow; safe additive migrations | Complete |
| 7a | Customer 360 overview | Manager-scoped bounded related sections, full counts and paginated recorded timeline; existing service profile preserved | Complete; PostgreSQL CI and browser QA tracked per commit |
| 7b | Persisted management recommendations | Finding/risk/owner/due/status/notes, visit-source intent, version conflicts, atomic project conversion and mandatory history; cross-customer links constrained | Complete; PostgreSQL CI and browser QA tracked per commit |
| 7c | Customer asset inventory | Encrypted technical identifiers, technology relationship, Managed / Under support / Neither coverage, lifecycle and support dates, version conflicts, retained history and bounded Customer 360 UI | Complete; PostgreSQL CI and browser QA tracked per commit |
| 7d | Asset operations | Bounded decrypted inventory search, support/warranty attention counts and filters, formula-safe filtered Excel export, template-driven transactional import capped at 500 rows | Complete; PostgreSQL CI and browser QA tracked per commit |
| 7e | Scoped recommendation capture and task conversion | Managers and planners access authorized customer recommendations; engineers use assigned customers/visits/projects with self ownership; author edits and versioned conversion to customer-project tasks preserve links | Complete; PostgreSQL CI and browser QA tracked per commit |
| 8 | Workload model | Estimates/availability and configurable weighting; capacity and pressure shown separately | Complete |
| 8a | Recorded effort and availability | Manager-edited versioned remaining estimates and net weekly hours; four-week task/visit capacity with explicit missing/excluded coverage | Complete; PostgreSQL CI and browser QA tracked per commit |
| 8b | Weighted capacity and operational pressure | Versioned task/visit status factors; separate urgency points for assigned work, pending visit reports and unlinked service follow-ups; bounded manager-only drilldown | Complete; PostgreSQL CI and browser QA tracked per commit |
| 9 | Custom report engine | Approved source metadata, parameterized filters/grouping/aggregations, bounded preview, permission tests | Complete |
| 9a | Approved-source engine | Manager-only metadata, typed parameterized filters, grouping/numeric aggregations, stable sorts, 100-row previews, 5000-row export cap and 5s read-only execution | Complete; PostgreSQL CI tracked per commit |
| 10 | Report Builder UI and saved reports | Field selection, typed filters, grouping, sorts, preview, definitions with private/management visibility and Excel/CSV | Complete; browser QA pending |
| 11 | Report templates and scheduling | Templates use engine; recipient validation; scheduling extends existing jobs after engine is stable | Complete for management scope; browser QA pending |
| 11a | Approved report templates | Eleven editable definitions use the engine with explicit UTC date snapshots and configured project terminal states; workload links to its dedicated model | Complete; browser QA pending |
| 11b | Saved report delivery | Owner-managed versioned daily/weekly/monthly UTC schedules; active manager recipients and current visibility rechecked; bounded CSV queries, atomic claims and visible outcomes | Complete; PostgreSQL CI and browser QA tracked per commit |
| 11c | Existing digest reliability | Await SMTP/report reads, preserve masked credentials, escape stored HTML values and enforce current manager recipient eligibility | Complete; PostgreSQL CI tracked per commit |
| 12 | Admin organization and feature settings | Business/technical sections; capability-based visibility; secrets remain protected | In progress |
| 12a | Administration navigation and credentials | Business/technical areas, shared-capability business links, preserved deep links, keyboard switches and write-only integration credentials with explicit removal | Complete; browser QA pending |
| 12b | Password policy integrity | Malformed values cannot disable expiry; explicit numeric 0 supported; policy and authentication settings persist in one transaction | Complete; CI tracked per commit |
| 12c | Core module access permissions | Versioned role/user overrides gate project, task, visit, customer and asset APIs, downloads and navigation; asset eligibility excludes engineers | Complete; integration coverage included |
| 12d | Reporting and Service Activity permissions | Permission overrides gate report APIs, exports, navigation and Service Activity routes while preserving team/customer ownership scope | Complete; eligible-role policy and integration coverage included |
| 13 | Cross-module quality review | Targeted security/performance tests, responsive and accessibility QA, deployment instructions and final change summary | In progress |
| 13a | Focused browser and release validation | Real-browser production bundle smoke matrix with synthetic APIs, shared-modal focus fix, validation/remaining-work record and corrected deployment requirements | Complete; full staging QA pending |
| 14 | Workspace UI modernization | Compact personal navigation, module launcher, operational dashboard and flatter data-focused page foundations | Complete; CI browser coverage tracked per commit |
| 14a | High-use list workspaces | Shared search/filter/result context across projects, tasks, visits, customers and managed-customer health | Complete; CI browser coverage tracked per commit |
| 14b | Report workspace resilience | Shareable report views, explicit refresh, stale-data warning and direct service-operations links | Complete; CI browser coverage tracked per commit |
| 15 | UI, branding and KPI modernization | Shared enterprise UI adoption, centralized product brand and secure configurable KPI administration | In progress; see `UI_KPI_MODERNIZATION_PLAN.md` |
| 15a | KPI security boundary | Dedicated view/manage capabilities with an invariant engineer denial across APIs, reports, exports and frontend state | Complete; unit, integration and browser coverage included |
| 15b | Brand foundation | TeamHub across user-facing application, documents, email and calendars while compatibility identifiers remain stable | Complete; centralized client/server product constants |
| 15c | Shared enterprise UI primitives | Reusable surfaces, metrics, tables, tabs, badges, fields, pagination and async states with responsive card-table fallback | Complete; first adopted by Managed Customers |
| 15f | Managed Customers presentation | Exception-first portfolio metrics, service-health badges, responsive customer table and consistent dashboard tabs/period controls | Complete; broader screen adoption continues separately |
| 15g | Core screen adoption | Shared responsive tables, filter surfaces, metrics and pagination across operational workspaces | In progress; Customers and Projects complete, Tasks and Visits foundations adopted |
| 16 | Team-aware workflow emphasis | One shared application whose navigation, quick actions, My Work and Customer 360 emphasize relevant workflows from combined team capabilities | Complete |
| 16a | Team capability foundation | Managed Services and Project Delivery emphasis configured per team, combined for multi-team users, with RBAC unchanged | Complete; navigation and quick-create ordering included |
| 16b | Adaptive My Work | Managed Services, Project Delivery and mixed layouts answer what the engineer should work on now while retaining secondary work | Complete; focused browser coverage included |
| 16c | Adaptive Customer 360 | Reorder shared customer sections and quick actions from workflow emphasis without widening API access | Complete; unit coverage included |
| 17 | Performance and reliability | Durable background work, database observability, incremental dashboards, indexed search and recoverability checks | Complete |
| 17a | Database and recovery visibility | Privacy-safe slow-query metrics, pool pressure, backup freshness and non-destructive restore verification in Deployment Health | Complete |
| 17b | Durable background jobs | PostgreSQL-backed atomic queue with retries, deduplication and restart recovery for scheduled reports and ticket synchronization | Complete |
| 17c | Read-path performance | Authorization-scoped operational cache, progressive dashboard loading, paginated Smart Search and PostgreSQL trigram indexes | Complete; performance health checks included |
| 17d | Asynchronous export delivery | Queue large user-requested exports, retain authorized artifacts briefly and notify owners when downloads are ready | Complete; encrypted custom-report artifacts expire after 24 hours |
| 17e | Encrypted customer search index | Keyed trigram candidates and exact-name tokens reduce decryption work while final plaintext verification preserves literal-match behavior | Complete; additive backfill migration and key-rotation recovery included |

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

Use `npm test` in server/client, `npm run test:e2e` in client (mocked-API browser
tests) and a production client build after meaningful code milestones. PostgreSQL CI
is authoritative for locking, for queries unsupported by pg-mem, and for the schema
and SQL check that prepares every static statement. Preserve the existing Docker/Node versions, environment validation and
PostgreSQL migration conventions. Record new migrations, configuration and jobs
alongside the stage that introduces them. Do manual responsive/keyboard QA before
production deployment; report only checks actually performed.

Focused Report Builder/Settings browser smoke checks and the remaining acceptance
items are recorded in [PLATFORM_VALIDATION.md](PLATFORM_VALIDATION.md). They do not
replace manual staging QA of the entire app.
