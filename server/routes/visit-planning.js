const router = require('express').Router();
const db = require('../db');
const { requireAuth, requireManagerOrPlanner } = require('../middleware/auth');
const { logAudit } = require('../auditLog');
const { MAX_DAYS, isDay, availability } = require('../visitPlanning');

/* Maintenance visit planning: team availability and suggested slots (managers
   and planners), and time off (managers and planners for anyone; engineers
   for themselves). */
router.use(requireAuth);
const bad = (res, message) => res.status(400).json({ error: message });
const optionalId = value => (value === undefined || value === '' ? null : Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : NaN);
const planner = user => ['manager', 'planner'].includes(user.role);

router.get('/availability', requireManagerOrPlanner, async (req, res) => {
  const { from, to } = req.query;
  if (!isDay(from) || !isDay(to) || from > to) return bad(res, 'from and to must be dates (YYYY-MM-DD), from on or before to');
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > MAX_DAYS) return bad(res, `Choose at most ${MAX_DAYS} days`);
  const teamId = optionalId(req.query.team_id), customerId = optionalId(req.query.customer_id);
  if (Number.isNaN(teamId) || Number.isNaN(customerId)) return bad(res, 'Invalid team or customer');
  res.json(await availability({ from, to, teamId, customerId }));
});

router.get('/time-off', async (req, res) => {
  const { from, to } = req.query;
  if (!isDay(from) || !isDay(to) || from > to) return bad(res, 'from and to must be dates (YYYY-MM-DD)');
  const rows = await db.prepare(`SELECT t.id, t.user_id, u.name AS user_name, t.start_date, t.end_date, t.reason FROM engineer_time_off t JOIN users u ON u.id = t.user_id
    WHERE t.start_date <= ? AND t.end_date >= ?${planner(req.user) ? '' : ' AND t.user_id = ?'} ORDER BY t.start_date, u.name`).all(to, from, ...(planner(req.user) ? [] : [req.user.id]));
  res.json({ rows });
});

router.post('/time-off', async (req, res) => {
  const body = req.body || {};
  const userId = planner(req.user) ? Number(body.user_id) : req.user.id;
  if (!Number.isSafeInteger(userId) || userId < 1) return bad(res, 'Choose who is away');
  if (!isDay(body.start_date) || !isDay(body.end_date) || body.end_date < body.start_date) return bad(res, 'Choose a first and last day (the last on or after the first)');
  if ((Date.parse(body.end_date) - Date.parse(body.start_date)) / 86400000 > 366) return bad(res, 'Time off can be at most a year at a time');
  if (body.reason !== undefined && body.reason !== null && (typeof body.reason !== 'string' || body.reason.length > 200)) return bad(res, 'The reason must be text of at most 200 characters');
  const person = await db.prepare('SELECT id, name, active FROM users WHERE id = ?').get(userId);
  if (!person || !person.active) return bad(res, 'That person is not an active user');
  const result = await db.prepare('INSERT INTO engineer_time_off (user_id, start_date, end_date, reason, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(userId, body.start_date, body.end_date, body.reason?.trim() || null, req.user.id);
  await logAudit(db, req, 'time_off', result.lastInsertRowid, person.name, 'time_off_added', `${body.start_date} to ${body.end_date}`);
  require('../liveUpdates').emitChange('visits');
  res.status(201).json({ id: result.lastInsertRowid });
});

router.delete('/time-off/:id', async (req, res) => {
  const row = await db.prepare('SELECT t.*, u.name FROM engineer_time_off t JOIN users u ON u.id = t.user_id WHERE t.id = ?').get(Number(req.params.id) || 0);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!planner(req.user) && Number(row.user_id) !== Number(req.user.id)) return res.status(403).json({ error: 'You can only remove your own time off' });
  await db.prepare('DELETE FROM engineer_time_off WHERE id = ?').run(row.id);
  await logAudit(db, req, 'time_off', row.id, row.name, 'time_off_removed', `${row.start_date} to ${row.end_date}`);
  require('../liveUpdates').emitChange('visits');
  res.json({ ok: true });
});

module.exports = router;
