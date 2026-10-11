const router = require('express').Router({ mergeParams: true });
const db = require('../db');
const appTime = require('../appTime');
const { requireAuth, requireManager } = require('../middleware/auth');
const { logAudit } = require('../auditLog');
const { positiveId, canAccessCustomer } = require('../customerAccess');
const { validateTemplate, firstOnOrAfter, createDueTasks, ruleOf } = require('../recurringTasks');
const { decrypt } = require('../fieldCipher');

/* Customer 360 → Tasks → Recurring tasks. Everyone who can see the customer
   sees its schedule; managers set it up. */
router.use(requireAuth, async (req, res, next) => {
  if (!positiveId(req.params.id)) return res.status(400).json({ error: 'Invalid customer ID' });
  if (!await canAccessCustomer(req.user, Number(req.params.id))) return res.status(403).json({ error: 'You do not have access to this customer' });
  next();
});

// With the names of the engineer, team, asset and technology, and how its tasks went.
async function list(customerId) {
  const rows = await db.prepare(`SELECT id, title, description, priority, assigned_to, team_id, asset_id, technology_id, frequency, interval_count, interval_unit,
    start_date, lead_days, next_due, active, notify, last_task_id FROM recurring_tasks WHERE customer_id = ? ORDER BY active DESC, next_due, id`).all(customerId);
  const [users, teams, assets, technologies, tasks] = await Promise.all([
    db.prepare('SELECT id, name FROM users').all(), db.prepare('SELECT id, name FROM teams').all(),
    db.prepare('SELECT id, name FROM customer_assets WHERE customer_id = ?').all(customerId), db.prepare('SELECT id, name FROM technologies').all(),
    db.prepare('SELECT recurring_task_id, status, deadline, completed_at FROM tasks WHERE customer_id = ? AND recurring_task_id IS NOT NULL').all(customerId),
  ]);
  const name = (items, id) => items.find(x => Number(x.id) === Number(id))?.name ?? null;
  const today = appTime.today();
  const isOpen = t => !['completed', 'closed', 'cancelled'].includes(t.status);
  return rows.map(row => {
    const mine = tasks.filter(t => Number(t.recurring_task_id) === Number(row.id));
    const done = mine.filter(t => ['completed', 'closed'].includes(t.status));
    return { ...row, active: !!row.active, notify: !!row.notify,
      assigned_to_name: name(users, row.assigned_to), team_name: name(teams, row.team_id),
      asset_name: row.asset_id ? decrypt(name(assets, row.asset_id)) : null, technology_name: name(technologies, row.technology_id),
      history: { created: mine.length, completed: done.length,
        on_time: done.filter(t => t.deadline && t.completed_at && t.completed_at.slice(0, 10) <= t.deadline).length,
        open: mine.filter(isOpen).length,
        overdue: mine.filter(t => isOpen(t) && t.deadline && t.deadline < today).length } };
  });
}

async function referenceError(value, customerId) {
  if (value.assigned_to) {
    const user = await db.prepare('SELECT role, active FROM users WHERE id = ?').get(value.assigned_to);
    if (!user || !user.active || user.role !== 'engineer') return 'Assign recurring tasks to an active engineer';
  }
  if (value.team_id && !await db.prepare('SELECT 1 FROM teams WHERE id = ?').get(value.team_id)) return 'Team not found';
  if (value.asset_id && !await db.prepare('SELECT 1 FROM customer_assets WHERE id = ? AND customer_id = ?').get(value.asset_id, customerId)) return 'The asset must belong to this customer';
  if (value.technology_id && !await db.prepare('SELECT 1 FROM technologies WHERE id = ?').get(value.technology_id)) return 'Technology not found';
  return null;
}

router.get('/', async (req, res) => {
  res.json({ rows: await list(Number(req.params.id)) });
});

