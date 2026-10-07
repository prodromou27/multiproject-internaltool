/**
 * KPI definitions: what is measured (a data source), over which period, for
 * whom (organisation, team, project, customer or one engineer), and the target
 * with warning and critical thresholds. A KPI on a team or the organisation can
 * also be measured per engineer, each against the same target.
 *
 * Besides values the app already holds (tickets, activities, tasks, visits,
 * time, projects, recommendations), a KPI can count "records" a manager logs
 * for it (trainings completed, certifications achieved…), or take a value a
 * manager types in.
 */
const appTime = require('./appTime');

const PEOPLE = ['organization', 'team', 'engineer'];
const source = (key, label, description, { unit = '', period = true, scopes, people = true, percent = false } = {}) =>
  ({ key, label, description, unit: percent ? '%' : unit, period, scopes, people, percent });
const DATA_SOURCES = Object.freeze([
  source('manual', 'Manual value', 'A value a manager types in the definition.', { period: false, people: false, scopes: ['organization', 'team', 'project', 'customer', 'engineer'] }),
  source('records', 'Recorded entries', 'Entries a manager records for this KPI, such as trainings completed or certifications achieved: counted, or their values added up.', { scopes: PEOPLE }),
  source('tickets_resolved', 'Tickets resolved', 'Tickets resolved or closed in Request Tracker (not rejected). For a customer, its queue; otherwise tickets owned by linked engineers, in any queue.', { unit: 'tickets', scopes: [...PEOPLE, 'customer'] }),
  source('ticket_resolution_days', 'Average days to resolve a ticket', 'From when a ticket was created to when it was resolved.', { unit: 'days', scopes: [...PEOPLE, 'customer'] }),
  source('ticket_due_met', 'Tickets resolved by their due date', 'Share of resolved tickets that had a Request Tracker due date and were resolved by it.', { percent: true, scopes: [...PEOPLE, 'customer'] }),
  source('open_tickets', 'Open tickets now', 'Tickets open in Request Tracker right now.', { unit: 'tickets', period: false, scopes: [...PEOPLE, 'customer'] }),
  source('activities_logged', 'Service activities logged', 'Service activities recorded (not cancelled).', { unit: 'activities', scopes: [...PEOPLE, 'customer', 'project'] }),
  source('service_hours', 'Service activity hours', 'Hours recorded on service activities.', { unit: 'hours', scopes: [...PEOPLE, 'customer', 'project'] }),
  source('tasks_completed', 'Tasks completed', 'Tasks moved to completed or closed in the period.', { unit: 'tasks', scopes: [...PEOPLE, 'customer', 'project'] }),
  source('task_completion', 'Task completion rate', 'Share of tasks that are completed or closed.', { percent: true, period: false, scopes: [...PEOPLE, 'customer', 'project'] }),
  source('tasks_on_time', 'Tasks completed on time', 'Share of tasks completed in the period, that had a due date, completed by it.', { percent: true, scopes: [...PEOPLE, 'customer', 'project'] }),
  source('overdue_tasks', 'Overdue tasks', 'Open tasks past their due date right now.', { unit: 'tasks', period: false, scopes: [...PEOPLE, 'customer', 'project'] }),
  source('visits_completed', 'Maintenance visits completed', 'Visits completed in the period.', { unit: 'visits', scopes: [...PEOPLE, 'customer'] }),
  source('visit_reports_on_time', 'Visit reports on time', 'Share of visits in the period whose report was submitted within the visit report SLA (Settings → SLAs).', { percent: true, scopes: [...PEOPLE, 'customer'] }),
  source('time_logged', 'Time logged', 'Hours logged on tasks and visits.', { unit: 'hours', scopes: [...PEOPLE, 'project'] }),
  source('project_completion', 'Project completion', 'Average completion of open projects.', { percent: true, period: false, people: false, scopes: ['organization', 'team', 'project', 'customer'] }),
  source('open_recommendations', 'Open customer recommendations', 'Recommendations not yet implemented, rejected or closed.', { unit: 'recommendations', period: false, scopes: [...PEOPLE, 'customer'] }),
]);
const SOURCES = Object.fromEntries(DATA_SOURCES.map(item => [item.key, item]));
const SOURCE_KEYS = new Set(Object.keys(SOURCES));
const DIRECTIONS = new Set(['higher', 'lower']);
const SCOPES = new Set(['organization', 'team', 'project', 'customer', 'engineer']);
const VISUALIZATIONS = new Set(['number', 'gauge', 'progress', 'trend', 'bar']);
const PERIODS = Object.freeze({ month: 'This month', quarter: 'This quarter', year: 'This year', last_30: 'Last 30 days', last_90: 'Last 90 days', last_365: 'Last 365 days', all: 'All time' });

