/**
 * /api/reminders — each person's own reminders and their automatic-reminder
 * choices. Nobody can see or change another person's reminders.
 */
const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const db = require('../db');
const { decrypt } = require('../fieldCipher');
const { canAccessCustomer } = require('../customerAccess');
const { REPEATS, AUTOMATIC, automaticSettings, validTimeZone, nextOccurrence } = require('../reminders');

router.use(requireAuth);

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const positiveId = value => /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value));
const instant = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

async function reminderInput(body, user, existing) {
  const has = key => Object.prototype.hasOwnProperty.call(body || {}, key);
  const value = key => (has(key) ? body[key] : existing?.[key]);
  const title = String(value('title') ?? '').trim();
  if (!title) fail('Give the reminder a title');
  if (title.length > 200) fail('The title must be at most 200 characters');
  const notes = value('notes') == null ? '' : value('notes');
  if (typeof notes !== 'string' || notes.length > 2000) fail('Notes must be text of at most 2,000 characters');
  const dueAt = has('due_at') ? instant(body.due_at) : existing?.due_at;
  if (!dueAt) fail('Choose a valid date and time');
  const repeat = value('repeat') || 'none';
  if (!REPEATS.includes(repeat)) fail(`Repeat must be one of: ${REPEATS.join(', ')}`);
  const timeZone = value('time_zone');
  if (!validTimeZone(timeZone)) fail('A valid time zone is required');
  let customerId = value('customer_id');
  customerId = customerId === '' || customerId == null ? null : customerId;
  if (customerId !== null) {
    if (!positiveId(customerId)) fail('Invalid customer');
    if (has('customer_id') && !await canAccessCustomer(user, customerId)) fail('You cannot link a reminder to that customer', 403);
    customerId = Number(customerId);
  }
  return { title, notes: notes.trim() || null, dueAt, repeat, timeZone, customerId };
}

const view = row => ({ ...row, id: Number(row.id), customer_id: row.customer_id == null ? null : Number(row.customer_id), customer_name: row.customer_name ? decrypt(row.customer_name) : null });
const SELECT = `SELECT r.id, r.title, r.notes, r.due_at, r.time_zone, r.repeat, r.customer_id, c.name AS customer_name, r.status, r.notified_at, r.completed_at, r.created_at
  FROM reminders r LEFT JOIN customers c ON c.id = r.customer_id`;
const one = async (id, userId) => db.prepare(`${SELECT} WHERE r.id = ? AND r.user_id = ?`).get(id, userId);

// Customers a person may link a reminder to (the same rule as customerAccess.canAccessCustomer).
async function linkableCustomers(user) {
  if (['manager', 'planner'].includes(user.role)) return db.prepare('SELECT id, name FROM customers WHERE active = 1').all();
  if (user.role !== 'engineer') return [];
  return db.prepare(`SELECT id, name FROM customers WHERE active = 1 AND id IN (
    SELECT p.customer_id FROM projects p JOIN project_assignments pa ON pa.project_id = p.id WHERE pa.user_id = ?
    UNION SELECT mv.customer_id FROM maintenance_visits mv JOIN maintenance_visit_engineers mve ON mve.visit_id = mv.id WHERE mve.user_id = ?
    UNION SELECT ce.customer_id FROM customer_engineers ce WHERE ce.user_id = ?
    UNION SELECT ct.customer_id FROM customer_teams ct JOIN team_members tm ON tm.team_id = ct.team_id WHERE tm.user_id = ?)`).all(user.id, user.id, user.id, user.id);
}

router.get('/', async (req, res) => {
  const rows = (await db.prepare(`${SELECT} WHERE r.user_id = ? AND (r.status = 'active' OR r.completed_at >= ?) ORDER BY r.status, r.due_at, r.id LIMIT 500`)
    .all(req.user.id, new Date(Date.now() - 30 * 86400000).toISOString())).map(view);
  const settingsRow = await db.prepare('SELECT reminder_settings FROM users WHERE id = ?').get(req.user.id);
  const customers = (await linkableCustomers(req.user)).map(row => ({ id: Number(row.id), name: decrypt(row.name) })).sort((a, b) => a.name.localeCompare(b.name));
  const settings = automaticSettings(settingsRow?.reminder_settings, req.user.role);
  res.json({
    now: new Date().toISOString(),
    active: rows.filter(row => row.status === 'active'),
    done: rows.filter(row => row.status === 'done').sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at))).slice(0, 20),
    automatic: AUTOMATIC.filter(item => item.key in settings).map(({ key, label }) => ({ key, label, enabled: settings[key] })),
    customers,
  });
});

