# Staging acceptance checklist

Use this checklist against the exact DEV-3 revision intended for production. Record
the revision, tester, date, browser/device and evidence links. Automated CI and mocked
browser fixtures are prerequisites; they do not replace these checks against the real
API, PostgreSQL data, storage, SMTP and configured integrations.

## Release record

| Field | Value |
| --- | --- |
| Commit | |
| Staging URL | |
| Database migration completed | |
| Tester and date | |
| Desktop browser / OS | |
| Mobile or tablet device | |
| Screen reader / browser | |
| Result | Pass / Conditional / Fail |

## Preflight and recovery

- Confirm the deployment uses the reviewed commit and `/api/health` returns healthy.
- Confirm startup migrations complete once and a restart adds no duplicate migration.
- Confirm database and encrypted-file backups exist and a restore owner is identified.
- Keep the existing JWT, field-encryption and attachment-encryption keys available to
  the deployment. Verify an existing encrypted customer and attachment can be read.
- Confirm production does not expose in-app system updates unless explicitly enabled.
- Check server and proxy logs for startup errors, rejected migrations and repeated 5xx
  responses before beginning workflow tests.

## Role and permission matrix

Use separate manager, planner, PM and engineer accounts. Include an engineer in an
enabled Service Activity team, an engineer outside that team and a user with one
explicit permission override.

- Verify the navigation and module launcher expose only permitted modules.
- Open protected URLs directly; confirm server responses reject unavailable actions.
- Change one role override and one user override, refresh the active session, verify
  the effective access, then restore the defaults.
- Verify customer, project, visit and activity membership boundaries with two customers
  and two engineers. Test both reads and mutations.
- Confirm download links and exports enforce the same scope as their source screen.
- Confirm private notes, notification history and personal work remain owner-only.

## Critical workflows

- Create, edit and close a project; reject one closure with a revision comment and
  resubmit it. Attempt a stale concurrent edit from a second session.
- Create and bulk-update tasks, including waiting reasons, dependencies, time logs and
  an Excel export that matches the active filters.
- Schedule and reassign a maintenance visit, submit its internal report, forward it to
  the customer and exercise the permitted undo action.
- Create, edit, complete, duplicate and export a Service Activity. Attach a valid file,
  reject a spoofed file, create a follow-up task and provoke a version conflict from a
  second session.
- Create a customer asset with hostname, IP, version and Managed/Under support coverage.
  Exercise search, attention filters, attachment, import, export and stale-edit handling.
- Capture a customer recommendation as manager, planner and authorized engineer. Convert
  one to a project and one to a task; verify unauthorized customer/project combinations
  are rejected.
- Generate a custom report, save it, schedule delivery to eligible recipients and verify
  the recorded outcome. Exercise a managed report through review and publication.
- Confirm notification read/acknowledge behavior and one configured outbound channel in
  a test destination. Do not use production customer recipients during acceptance.

## Responsive, theme and accessibility

Test the Dashboard, Projects, Tasks, Maintenance Visits, Calendar, Activity Log,
Customers, Customer 360, Managed Customers, Reports and Settings.

- At 390, 768 and 1440 CSS pixels, verify no page-level horizontal overflow, clipped
  actions, inaccessible filters or dialogs outside the viewport.
- Check light and dark themes, including tables, status badges, charts, calendar events,
  focus rings, alerts, disabled controls and empty/error states.
- Complete each critical workflow using only the keyboard. Verify the skip link, logical
  focus order, visible focus, drawer/dialog focus traps, Escape behavior and focus return.
- With a screen reader, verify one page heading, useful landmarks, named controls,
  announced validation/errors, table headers and status text that does not depend on
  color alone.
- At 200% browser zoom, verify content reflows and primary actions remain reachable.
- Confirm touch targets and scrolling on one real phone or tablet; browser emulation is
  supporting evidence only.

## Reliability and performance

- Repeat list searches quickly and navigate away during loading; stale responses must
  not replace the current view.
- Simulate or temporarily force one 5xx response for customers, reports and integrations;
  confirm Retry works and saved data is not replaced by writable defaults.
- Check representative large customer, project, task, activity and visit datasets.
  Record response time and transferred rows for list, detail and export requests.
- Verify scheduled jobs start once, graceful shutdown stops them and a restart does not
  duplicate notification/report deliveries.
- Review browser console, failed network requests, server logs and PostgreSQL slow-query
  evidence. Record every accepted exception with an owner and target date.

## Sign-off

Production approval requires all critical workflows and authorization checks to pass.
For each conditional item, record impact, workaround, owner and due date. Attach the CI
run, screenshots or recordings for responsive/accessibility findings, server log window,
and any performance measurements to the release record.