function text(value, label, max, { required = false } = {}) {
  if (value === undefined || value === null) return required ? { error: `${label} is required` } : { value: null };
  if (typeof value !== 'string') return { error: `${label} must be text` };
  const normalized = value.trim();
  if (required && !normalized) return { error: `${label} is required` };
  if (normalized.length > max) return { error: `${label} cannot exceed ${max} characters` };
  return { value: normalized || null };
}

function finiteNumber(value, label) {
  const number = typeof value === 'number' ? value : Number(value);
  if (value === '' || value === null || value === undefined || !Number.isFinite(number)) return { error: `${label} must be a finite number` };
  return { value: number };
}

function positiveInteger(value, label, { min = 0, max = 1000000 } = {}) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) return { error: `${label} must be an integer from ${min} to ${max}` };
  return { value: number };
}
const optionalId = (value, label) => (value === null || value === undefined || value === '' ? { value: null } : positiveInteger(value, label, { min: 1 }));

function validateDefinition(input = {}, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'A KPI definition is required' };
  const required = !partial;
  const result = {};
  for (const [key, label, max, isRequired] of [
    ['name', 'Name', 120, true], ['description', 'Description', 1000, false], ['category', 'Category', 80, true],
  ]) {
    if (input[key] !== undefined || required) {
      const parsed = text(input[key], label, max, { required: isRequired });
      if (parsed.error) return parsed;
      result[key] = parsed.value;
    }
  }
  for (const [key, allowed, label] of [
    ['data_source', SOURCE_KEYS, 'Data source'], ['direction', DIRECTIONS, 'Direction'],
    ['scope_type', SCOPES, 'Scope'], ['visualization_type', VISUALIZATIONS, 'Visualization type'],
  ]) {
    if (input[key] !== undefined || required) {
      if (typeof input[key] !== 'string' || !allowed.has(input[key])) return { error: `${label} is invalid` };
      result[key] = input[key];
    }
  }
  for (const [key, label] of [['target_value', 'Target'], ['warning_threshold', 'Warning threshold'], ['critical_threshold', 'Critical threshold']]) {
    if (input[key] !== undefined || required) {
      const parsed = finiteNumber(input[key], label);
      if (parsed.error) return parsed;
      result[key] = parsed.value;
    }
  }
  if (input.display_order !== undefined || required) {
    const parsed = positiveInteger(input.display_order ?? 0, 'Display order');
    if (parsed.error) return parsed;
    result.display_order = parsed.value;
  }
  if (input.enabled !== undefined || required) {
    if (typeof input.enabled !== 'boolean') return { error: 'Enabled must be true or false' };
    result.enabled = input.enabled;
  }
  if (input.calculation_config !== undefined || required) {
    if (!input.calculation_config || typeof input.calculation_config !== 'object' || Array.isArray(input.calculation_config)) return { error: 'Calculation configuration must be an object' };
    const encoded = JSON.stringify(input.calculation_config);
    if (encoded.length > 4000) return { error: 'Calculation configuration is too large' };
    result.calculation_config = { ...input.calculation_config };
  }
  const dataSource = result.data_source ?? input.data_source;
  const config = result.calculation_config ?? input.calculation_config ?? {};
  const meta = SOURCES[dataSource];
  if (dataSource === 'manual') {
    const manual = finiteNumber(config.manual_value, 'Manual value');
    if (manual.error) return manual;
    result.calculation_config = { ...config, manual_value: manual.value };
  }
  if (meta && result.calculation_config) {
    const next = { ...result.calculation_config };
    if (next.period !== undefined && !(next.period in PERIODS)) return { error: 'Period is invalid' };
    if (next.period !== undefined && !meta.period) delete next.period;
    if (next.per_engineer !== undefined && typeof next.per_engineer !== 'boolean') return { error: 'Per engineer must be true or false' };
    if (dataSource === 'records') {
      if (next.aggregate !== undefined && !['count', 'sum'].includes(next.aggregate)) return { error: 'Records are counted or summed' };
      const unit = text(next.unit ?? null, 'Unit', 40);
      if (unit.error) return unit;
      next.unit = unit.value;
    }
    result.calculation_config = next;
  }
  const scope = result.scope_type ?? input.scope_type;
  if (scope !== undefined || required) {
    if (meta && scope && !meta.scopes.includes(scope)) return { error: `${meta.label} cannot be measured for a ${scope === 'organization' ? 'whole organisation' : scope}` };
    const ids = {};
    for (const [key, label] of [['team_id', 'Team ID'], ['project_id', 'Project ID'], ['customer_id', 'Customer ID'], ['user_id', 'Engineer ID']]) {
      const parsed = optionalId(input[key], label);
      if (parsed.error) return parsed;
      ids[key] = parsed.value;
    }
    if (scope === 'team' && !ids.team_id) return { error: 'A team is required for team-scoped KPIs' };
    if (scope === 'project' && !ids.project_id) return { error: 'A project is required for project-scoped KPIs' };
    if (scope === 'customer' && !ids.customer_id) return { error: 'A customer is required for customer KPIs' };
    if (scope === 'engineer' && !ids.user_id) return { error: 'An engineer is required for engineer KPIs' };
    result.team_id = scope === 'team' ? ids.team_id : null;
    result.project_id = scope === 'project' ? ids.project_id : null;
    result.customer_id = scope === 'customer' ? ids.customer_id : null;
    result.user_id = scope === 'engineer' ? ids.user_id : null;
    const perEngineer = (result.calculation_config ?? config).per_engineer;
    if (perEngineer && !(meta?.people && ['organization', 'team'].includes(scope))) return { error: 'Per engineer is for KPIs on a team or the organisation, measured from people\'s work' };
  }
  const direction = result.direction ?? input.direction;
  const target = result.target_value ?? input.target_value;
  const warning = result.warning_threshold ?? input.warning_threshold;
  const critical = result.critical_threshold ?? input.critical_threshold;
  if (direction && [target, warning, critical].every(Number.isFinite)) {
    if (direction === 'higher' && !(critical <= warning && warning <= target)) return { error: 'For higher-is-better KPIs, critical must be at or below warning, and warning at or below target' };
    if (direction === 'lower' && !(target <= warning && warning <= critical)) return { error: 'For lower-is-better KPIs, target must be at or below warning, and warning at or below critical' };
  }
  return { value: result };
}

