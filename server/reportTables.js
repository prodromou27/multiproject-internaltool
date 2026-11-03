/**
 * The tables in customer reports (Word, PDF and Excel), and which columns each
 * can show. A report template can choose, per table, the columns and their
 * order, how rows are sorted, and at most how many rows (template "tables").
 * Without a choice, each format keeps its usual columns: `doc` marks the Word
 * and PDF defaults, `xls` the Excel ones (a wider sheet).
 */
const yesNo = value => (value === null || value === undefined ? '' : value ? 'Yes' : 'No');
const day = value => (value ? String(value).slice(0, 10) : '');
const dash = value => (value === null || value === undefined || value === '' ? '-' : value);
const col = (key, label, get, { doc = false, xls = false, width = 16 } = {}) => ({ key, label, get, doc, xls, width });

const ticketColumns = [
  col('ticket', 'Ticket', r => r.ticket_number, { doc: true, xls: true, width: 14 }),
  col('subject', 'Subject', r => r.subject, { doc: true, xls: true, width: 42 }),
  col('status', 'Status', r => r.normalized_status, { doc: true, xls: true }),
  col('priority', 'Priority', r => r.normalized_priority, { doc: true, xls: true, width: 14 }),
  col('owner', 'Owner', r => r.owner_name, { doc: true, xls: true, width: 20 }),
  col('created', 'Created', r => r.created_at_external, { doc: true, xls: true, width: 20 }),
  col('updated', 'Updated', r => r.updated_at_external, { xls: true, width: 20 }),
  col('resolved', 'Resolved', r => r.resolved_at_external, { xls: true, width: 20 }),
  col('sla_breached', 'SLA breached', r => yesNo(r.sla_breached), { xls: true, width: 14 }),
];

