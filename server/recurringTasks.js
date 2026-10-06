/**
 * Recurring customer tasks: a template ("Monthly backup check" for a customer,
 * every month from a start date) creates the next real task a few days before
 * it is due. Runs each morning with the automatic reminders (reminders.js).
 */
const db = require('./db');
const appTime = require('./appTime');

const FREQUENCIES = Object.freeze({ weekly: { days: 7 }, monthly: { months: 1 }, quarterly: { months: 3 }, semiannual: { months: 6 }, annual: { months: 12 } });
const PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);
const MAX_LEAD_DAYS = 90;

const pad = value => String(value).padStart(2, '0');
const isDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/** The `n`th occurrence after `start` (n = 0 is the start itself). Month ends are kept: 31 Jan monthly gives 28/29 Feb, then 31 Mar. */
function occurrence(start, frequency, n) {
  const rule = FREQUENCIES[frequency];
  if (rule.days) return appTime.addDays(start, rule.days * n);
  const [year, month, day] = start.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + rule.months * n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(Math.min(day, lastDay))}`;
}

/** The first occurrence on or after `from`, with its index. */
function firstOnOrAfter(start, frequency, from) {
  let n = 0;
  if (FREQUENCIES[frequency].days) n = Math.max(0, Math.floor((Date.parse(from) - Date.parse(start)) / 86400000 / FREQUENCIES[frequency].days));
  else { const [sy, sm] = start.split('-').map(Number), [fy, fm] = from.split('-').map(Number); n = Math.max(0, Math.floor(((fy - sy) * 12 + (fm - sm)) / FREQUENCIES[frequency].months)); }
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
    if (!FREQUENCIES[body.frequency]) return { error: 'Repeat must be weekly, monthly, quarterly, semiannual or annual' };
    value.frequency = body.frequency;
  }
  if (!current || take('start_date')) {
    if (!isDay(body.start_date)) return { error: 'First due date must be a valid YYYY-MM-DD date' };
    value.start_date = body.start_date;
  }
  if (!current || take('lead_days')) {
    const lead = body.lead_days ?? 7;
    if (!Number.isSafeInteger(lead) || lead < 0 || lead > MAX_LEAD_DAYS) return { error: `Create it this many days before it is due: a whole number from 0 to ${MAX_LEAD_DAYS}` };
    value.lead_days = lead;
  }
  if (take('assigned_to')) {
    if (body.assigned_to !== null && (!Number.isSafeInteger(body.assigned_to) || body.assigned_to < 1)) return { error: 'Engineer must be a user id or null' };
    value.assigned_to = body.assigned_to;
  } else if (!current) value.assigned_to = null;
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
    let { n } = firstOnOrAfter(template.start_date, template.frequency, next);
    while (appTime.addDays(next, -Number(template.lead_days)) <= today && due.length < 400) { due.push(next); n++; next = occurrence(template.start_date, template.frequency, n); }
    if (!due.length) continue;
    const missed = due.filter(day => day < today), upcoming = due.filter(day => day >= today);
    const toCreate = [...missed.slice(-1), ...upcoming];
    const ids = await store.transaction(async tx => {
      // Claim this run: if another process already advanced the template, do nothing.
      const claimed = await tx.prepare('UPDATE recurring_tasks SET next_due = ?, updated_at = app_now() WHERE id = ? AND next_due = ?').run(next, template.id, template.next_due);
      if (claimed.changes !== 1) return [];
      const made = [];
      for (const deadline of toCreate) {
        const result = await tx.prepare(`INSERT INTO tasks (customer_id, title, description, priority, deadline, assigned_to, created_by, is_adhoc)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0)`).run(template.customer_id, template.title, template.description, template.priority, deadline, template.assigned_to, template.created_by);
        made.push({ id: result.lastInsertRowid, deadline });
      }
      await tx.prepare('UPDATE recurring_tasks SET last_task_id = ? WHERE id = ?').run(made.at(-1).id, template.id);
      return made;
    });
    created += ids.length;
    if (ids.length && template.assigned_to) {
      const engineer = await store.prepare('SELECT name, email FROM users WHERE id = ? AND active = 1').get(template.assigned_to);
      for (const task of ids) if (engineer) notify('task.assigned', { engineer_id: template.assigned_to, engineer_name: engineer.name, engineer_email: engineer.email, task_title: template.title, project_title: null, deadline: task.deadline, priority: template.priority, is_adhoc: false });
    }
  }
  if (created) require('./liveUpdates').emitChange('tasks');
  return { created };
}

module.exports = { FREQUENCIES, MAX_LEAD_DAYS, occurrence, firstOnOrAfter, validateTemplate, createDueTasks };
