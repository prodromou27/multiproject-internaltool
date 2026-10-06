const router = require('express').Router({ mergeParams: true });
const db = require('../db');
const appTime = require('../appTime');
const { requireAuth, requireManager } = require('../middleware/auth');
const { logAudit } = require('../auditLog');
const { positiveId, canAccessCustomer } = require('../customerAccess');
const { validateTemplate, firstOnOrAfter, createDueTasks } = require('../recurringTasks');

/* Customer 360 → Tasks → Recurring tasks. Everyone who can see the customer
   sees its schedule; managers set it up. */
router.use(requireAuth, async (req, res, next) => {
  if (!positiveId(req.params.id)) return res.status(400).json({ error: 'Invalid customer ID' });
  if (!await canAccessCustomer(req.user, Number(req.params.id))) return res.status(403).json({ error: 'You do not have access to this customer' });
  next();
});

const list = customerId => db.prepare(`SELECT r.id, r.title, r.description, r.priority, r.assigned_to, u.name AS assigned_to_name, r.frequency, r.start_date,
  r.lead_days, r.next_due, r.active, r.last_task_id FROM recurring_tasks r LEFT JOIN users u ON u.id = r.assigned_to
  WHERE r.customer_id = ? ORDER BY r.active DESC, r.next_due, r.id`).all(customerId);

async function engineerError(assignedTo) {
  if (!assignedTo) return null;
  const user = await db.prepare('SELECT role, active FROM users WHERE id = ?').get(assignedTo);
  return !user || !user.active || user.role !== 'engineer' ? 'Assign recurring tasks to an active engineer' : null;
}

router.get('/', async (req, res) => {
  res.json({ rows: (await list(Number(req.params.id))).map(row => ({ ...row, active: !!row.active })) });
});

router.post('/', requireManager, async (req, res) => {
  const customerId = Number(req.params.id);
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ error: 'A JSON object is required' });
  const parsed = validateTemplate(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const value = parsed.value, problem = await engineerError(value.assigned_to);
  if (problem) return res.status(400).json({ error: problem });
  const nextDue = firstOnOrAfter(value.start_date, value.frequency, appTime.today()).date;
  const result = await db.prepare(`INSERT INTO recurring_tasks (customer_id, title, description, priority, assigned_to, frequency, start_date, lead_days, next_due, active, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(customerId, value.title, value.description || null, value.priority, value.assigned_to, value.frequency, value.start_date, value.lead_days, nextDue, value.active, req.user.id);
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
  const value = parsed.value, problem = req.body.assigned_to !== undefined ? await engineerError(value.assigned_to) : null;
  if (problem) return res.status(400).json({ error: problem });
  // A new schedule starts from its next date on or after today; otherwise the schedule carries on.
  const rescheduled = value.frequency !== current.frequency || value.start_date !== current.start_date || (value.active && !current.active);
  const nextDue = rescheduled ? firstOnOrAfter(value.start_date, value.frequency, appTime.today()).date : current.next_due;
  await db.prepare(`UPDATE recurring_tasks SET title = ?, description = ?, priority = ?, assigned_to = ?, frequency = ?, start_date = ?, lead_days = ?,
    next_due = ?, active = ?, updated_at = app_now() WHERE id = ?`).run(value.title, value.description || null, value.priority, value.assigned_to, value.frequency, value.start_date, value.lead_days, nextDue, value.active, id);
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