const TABLES = Object.freeze({
  open_tickets: { title: 'Open Tickets', available: m => m.tickets.enabled, rows: m => m.tickets.open.rows, columns: ticketColumns },
  period_tickets: { title: 'Tickets Created During Period', available: m => m.tickets.enabled, rows: m => m.tickets.period.rows, columns: ticketColumns },
  service_activities: { title: 'Service Activities', sheet: 'Activities', available: m => m.activities.enabled, rows: m => m.activities.rows, columns: [
    col('date', 'Date', r => r.activity_date, { doc: true, xls: true, width: 14 }),
    col('reference', 'Reference', r => r.activity_reference, { doc: true, xls: true, width: 18 }),
    col('activity', 'Activity', r => r.title, { doc: true, xls: true, width: 42 }),
    col('assets', 'Asset / version', r => r.assets_label, { doc: true, xls: true, width: 30 }),
    col('engineer', 'Engineer', r => r.engineer_name, { doc: true, xls: true, width: 22 }),
    col('category', 'Category', r => r.category_name, { doc: true, xls: true, width: 20 }),
    col('hours', 'Hours', r => Math.round(Number(r.duration_minutes || 0) / 6) / 10, { doc: true, width: 10 }),
    col('minutes', 'Minutes', r => r.duration_minutes, { xls: true, width: 10 }),
    col('location', 'Location', r => r.work_location, { xls: true, width: 14 }),
    col('billing', 'Billing', r => r.billable_classification, { xls: true, width: 16 }),
    col('ticket', 'Ticket', r => r.ticket_reference, { xls: true, width: 14 }),
    col('description', 'Description', r => r.description, { width: 50 }),
  ] },
  tasks: { title: 'Tasks', available: m => m.tasks.enabled, rows: m => m.tasks.rows, columns: [
    col('task', 'Task', r => r.title, { doc: true, xls: true, width: 42 }),
    col('project', 'Project', r => r.project_title, { doc: true, xls: true, width: 32 }),
    col('engineer', 'Engineer', r => r.assigned_to_name, { doc: true, xls: true, width: 22 }),
    col('status', 'Status', r => r.status, { doc: true, xls: true }),
    col('priority', 'Priority', r => r.priority, { doc: true, xls: true, width: 14 }),
    col('due', 'Due', r => r.deadline, { doc: true, xls: true, width: 14 }),
    col('updated', 'Updated', r => r.updated_at, { xls: true, width: 20 }),
  ] },
  projects: { title: 'Projects', available: m => m.projects.enabled, rows: m => m.projects.rows, columns: [
    col('project', 'Project', r => r.title, { doc: true, xls: true, width: 42 }),
    col('status', 'Status', r => r.status, { doc: true, xls: true }),
    col('priority', 'Priority', r => r.priority, { doc: true, xls: true, width: 14 }),
    col('progress', 'Progress %', r => `${r.completion_pct}%`, { doc: true, xls: true, width: 14 }),
    col('tasks', 'Tasks', r => r.task_count, { xls: true, width: 10 }),
    col('done', 'Done', r => r.done_count, { xls: true, width: 10 }),
    col('deadline', 'Deadline', r => r.deadline, { doc: true, xls: true, width: 14 }),
    col('closed', 'Closed', r => day(r.closed_at), { xls: true, width: 14 }),
  ] },
  maintenance_visits: { title: 'Maintenance Visits', available: m => m.maintenance_visits.enabled, rows: m => m.maintenance_visits.rows, columns: [
    col('date', 'Date', r => r.scheduled_date, { doc: true, xls: true, width: 14 }),
    col('visit', 'Visit', r => r.title, { doc: true, xls: true, width: 42 }),
    col('engineer', 'Engineer', r => r.engineer_name, { doc: true, xls: true, width: 22 }),
    col('status', 'Status', r => r.status, { doc: true, xls: true }),
    col('report_prepared', 'Report prepared', r => yesNo(r.report_sent), { xls: true }),
    col('report_sent', 'Report sent', r => yesNo(r.report_sent_to_customer), { doc: true, xls: true }),
    col('recommendations', 'Recommendations', r => r.recommendation_count, { doc: true, xls: true }),
  ] },
  changes: { title: 'Changes and upgrades', sheet: 'Changes', available: () => true, rows: m => m.changes || [], columns: [
    col('date', 'Date', r => r.date, { doc: true, xls: true, width: 14 }),
    col('device', 'Device', r => dash(r.asset), { doc: true, xls: true, width: 24 }),
    col('from', 'From', r => dash(r.previous_version), { doc: true, xls: true, width: 14 }),
    col('to', 'To', r => dash(r.new_version), { doc: true, xls: true, width: 14 }),
    col('change', 'Change', r => r.title, { doc: true, xls: true, width: 42 }),
    col('engineer', 'Engineer', r => r.engineer, { doc: true, xls: true, width: 22 }),
    col('reference', 'Reference', r => r.reference, { xls: true, width: 18 }),
    col('category', 'Category', r => r.category, { width: 20 }),
    col('risk', 'Risk', r => r.risk, { width: 12 }),
    col('reason', 'Reason', r => r.reason, { width: 40 }),
    col('approval', 'Customer approval', r => r.approval_reference, { width: 18 }),
  ] },
  resolved_tickets: { title: 'Resolved tickets', sheet: 'Resolved Tickets', available: m => m.tickets.enabled, rows: m => m.resolved_tickets || [], columns: [
    col('ticket', 'Ticket', r => r.ticket_number, { doc: true, xls: true, width: 14 }),
    col('subject', 'Subject', r => r.subject, { doc: true, xls: true, width: 50 }),
    col('priority', 'Priority', r => r.normalized_priority, { doc: true, xls: true, width: 14 }),
    col('owner', 'Owner', r => r.owner_name, { doc: true, xls: true, width: 22 }),
    col('created', 'Created', r => day(r.created_at_external), { width: 14 }),
    col('resolved', 'Resolved', r => day(r.resolved_at), { doc: true, xls: true, width: 14 }),
  ] },
  assets: { title: 'Assets and support status', sheet: 'Assets', available: () => true, rows: m => m.assets || [], columns: [
    col('asset', 'Asset', r => r.name, { doc: true, xls: true, width: 28 }),
    col('type', 'Type', r => r.type, { doc: true, xls: true }),
    col('vendor', 'Vendor', r => r.vendor, { width: 16 }),
    col('model', 'Model', r => r.model, { width: 18 }),
    col('version', 'Version', r => dash(r.version), { doc: true, xls: true, width: 14 }),
    col('criticality', 'Criticality', r => r.criticality, { width: 12 }),
    col('environment', 'Environment', r => r.environment, { width: 14 }),
    col('support_end', 'Support ends', r => dash(r.support_end), { doc: true, xls: true, width: 14 }),
    col('support', 'Support', r => dash(r.support_status), { doc: true, xls: true, width: 22 }),
    col('warranty_end', 'Warranty ends', r => dash(r.warranty_end), { xls: true, width: 14 }),
    col('warranty', 'Warranty', r => dash(r.warranty_status), { doc: true, xls: true, width: 22 }),
    col('provider', 'Support provider', r => r.support_provider, { width: 20 }),
  ] },
  recommendations: { title: 'Recommendations', available: m => m.recommendations.enabled, rows: m => m.recommendations.rows, columns: [
    col('finding', 'Finding', r => r.finding, { doc: true, xls: true, width: 40 }),
    col('recommendation', 'Recommendation', r => r.recommendation, { doc: true, xls: true, width: 50 }),
    col('risk', 'Risk', r => r.risk_level, { doc: true, xls: true, width: 14 }),
    col('status', 'Status', r => r.status, { doc: true, xls: true, width: 20 }),
    col('owner', 'Owner', r => r.owner_name, { doc: true, xls: true, width: 22 }),
    col('due', 'Due', r => r.due_date, { doc: true, xls: true, width: 14 }),
    col('source_visit', 'Source visit', r => r.source_visit_title, { xls: true, width: 30 }),
  ] },
});

