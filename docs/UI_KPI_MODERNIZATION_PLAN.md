# UI, branding and KPI modernization plan

Reviewed on 2026-09-23 against `DEV-3` at commit `975cb61`. This document records
the architecture review and recommended delivery sequence. It deliberately separates
security, data-model and design-system work so each stage can be reviewed, tested,
committed and deployed independently.

## Current architecture

### Application shell and navigation

`client/src/App.jsx` owns authentication, the responsive shell, compact pinned-module
rail, module launcher, command palette, global search, quick create, notifications,
theme and density. `client/src/navigation.js` is the shared page/capability registry.
This is a sound foundation: navigation discovery is centralized, mobile navigation
uses focus isolation, and the persistent rail is already intentionally short.

The shell remains a large module and contains substantial presentation code. Branding
is embedded directly in the shell and in reports, email, calendar feeds, document
metadata and deployment examples. A user-facing rename must therefore be centralized
rather than implemented as a collection of unrelated text replacements.

### Shared UI

The app already has useful shared primitives:

- `PageHeader` and `PageState` for page framing and access/error states;
- `Modal`, status/RAG/priority badges, progress and empty states;
- `ListSearch`, `FilterGroup` and `ResultContext` for operational lists;
- global card, table, form, tab, button, badge, dialog and density rules;
- cancellable request and saved-filter hooks.

Adoption is incomplete. The JSX tree still contains about 1,991 inline style objects.
Dashboard, App, Calendar, Activity Log, Search and Project Detail range from roughly
740 to 1,150 lines, while admin and project subsections define local versions of
cards, tables, toggles, states and layouts. `index.css`, `foundations.css` and feature
styles sometimes redefine the same surface. This makes spacing, interaction states,
dark mode and responsive behavior depend on which page implemented a control.

### Managed Customers

The directory now has a strong operational entry point: search, team/manager/status
filters, health context and direct customer actions. The customer workspace contains
valuable ticket, activity, service-review, reporting and timeline views, but much of
the presentation is still feature-specific. The next pass should reuse the same
metric, toolbar, tab, table, state and trend components as the rest of the product,
and prioritize exceptions and next actions over a dense wall of equal-weight cards.

### Loading, empty and error behavior

Recent screens use cancellable requests, skeletons, preserved last-good data and retry
actions. Older screens still use plain text loading messages, local empty-state markup,
or promise chains without stale-response protection. A shared async boundary should
make loading, initial error, refresh error, empty and permission-denied states explicit
without replacing usable data during a failed refresh.

## KPI findings and security boundary

The current `kpis` table stores a small per-project record: name, target, current value,
unit and update metadata. The project KPI form supports only those fields. There is no
definition catalogue, calculation registry, enabled state, direction, thresholds,
team scope, display order, visualization setting, version conflict detection or value
history.

The current API conflicts with the new security requirement. `GET /api/kpis/:project`
returns KPI rows to an engineer assigned to that project. The project page hides the
KPI tab from engineers, but direct API access still returns the data. Existing tests
explicitly assert that assigned engineers receive it. This must be corrected before
the richer KPI model is introduced.

Management report summaries also embed `kpiHealth`. That route is manager-only today,
but KPI authorization should not remain coupled to general report access. KPI data
must use a dedicated permission check at every read, calculation, history, preview,
export and report boundary.

Add two capabilities to the existing versioned override system:

- `kpis.view` — access KPI dashboards, current values and history;
- `kpis.manage` — create/edit definitions, preview calculations, enable/disable and
  record or recalculate values.

Managers receive both by default. PMs and planners may receive them through explicit
role/user overrides when the business wants authorized management access. Engineers
are ineligible even if an override row is inserted manually. Enforce that invariant
inside the permission service and KPI middleware, and reject attempts to create an
engineer allow-rule for either KPI capability. The browser remains a presentation
layer and is never the security boundary.