router.post('/', requireManager, async (req, res) => {
  const customerId = Number(req.params.id);
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ error: 'A JSON object is required' });
  const parsed = validateTemplate(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const value = parsed.value, problem = await referenceError(value, customerId);
  if (problem) return res.status(400).json({ error: problem });
  const nextDue = firstOnOrAfter(value.start_date, ruleOf(value), appTime.today()).date;
  const result = await db.prepare(`INSERT INTO recurring_tasks (customer_id, title, description, priority, assigned_to, team_id, asset_id, technology_id, frequency, interval_count, interval_unit,
    start_date, lead_days, next_due, active, notify, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(customerId, value.title, value.description || null, value.priority, value.assigned_to, value.team_id, value.asset_id, value.technology_id, value.frequency, value.interval_count, value.interval_unit,
      value.start_date, value.lead_days, nextDue, value.active, value.notify, req.user.id);
  await logAudit(db, req, 'recurring_task', result.lastInsertRowid, value.title, 'recurring_task_created', `customer_id=${customerId}; frequency=${value.frequency}; next_due=${nextDue}`);
  // If the first one is already within its lead time, create it now rather than tomorrow morning.
  await createDueTasks({ templateId: result.lastInsertRowid });
  res.status(201).json((await list(customerId)).find(row => row.id === result.lastInsertRowid));
});

router.put('/:recurringId', requireManager, async (req, res) => {
  const customerId = Number(req.params.id), id = Number(req.params.recurringId);
  if (!positiveId(req.params.recurringId)) return res.status(400).json({ error: 'Invalid recurring task ID' });
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ error: 'A JSON object is required' });
  const current = await db.prepare('SELECT * FROM recurring_tasks WHERE id = ? AND customer_id = ?').get(id, customerId);
  if (!current) return res.status(404).json({ error: 'Recurring task not found' });
  const parsed = validateTemplate(req.body, current);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const value = parsed.value, problem = await referenceError(value, customerId);
  if (problem) return res.status(400).json({ error: problem });
  // A new schedule starts from its next date on or after today; otherwise the schedule carries on.
  const rescheduled = value.frequency !== current.frequency || value.start_date !== current.start_date || (value.active && !current.active)
    || Number(value.interval_count) !== Number(current.interval_count) || value.interval_unit !== current.interval_unit;
  const nextDue = rescheduled ? firstOnOrAfter(value.start_date, ruleOf(value), appTime.today()).date : current.next_due;
  await db.prepare(`UPDATE recurring_tasks SET title = ?, description = ?, priority = ?, assigned_to = ?, team_id = ?, asset_id = ?, technology_id = ?, frequency = ?,
    interval_count = ?, interval_unit = ?, start_date = ?, lead_days = ?, next_due = ?, active = ?, notify = ?, updated_at = app_now() WHERE id = ?`)
    .run(value.title, value.description || null, value.priority, value.assigned_to, value.team_id, value.asset_id, value.technology_id, value.frequency,
      value.interval_count, value.interval_unit, value.start_date, value.lead_days, nextDue, value.active, value.notify, id);
  await logAudit(db, req, 'recurring_task', id, value.title, 'recurring_task_updated', `customer_id=${customerId}; frequency=${value.frequency}; next_due=${nextDue}; active=${!!value.active}`);
  if (value.active) await createDueTasks({ templateId: id });
  res.json((await list(customerId)).find(row => row.id === id));
});

router.delete('/:recurringId', requireManager, async (req, res) => {
  if (!positiveId(req.params.recurringId)) return res.status(400).json({ error: 'Invalid recurring task ID' });
  const row = await db.prepare('SELECT id, title FROM recurring_tasks WHERE id = ? AND customer_id = ?').get(Number(req.params.recurringId), Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Recurring task not found' });
  // Tasks it already created stay; only future ones stop.
  await db.prepare('DELETE FROM recurring_tasks WHERE id = ?').run(row.id);
  await logAudit(db, req, 'recurring_task', row.id, row.title, 'recurring_task_deleted', `customer_id=${req.params.id}`);
  res.json({ ok: true });
});

module.exports = router;
