/**
 * Recurring customer tasks: a template ("Monthly backup check" for a customer,
 * every month from a start date) creates the next real task a few days before
 * it is due. Runs each morning with the automatic reminders (reminders.js).
 */
const db = require('./db');
const appTime = require('./appTime');

const FREQUENCIES = Object.freeze({ weekly: { days: 7 }, biweekly: { days: 14 }, monthly: { months: 1 }, quarterly: { months: 3 }, semiannual: { months: 6 }, annual: { months: 12 }, custom: null });
const UNITS = Object.freeze({ day: 1, week: 7, month: null });
const MAX_INTERVAL = 365;

/** The repeat rule of a template: a fixed frequency, or custom "every N days/weeks/months". */
function ruleOf(template) {
  if (template.frequency !== 'custom') return FREQUENCIES[template.frequency];
  const count = Number(template.interval_count);
  return template.interval_unit === 'month' ? { months: count } : { days: count * UNITS[template.interval_unit] };
}
const PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);
const MAX_LEAD_DAYS = 90;

const pad = value => String(value).padStart(2, '0');
const isDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/** The `n`th occurrence after `start` (n = 0 is the start itself). Month ends are kept: 31 Jan monthly gives 28/29 Feb, then 31 Mar. */
function occurrence(start, frequency, n) {
  const rule = typeof frequency === 'string' ? FREQUENCIES[frequency] : frequency;
  if (rule.days) return appTime.addDays(start, rule.days * n);
  const [year, month, day] = start.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + rule.months * n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(Math.min(day, lastDay))}`;
}

/** The first occurrence on or after `from`, with its index. */
function firstOnOrAfter(start, frequency, from) {
  const rule = typeof frequency === 'string' ? FREQUENCIES[frequency] : frequency;
  let n = 0;
  if (rule.days) n = Math.max(0, Math.floor((Date.parse(from) - Date.parse(start)) / 86400000 / rule.days));
  else { const [sy, sm] = start.split('-').map(Number), [fy, fm] = from.split('-').map(Number); n = Math.max(0, Math.floor(((fy - sy) * 12 + (fm - sm)) / rule.months)); }
  while (n > 0 && occurrence(start, frequency, n - 1) >= from) n--;
  while (occurrence(start, frequency, n) < from) n++;
  return { n, date: occurrence(start, frequency, n) };
}

/** Validates a template from the API. `current` is the stored row when editing. */
function validateTemplate(body, current = null) {
  const value = { ...(current || {}) };
  const take = key => body[key] !== undefined;
  if (!current || take('title')) {
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 300) return { error: 'Title is required (at most 300 characters)' };
    value.title = body.title.trim();
  }
  if (take('description')) {
    if (body.description !== null && (typeof body.description !== 'string' || body.description.length > 5000)) return { error: 'Description must be text of at most 5000 characters' };
    value.description = body.description?.trim() || null;
  }
  if (!current || take('priority')) {
    const priority = body.priority ?? 'medium';
    if (!PRIORITIES.has(priority)) return { error: 'Priority must be low, medium, high or critical' };
    value.priority = priority;
  }
  if (!current || take('frequency')) {
    if (!Object.hasOwn(FREQUENCIES, body.frequency ?? '')) return { error: 'Repeat must be weekly, every 2 weeks, monthly, quarterly, semiannual, annual or custom' };
    value.frequency = body.frequency;
  }
  if (value.frequency === 'custom') {
    if (!current || take('interval_count') || take('interval_unit') || current.frequency !== 'custom') {
      const count = body.interval_count ?? value.interval_count, unit = body.interval_unit ?? value.interval_unit;
      if (!Number.isSafeInteger(count) || count < 1 || count > MAX_INTERVAL) return { error: `Repeat every: a whole number from 1 to ${MAX_INTERVAL}` };
      if (!Object.hasOwn(UNITS, unit ?? '')) return { error: 'Repeat every N days, weeks or months' };
      value.interval_count = count; value.interval_unit = unit;
    }
  } else { value.interval_count = null; value.interval_unit = null; }
  if (!current || take('start_date')) {
    if (!isDay(body.start_date)) return { error: 'First due date must be a valid YYYY-MM-DD date' };
    value.start_date = body.start_date;
  }
  if (!current || take('lead_days')) {
    const lead = body.lead_days ?? 7;
    if (!Number.isSafeInteger(lead) || lead < 0 || lead > MAX_LEAD_DAYS) return { error: `Create it this many days before it is due: a whole number from 0 to ${MAX_LEAD_DAYS}` };
    value.lead_days = lead;
  }
  for (const [key, label] of [['assigned_to', 'Engineer'], ['team_id', 'Team'], ['asset_id', 'Asset'], ['technology_id', 'Technology']]) {
    if (take(key)) {
      if (body[key] !== null && (!Number.isSafeInteger(body[key]) || body[key] < 1)) return { error: `${label} must be an id or null` };
      value[key] = body[key];
    } else if (!current) value[key] = null;
  }
  // One or the other: a team task is open to the whole team until someone takes it.
  if (value.assigned_to && value.team_id) {
    if (take('team_id') && body.team_id) value.assigned_to = null; else value.team_id = null;
  }
  if (take('notify')) {
    if (typeof body.notify !== 'boolean') return { error: 'Notify must be true or false' };
    value.notify = body.notify ? 1 : 0;
  } else if (!current) value.notify = 0;
  if (take('active')) {
    if (typeof body.active !== 'boolean') return { error: 'Active must be true or false' };
    value.active = body.active ? 1 : 0;
  } else if (!current) value.active = 1;
  return { value };
}

/**
 * Creates the tasks whose time has come. A template whose next due date is
 * within its lead days gets a task, and moves on to the following date. After
 * downtime only the most recent missed occurrence becomes a task.
 */
async function createDueTasks({ store = db, today = appTime.today(), templateId = null, notify = require('./notifications').notify } = {}) {
  const rows = await store.prepare(`SELECT * FROM recurring_tasks WHERE active = 1${templateId ? ' AND id = ?' : ''}`).all(...(templateId ? [templateId] : []));
  let created = 0;
  for (const template of rows) {
    const due = [];
    let next = template.next_due;
    const rule = ruleOf(template);
    let { n } = firstOnOrAfter(template.start_date, rule, next);
    while (appTime.addDays(next, -Number(template.lead_days)) <= today && due.length < 400) { due.push(next); n++; next = occurrence(template.start_date, rule, n); }
    if (!due.length) continue;
    const missed = due.filter(day => day < today), upcoming = due.filter(day => day >= today);
    const toCreate = [...missed.slice(-1), ...upcoming];
    const ids = await store.transaction(async tx => {
      // Claim this run: if another process already advanced the template, do nothing.
      const claimed = await tx.prepare('UPDATE recurring_tasks SET next_due = ?, updated_at = app_now() WHERE id = ? AND next_due = ?').run(next, template.id, template.next_due);
      if (claimed.changes !== 1) return [];
      const made = [];
      for (const deadline of toCreate) {
        const result = await tx.prepare(`INSERT INTO tasks (customer_id, title, description, priority, deadline, assigned_to, team_id, asset_id, technology_id, recurring_task_id, created_by, is_adhoc)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`).run(template.customer_id, template.title, template.description, template.priority, deadline,
          template.assigned_to, template.assigned_to ? null : template.team_id, template.asset_id, template.technology_id, template.id, template.created_by);
        made.push({ id: result.lastInsertRowid, deadline });
      }
      await tx.prepare('UPDATE recurring_tasks SET last_task_id = ? WHERE id = ?').run(made.at(-1).id, template.id);
      return made;
    });
    created += ids.length;
    if (ids.length && template.notify) {
      // The engineer, or every engineer in the team.
      const people = template.assigned_to
        ? await store.prepare('SELECT id, name, email FROM users WHERE id = ? AND active = 1').all(template.assigned_to)
        : template.team_id ? await store.prepare("SELECT u.id, u.name, u.email FROM users u JOIN team_members tm ON tm.user_id = u.id WHERE tm.team_id = ? AND u.active = 1 AND u.role = 'engineer'").all(template.team_id) : [];
      for (const engineer of people) for (const task of ids) notify('task.assigned', { engineer_id: engineer.id, engineer_name: engineer.name, engineer_email: engineer.email, task_title: template.title, project_title: null, deadline: task.deadline, priority: template.priority, is_adhoc: false });
    }
  }
  if (created) require('./liveUpdates').emitChange('tasks');
  return { created };
}

module.exports = { FREQUENCIES, UNITS, MAX_LEAD_DAYS, MAX_INTERVAL, ruleOf, occurrence, firstOnOrAfter, validateTemplate, createDueTasks };