router.post('/', async (req, res) => {
  try {
    const count = await db.prepare("SELECT COUNT(*) AS total FROM reminders WHERE user_id = ? AND status = 'active'").get(req.user.id);
    if (Number(count.total) >= 500) fail('You have 500 active reminders; complete or delete some first');
    const input = await reminderInput(req.body, req.user);
    const created = await db.prepare('INSERT INTO reminders (user_id, title, notes, due_at, scheduled_at, time_zone, repeat, customer_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(req.user.id, input.title, input.notes, input.dueAt, input.dueAt, input.timeZone, input.repeat, input.customerId);
    res.status(201).json(view(await one(created.lastInsertRowid, req.user.id)));
  } catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'Could not save the reminder' }); }
});

// The automatic-reminder choices (before /:id so "settings" is not taken for an id).
router.put('/settings', async (req, res) => {
  const body = req.body || {};
  const row = await db.prepare('SELECT reminder_settings FROM users WHERE id = ?').get(req.user.id);
  const settings = automaticSettings(row?.reminder_settings, req.user.role);
  for (const [key, value] of Object.entries(body)) {
    if (!(key in settings)) return res.status(400).json({ error: `Unknown automatic reminder: ${key}` });
    if (typeof value !== 'boolean') return res.status(400).json({ error: `${key} must be true or false` });
    settings[key] = value;
  }
  await db.prepare('UPDATE users SET reminder_settings = ? WHERE id = ?').run(JSON.stringify(settings), req.user.id);
  res.json({ automatic: AUTOMATIC.filter(item => item.key in settings).map(({ key, label }) => ({ key, label, enabled: settings[key] })) });
});

router.put('/:id', async (req, res) => {
  if (!positiveId(req.params.id)) return res.status(400).json({ error: 'Invalid reminder' });
  try {
    const existing = await db.prepare('SELECT * FROM reminders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!existing) fail('Reminder not found', 404);
    const input = await reminderInput(req.body, req.user, existing);
    // A new time is a new occurrence, which should be delivered again.
    const retimed = input.dueAt !== existing.due_at;
    // Editing the time sets the schedule too (unlike a snooze).
    await db.prepare(`UPDATE reminders SET title = ?, notes = ?, due_at = ?, scheduled_at = ?, time_zone = ?, repeat = ?, customer_id = ?, updated_at = app_now()${retimed ? ', notified_at = NULL' : ''}
      ${existing.status === 'done' && retimed ? ", status = 'active', completed_at = NULL" : ''} WHERE id = ? AND user_id = ?`)
      .run(input.title, input.notes, input.dueAt, retimed ? input.dueAt : (existing.scheduled_at || existing.due_at), input.timeZone, input.repeat, input.customerId, existing.id, req.user.id);
    res.json(view(await one(existing.id, req.user.id)));
  } catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'Could not save the reminder' }); }
});

// Done: a repeating reminder moves to its next future occurrence; a one-off is completed.
router.post('/:id/done', async (req, res) => {
  if (!positiveId(req.params.id)) return res.status(400).json({ error: 'Invalid reminder' });
  const reminder = await db.prepare("SELECT * FROM reminders WHERE id = ? AND user_id = ? AND status = 'active'").get(req.params.id, req.user.id);
  if (!reminder) return res.status(404).json({ error: 'Reminder not found' });
  if (reminder.repeat === 'none') {
    await db.prepare("UPDATE reminders SET status = 'done', completed_at = ?, updated_at = app_now() WHERE id = ?").run(new Date().toISOString(), reminder.id);
  } else {
    // From the scheduled time, not a snoozed one, so the reminder keeps its usual time.
    let next = nextOccurrence(reminder.scheduled_at || reminder.due_at, reminder.repeat, reminder.time_zone);
    const now = new Date().toISOString();
    for (let guard = 0; next <= now && guard < 1000; guard++) next = nextOccurrence(next, reminder.repeat, reminder.time_zone);
    await db.prepare('UPDATE reminders SET due_at = ?, scheduled_at = ?, notified_at = NULL, updated_at = app_now() WHERE id = ?').run(next, next, reminder.id);
  }
  res.json(view(await one(reminder.id, req.user.id)));
});

// Snooze until a given time (the page offers an hour, this afternoon and tomorrow morning).
router.post('/:id/snooze', async (req, res) => {
  if (!positiveId(req.params.id)) return res.status(400).json({ error: 'Invalid reminder' });
  const until = instant(req.body?.until);
  if (!until || until <= new Date().toISOString()) return res.status(400).json({ error: 'Snooze until a time in the future' });
  const updated = await db.prepare("UPDATE reminders SET due_at = ?, notified_at = NULL, updated_at = app_now() WHERE id = ? AND user_id = ? AND status = 'active'").run(until, req.params.id, req.user.id);
  if (updated.changes !== 1) return res.status(404).json({ error: 'Reminder not found' });
  res.json(view(await one(req.params.id, req.user.id)));
});

router.delete('/:id', async (req, res) => {
  if (!positiveId(req.params.id)) return res.status(400).json({ error: 'Invalid reminder' });
  const removed = await db.prepare('DELETE FROM reminders WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (removed.changes !== 1) return res.status(404).json({ error: 'Reminder not found' });
  res.json({ ok: true });
});

module.exports = router;