/** What the template editor offers: every table with all its columns and the defaults. */
function catalogue() {
  return Object.entries(TABLES).map(([key, table]) => ({ key, title: table.title,
    columns: table.columns.map(column => ({ key: column.key, label: column.label, default_document: column.doc, default_spreadsheet: column.xls })) }));
}

/** Checks a template's table choices: { [table]: { columns: [keys], sort: { column, direction }, limit } }. */
function validateTables(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('Table settings must be an object'), { status: 400 });
  const out = {};
  for (const [key, choice] of Object.entries(value)) {
    const table = TABLES[key];
    if (!table) throw Object.assign(new Error(`Unknown report table: ${key}`), { status: 400 });
    if (!choice || typeof choice !== 'object' || Array.isArray(choice)) throw Object.assign(new Error(`Settings for ${table.title} must be an object`), { status: 400 });
    const known = new Set(table.columns.map(column => column.key));
    const columns = Array.isArray(choice.columns) ? [...new Set(choice.columns)] : [];
    if (!columns.length) throw Object.assign(new Error(`Choose at least one column for ${table.title}`), { status: 400 });
    const unknown = columns.find(column => !known.has(column));
    if (unknown) throw Object.assign(new Error(`${table.title} has no column "${unknown}"`), { status: 400 });
    const entry = { columns };
    if (choice.sort?.column) {
      if (!known.has(choice.sort.column)) throw Object.assign(new Error(`${table.title} cannot be sorted by "${choice.sort.column}"`), { status: 400 });
      entry.sort = { column: choice.sort.column, direction: choice.sort.direction === 'desc' ? 'desc' : 'asc' };
    }
    if (choice.limit !== undefined && choice.limit !== null && choice.limit !== '') {
      const limit = Number(choice.limit);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5000) throw Object.assign(new Error(`The row limit for ${table.title} must be from 1 to 5000`), { status: 400 });
      entry.limit = limit;
    }
    out[key] = entry;
  }
  return out;
}

const compare = (a, b) => {
  if (a === b) return 0;
  if (a === null || a === undefined || a === '') return 1;
  if (b === null || b === undefined || b === '') return -1;
  const x = Number(a), y = Number(b);
  if (!Number.isNaN(x) && !Number.isNaN(y) && String(a).trim() !== '' && String(b).trim() !== '') return x - y;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
};

/** A table's rows, sorted and cut to the template's row limit (also used by uploaded Word templates). */
function orderedRows(model, key) {
  const table = TABLES[key], choice = model.tables?.[key];
  let rows = [...(table.rows(model) || [])];
  const sorter = choice?.sort && table.columns.find(column => column.key === choice.sort.column);
  if (sorter) rows.sort((a, b) => compare(sorter.get(a), sorter.get(b)) * (choice.sort.direction === 'desc' ? -1 : 1));
  if (choice?.limit) rows = rows.slice(0, choice.limit);
  return rows;
}

/**
 * A table ready to draw: { title, sheet, columns: [{ key, label, width }], rows: [[values]] },
 * using the template's choice, else the format's usual columns. `format` is 'document' or 'spreadsheet'.
 */
function tableFor(model, key, format = 'document') {
  const table = TABLES[key];
  if (!table || !table.available(model)) return null;
  const choice = model.tables?.[key];
  const columns = choice ? choice.columns.map(columnKey => table.columns.find(column => column.key === columnKey)).filter(Boolean)
    : table.columns.filter(column => (format === 'spreadsheet' ? column.xls : column.doc));
  const rows = orderedRows(model, key);
  return { title: table.title, sheet: table.sheet || table.title, columns: columns.map(({ key: columnKey, label, width }) => ({ key: columnKey, label, width })), rows: rows.map(row => columns.map(column => column.get(row) ?? '')) };
}

module.exports = { TABLES, catalogue, validateTables, orderedRows, tableFor };