function evaluate(value, definition) {
  if (value === null || value === undefined) return 'no_data';
  if (definition.direction === 'higher') {
    if (value < Number(definition.critical_threshold)) return 'critical';
    if (value < Number(definition.warning_threshold)) return 'warning';
  } else {
    if (value > Number(definition.critical_threshold)) return 'critical';
    if (value > Number(definition.warning_threshold)) return 'warning';
  }
  return 'healthy';
}

function parseConfig(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

/** The dates a period covers, ending today in the organisation's time zone. */
function periodRange(period, today = appTime.today()) {
  const [y, m] = today.split('-').map(Number);
  const pad = n => String(n).padStart(2, '0');
  if (!period || period === 'all') return { from: '0000-01-01', to: today, label: PERIODS.all };
  if (period === 'month') return { from: `${y}-${pad(m)}-01`, to: today, label: PERIODS.month };
  if (period === 'quarter') return { from: `${y}-${pad(Math.floor((m - 1) / 3) * 3 + 1)}-01`, to: today, label: PERIODS.quarter };
  if (period === 'year') return { from: `${y}-01-01`, to: today, label: PERIODS.year };
  const days = { last_30: 30, last_90: 90, last_365: 365 }[period];
  return { from: appTime.addDays(today, -(days - 1)), to: today, label: PERIODS[period] };
}

const round2 = value => Math.round(Number(value) * 100) / 100;
const percent = (part, whole) => (whole ? round2(100 * part / whole) : null);
const DONE = "('completed','closed')";
const RESOLVED = "('Resolved','Closed')";

/** `col IN (…)` for a list of people (null: everyone). */
function people(col, ids) {
  if (!ids) return { sql: '', params: [] };
  if (!ids.length) return { sql: ' AND 1=0', params: [] };
  return { sql: ` AND ${col} IN (${ids.map(() => '?').join(',')})`, params: ids };
}
const clause = (cond, value) => (value ? { sql: ` AND ${cond}`, params: [value] } : { sql: '', params: [] });
const join = (...parts) => ({ sql: parts.map(part => part.sql).join(''), params: parts.flatMap(part => part.params) });

/* Each measure: (db, ctx) → { value, records }. ctx has from, to, today, users
   (ids or null for everyone), team (activities keep their own team), customer,
   project, definition and config. */
const MEASURES = {
  async records(db, c) {
    const f = people('user_id', c.users);
    const row = await db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(value),0) AS total FROM kpi_records WHERE definition_id=? AND record_date>=? AND record_date<=?${f.sql}`).get(c.definition.id || 0, c.from, c.to, ...f.params);
    return { value: c.config.aggregate === 'sum' ? round2(row.total) : Number(row.n), records: Number(row.n) };
  },
  async tickets_resolved(db, c) {
    const rows = await resolvedTickets(db, c);
    return { value: rows.length, records: rows.length };
  },
  async ticket_resolution_days(db, c) {
    const rows = (await resolvedTickets(db, c)).map(row => (Date.parse(row.resolved_at_external) - Date.parse(row.created_at_external)) / 86400000).filter(days => Number.isFinite(days) && days >= 0);
    return { value: rows.length ? round2(rows.reduce((a, b) => a + b, 0) / rows.length) : null, records: rows.length };
  },
  async ticket_due_met(db, c) {
    const f = c.customer ? clause('customer_id=?', c.customer) : people('owner_user_id', c.users);
    const rows = await db.prepare(`SELECT sla_due_at, resolved_at_external FROM external_tickets WHERE normalized_status IN ${RESOLVED} AND sla_due_at IS NOT NULL
      AND substr(resolved_at_external,1,10)>=? AND substr(resolved_at_external,1,10)<=?${f.sql}`).all(c.from, c.to, ...f.params);
    return { value: percent(rows.filter(row => Date.parse(row.resolved_at_external) <= Date.parse(row.sla_due_at)).length, rows.length), records: rows.length };
  },
  async open_tickets(db, c) {
    const row = c.customer
      ? await db.prepare("SELECT COUNT(*) AS n FROM external_tickets WHERE status_group='open' AND customer_id=?").get(c.customer)
      : await (async () => { const f = people('user_id', c.users); return db.prepare(`SELECT COUNT(*) AS n FROM engineer_tickets WHERE status_group='open'${f.sql}`).get(...f.params); })();
    return { value: Number(row.n), records: Number(row.n) };
  },
  async activities_logged(db, c) {
    const row = await activities(db, c);
    return { value: Number(row.n), records: Number(row.n) };
  },
  async service_hours(db, c) {
    const row = await activities(db, c);
    return { value: round2(Number(row.minutes) / 60), records: Number(row.n) };
  },
  async tasks_completed(db, c) {
    const f = taskFilter(c);
    const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${taskFrom(c)} WHERE t.status IN ${DONE} AND substr(t.updated_at,1,10)>=? AND substr(t.updated_at,1,10)<=?${f.sql}`).get(c.from, c.to, ...f.params);
    return { value: Number(row.n), records: Number(row.n) };
  },
  async task_completion(db, c) {
    const f = taskFilter(c);
    const row = await db.prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN t.status IN ${DONE} THEN 1 ELSE 0 END) AS done FROM ${taskFrom(c)} WHERE t.status<>'cancelled'${f.sql}`).get(...f.params);
    return { value: percent(Number(row.done || 0), Number(row.n)) ?? 0, records: Number(row.n) };
  },
  async tasks_on_time(db, c) {
    const f = taskFilter(c);
    // Tasks without a due date are left out here (pg-mem mishandles IS NOT NULL in this query).
    const rows = (await db.prepare(`SELECT t.updated_at, t.deadline FROM ${taskFrom(c)} WHERE t.status IN ${DONE}
      AND substr(t.updated_at,1,10)>=? AND substr(t.updated_at,1,10)<=?${f.sql}`).all(c.from, c.to, ...f.params)).filter(row => row.deadline);
    return { value: percent(rows.filter(row => String(row.updated_at).slice(0, 10) <= row.deadline).length, rows.length), records: rows.length };
  },
  async overdue_tasks(db, c) {
    const f = taskFilter(c);
    const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${taskFrom(c)} WHERE t.deadline IS NOT NULL AND t.deadline<? AND t.status NOT IN ${DONE} AND t.status<>'cancelled'${f.sql}`).get(c.today, ...f.params);
    return { value: Number(row.n), records: Number(row.n) };
  },
  async visits_completed(db, c) {
    const rows = await visits(db, c, "v.status='completed'");
    return { value: rows.length, records: rows.length };
  },
  async visit_reports_on_time(db, c) {
    const { workingDaysBetween } = require('./workingDays');
    const limit = (await require('./slaPolicy').getPolicy(db)).visit_report.limit;
    const rows = (await visits(db, c, "v.status<>'cancelled'")).filter(row => row.scheduled_date <= c.today);
    // Counted once the report is in, or once it is late without one.
    const judged = rows.map(row => {
      const sentDay = row.report_sent && row.report_sent_at ? String(row.report_sent_at).slice(0, 10) : null;
      const days = workingDaysBetween(row.scheduled_date, sentDay || c.today);
      return sentDay ? days <= limit : days > limit ? false : null;
    }).filter(result => result !== null);
    return { value: percent(judged.filter(Boolean).length, judged.length), records: judged.length };
  },
  async time_logged(db, c) {
    const f = join(people('l.user_id', c.users), clause('t.project_id=?', c.project));
    const row = await db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(l.hours),0) AS hours FROM time_logs l LEFT JOIN tasks t ON t.id=l.task_id WHERE substr(l.logged_at,1,10)>=? AND substr(l.logged_at,1,10)<=?${f.sql}`).get(c.from, c.to, ...f.params);
    return { value: round2(row.hours), records: Number(row.n) };
  },
  async project_completion(db, c) {
    let f = join(clause('p.id=?', c.project), clause('p.customer_id=?', c.customer));
    let rows = await db.prepare(`SELECT p.customer_id, COALESCE(p.completion_pct,0) AS pct FROM projects p WHERE p.status NOT IN ('closed','cancelled')${f.sql}`).all(...f.params);
    if (c.team) {
      const customers = new Set((await db.prepare('SELECT customer_id FROM customer_teams WHERE team_id=?').all(c.team)).map(row => Number(row.customer_id)));
      rows = rows.filter(row => customers.has(Number(row.customer_id)));
    }
    return { value: rows.length ? round2(rows.reduce((sum, row) => sum + Number(row.pct), 0) / rows.length) : 0, records: rows.length };
  },
  async open_recommendations(db, c) {
    const f = join(people('owner_id', c.users), clause('customer_id=?', c.customer));
    const row = await db.prepare(`SELECT COUNT(*) AS n FROM customer_recommendations WHERE status NOT IN ('implemented','rejected','closed','converted_to_project')${f.sql}`).get(...f.params);
    return { value: Number(row.n), records: Number(row.n) };
  },
};

async function resolvedTickets(db, c) {
  if (c.customer) return db.prepare(`SELECT created_at_external, resolved_at_external FROM external_tickets WHERE customer_id=? AND normalized_status IN ${RESOLVED}
    AND substr(resolved_at_external,1,10)>=? AND substr(resolved_at_external,1,10)<=?`).all(c.customer, c.from, c.to);
  const f = people('user_id', c.users);
  return db.prepare(`SELECT created_at_external, resolved_at_external FROM engineer_tickets WHERE normalized_status IN ${RESOLVED}
    AND substr(resolved_at_external,1,10)>=? AND substr(resolved_at_external,1,10)<=?${f.sql}`).all(c.from, c.to, ...f.params);
}
function activities(db, c) {
  // A team's activities are those logged under the team; one engineer's, theirs.
  const f = join(c.team && !c.single ? clause('sa.team_id=?', c.team) : people('sa.engineer_id', c.users), clause('sa.customer_id=?', c.customer), clause('sa.related_project_id=?', c.project));
  return db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(COALESCE(sa.duration_minutes,0)),0) AS minutes FROM service_activities sa WHERE sa.status<>'cancelled' AND sa.activity_date>=? AND sa.activity_date<=?${f.sql}`).get(c.from, c.to, ...f.params);
}
const taskFilter = c => join(people('t.assigned_to', c.users), clause('COALESCE(t.customer_id,p.customer_id)=?', c.customer), clause('t.project_id=?', c.project));
// Tasks, joined to their project only when the customer is needed.
const taskFrom = c => (c.customer ? 'tasks t LEFT JOIN projects p ON p.id=t.project_id' : 'tasks t');
async function visits(db, c, condition) {
  const f = clause('v.customer_id=?', c.customer);
  const rows = await db.prepare(`SELECT v.id, v.scheduled_date, v.report_sent, v.report_sent_at FROM maintenance_visits v WHERE ${condition} AND v.scheduled_date>=? AND v.scheduled_date<=?${f.sql}`).all(c.from, c.to, ...f.params);
  if (!c.users) return rows;
  if (!c.users.length || !rows.length) return [];
  const assigned = await db.prepare(`SELECT DISTINCT visit_id FROM maintenance_visit_engineers WHERE user_id IN (${c.users.map(() => '?').join(',')})`).all(...c.users);
  const mine = new Set(assigned.map(row => Number(row.visit_id)));
  return rows.filter(row => mine.has(Number(row.id)));
}