Negative integration tests must prove that an engineer receives no KPI fields or rows
from direct KPI endpoints, project responses, report summaries, custom reports,
exports, previews, histories, saved reports or download-token routes. Tests should use
both assigned and unassigned engineers and should verify that a forged permission
override cannot bypass the hard denial.

## Recommended KPI model

Introduce additive tables and migrate existing records without deleting them.

### `kpi_definitions`

- identity: `id`, `name`, `description`, `category`, `unit`;
- calculation: approved `data_source`, versioned `calculation_config` JSON;
- evaluation: `target_value`, `warning_threshold`, `critical_threshold`,
  `direction` (`higher` or `lower`);
- scope: `scope_type` (`organization`, `team`, `project`, `managed_customer`) and an
  optional `team_id` where the definition belongs to one team;
- presentation: `visualization_type` (`number`, `gauge`, `progress`, `trend`, `bar`),
  `display_order`, `enabled`;
- safety/audit: `version`, `created_by`, `updated_by`, `created_at`, `updated_at`.

Do not accept SQL, table names or expressions from the browser. `data_source` must be
a key in an approved server registry. Initial sources should be small and verifiable:
manual, project delivery, tasks, maintenance visits, service activities, SLA and
managed tickets. Each source defines supported scopes, configuration fields, units,
query limits and calculation code.

### `kpi_values`

Store immutable calculated/manual snapshots with `definition_id`, scope identifiers,
value, status, period start/end, calculation timestamp, actor and a bounded source
summary. Index definition/scope/time for current-value and trend reads. Current value
is the newest authorized snapshot; history is paginated and never inferred from a
mutable `updated_at` timestamp.

Existing project KPI rows should migrate to project-scoped manual definitions plus one
initial value snapshot. Keep a compatibility read only for the migration window, then
remove it after the new UI and tests use the definition/value APIs.

### API shape

- `GET /api/kpi-definitions` — filtered, paginated catalogue and current scope value;
- `POST /api/kpi-definitions` — create a versioned definition;
- `PUT /api/kpi-definitions/:id` — conflict-safe edit;
- `POST /api/kpi-definitions/:id/state` — activate/deactivate with version check;
- `POST /api/kpi-definitions/preview` — validate and calculate an unsaved draft;
- `POST /api/kpi-definitions/:id/test` — run a saved definition without persisting;
- `POST /api/kpi-definitions/:id/calculate` — persist an authorized snapshot;
- `GET /api/kpi-definitions/:id/values` — current value plus paginated history;
- `GET /api/kpi-dashboard` — bounded current values and trends for permitted scopes.

All mutations are audited. Definition edits use optimistic versions. Preview/test
calls have a short timeout, bounded date window and row limits. Calculation failures
return a safe message and retain the last successful value.

## Recommended UI system

Continue with React and plain CSS; a component-library migration would add risk without
solving inconsistent usage. Build a small, documented component layer over the current
tokens:

- `Surface` / `Section` — consistent card padding, header, description and actions;
- `DataTable` — table frame, numeric alignment, row actions, selection, responsive
  fallback and loading/empty/error rows;
- `Field`, `FieldGroup`, `FormActions` — labels, help, required/error text and layout;
- `Tabs` — URL-backed tabs with overflow behavior and keyboard semantics;
- `Badge` — semantic tone and optional dot/icon, including configured statuses;
- `Dialog` / `Drawer` — the existing focus-safe modal behavior with standard widths,
  destructive confirmation and mobile layout;
- `AsyncState` — initial skeleton, empty, denied, fatal error and stale-data warning;
- `MetricStrip`, `Toolbar`, `Pagination` and `TrendChart` — shared dashboard/list parts.

Move visual decisions into semantic CSS classes and tokens. Inline styles remain valid
for truly calculated values such as chart coordinates or progress width, but spacing,
color, typography, alignment, borders and breakpoints belong in components/CSS. New
feature work should not add a local card, table, badge, tab or dialog implementation
when a shared primitive exists.

Keep the current compact rail, launcher and command palette. Refine navigation by:

- showing a short role-aware primary set and using the launcher for the full catalogue;
- adding a dedicated KPI Management destination only for `kpis.manage`;
- showing KPI dashboards only for `kpis.view`;
- keeping section/page context and recent modules consistent on desktop and mobile;
- preserving deep links and keyboard focus when permissions change during a session.

## KPI administration experience

Add **KPI Management** under Settings → Business and a management dashboard entry.
The catalogue should provide search, category/source/scope/team/state filters, current
health, last calculation, ordered display and row actions. Creation/editing uses a
drawer or wide dialog with these sections:

1. Identity — name, description, category and unit.
2. Calculation — approved data source and source-specific configuration.
3. Evaluation — target, warning, critical and direction, with validation that threshold
   order matches higher-is-better or lower-is-better.
4. Scope — scope type and eligible team/entity selection.
5. Presentation — visualization, display order and enabled state.
6. Preview — sample/current value, evaluated health, input facts and safe failure text.

The detail view should show current value, target/threshold context, calculation source,
last successful run and a bounded trend chart. Deactivation preserves history. Manual
KPIs expose an explicit value-entry action; calculated sources never accept a browser-
supplied result as authoritative.

## Branding approach

Introduce central brand constants for product name, short name, report author, email
label and calendar label. Apply the selected name to the browser title, application
shell, login, print views, report/PDF/Word/Excel metadata, email subjects/content,
integration-test messages, TOTP issuer/display name, iCal display name and user-facing
documentation.

Preserve these compatibility identifiers during the visual rename:

- `solutionshub_session` cookie name;
- `X-SolutionsHub-Request` CSRF header;
- existing iCal event UIDs;
- Docker volumes, database names, systemd unit filename and installed directories.

Changing them provides no user benefit and could invalidate sessions, duplicate
calendar events or complicate upgrades. They can be migrated separately only if there
is a concrete operational requirement.

Confirmed product name: **TeamHub**. Client and server product constants provide the
canonical user-facing name while established compatibility identifiers remain stable.

## Incremental delivery

| Stage | Scope | Acceptance |
| --- | --- | --- |
| 15a | KPI security boundary | `kpis.view/manage`; engineer hard deny; direct/report/export negative tests; no engineer KPI bytes |
| 15b | Brand foundation | Confirmed name centralized and applied to user-facing surfaces; compatibility identifiers unchanged |
| 15c | UI primitives | Shared surface/table/form/tabs/badge/dialog/async APIs with responsive, dark and keyboard tests |
| 15d | KPI schema and calculation registry | Additive definitions/value history migration; approved sources; versions, audit, timeouts and bounds |
| 15e | KPI administration | Catalogue, form, preview/test, activation, current values and trends; permission-aware navigation |
| 15f | Managed Customers presentation | Exception-first overview and shared metrics/tables/states/trends without changing workflow scope |
| 15g | Core screen adoption | Migrate dashboard, reports, projects/tasks/visits, calendar and admin in small page-specific commits |
| 15h | Release validation | PostgreSQL route/security tests; 390/768/1440 light/dark matrix; keyboard and manual staging record |

Stages 15a and 15b establish the security and brand foundations. Stages 15c–15g should
migrate one coherent screen family per commit rather than rewriting the application
shell and all feature pages at once.

## Definition of done

- Engineers cannot obtain KPI definitions, values, history, calculations or derived KPI
  fields through any API, report, export, download or direct URL.
- Authorized management users can manage every requested definition attribute, preview
  calculations, inspect current values, activate/deactivate and review stored trends.
- Cards, tables, forms, tabs, badges, dialogs and async states use shared components on
  every migrated screen and retain light/dark and compact/comfortable behavior.
- Core workflows fit 390, 768 and 1440 pixel viewports without page overflow; tables
  provide deliberate responsive behavior rather than accidental clipping.
- Empty, loading, denied, initial-error and refresh-error states are visually and
  behaviorally distinct, keyboard accessible and recoverable where retry is possible.
- The selected product name is consistent on all user-facing surfaces while upgrades
  retain existing sessions, data volumes, encrypted data and calendar identity.