/** Who "the people" of a scope are: one engineer, a team's members, or everyone (null). */
async function scopePeople(db, definition) {
  if (definition.scope_type === 'engineer') return [Number(definition.user_id)];
  if (definition.scope_type === 'team') return (await db.prepare('SELECT user_id FROM team_members WHERE team_id=?').all(definition.team_id)).map(row => Number(row.user_id));
  return null;
}
async function engineersFor(db, definition) {
  const rows = definition.scope_type === 'team'
    ? await db.prepare("SELECT u.id, u.name FROM team_members m JOIN users u ON u.id=m.user_id WHERE m.team_id=? AND u.active=1 ORDER BY u.name").all(definition.team_id)
    : await db.prepare("SELECT id, name FROM users WHERE active=1 AND role='engineer' ORDER BY name").all();
  return rows.map(row => ({ id: Number(row.id), name: row.name }));
}

/**
 * Calculates a definition: { value, facts, period, breakdown? }. With
 * per-engineer measurement, value is the engineers' average and breakdown has
 * each engineer's value and health against the same thresholds.
 */
async function calculateDefinition(db, definition, { today = appTime.today() } = {}) {
  const config = parseConfig(definition.calculation_config);
  const meta = SOURCES[definition.data_source];
  if (!meta) throw Object.assign(new Error('Unsupported KPI data source'), { status: 400 });
  if (definition.data_source === 'manual') {
    const parsed = finiteNumber(config.manual_value, 'Manual value');
    if (parsed.error) throw Object.assign(new Error(parsed.error), { status: 400 });
    return { value: parsed.value, facts: { source: 'manual' }, period: null };
  }
  const range = meta.period ? periodRange(config.period, today) : null;
  const base = { from: range?.from || '0000-01-01', to: today, today, definition, config,
    team: definition.scope_type === 'team' ? Number(definition.team_id) : null,
    customer: definition.scope_type === 'customer' ? Number(definition.customer_id) : null,
    project: definition.scope_type === 'project' ? Number(definition.project_id) : null };
  const measure = MEASURES[definition.data_source];
  const period = range ? { from: range.from === '0000-01-01' ? null : range.from, to: range.to, label: range.label } : null;
  if (config.per_engineer && meta.people && ['organization', 'team'].includes(definition.scope_type)) {
    const engineers = await engineersFor(db, definition);
    const breakdown = [];
    for (const engineer of engineers) {
      const result = await measure(db, { ...base, users: [engineer.id], single: true });
      breakdown.push({ user_id: engineer.id, name: engineer.name, value: result.value, records: result.records, status: evaluate(result.value, definition) });
    }
    const measured = breakdown.filter(row => row.value !== null);
    const value = measured.length ? round2(measured.reduce((sum, row) => sum + row.value, 0) / measured.length) : null;
    return { value, facts: { engineers: breakdown.length, meeting_target: breakdown.filter(row => row.status === 'healthy').length, records: breakdown.reduce((sum, row) => sum + row.records, 0) }, period, breakdown };
  }
  const result = await measure(db, { ...base, users: await scopePeople(db, definition), single: definition.scope_type === 'engineer' });
  return { value: result.value, facts: { records: result.records }, period };
}

module.exports = { DATA_SOURCES, SOURCES, PERIODS, validateDefinition, evaluate, parseConfig, periodRange, calculateDefinition };
