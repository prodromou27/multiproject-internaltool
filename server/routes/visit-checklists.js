/* Visit checklists (enhancement E03): reusable lists of what to check on a
   maintenance visit (e.g. "Firewall health check"). Everyone reads them; managers
   add, change and remove them. Stored as one list in settings, like Customer
   Responses. A visit keeps its own copy of the list it was run with
   (maintenance-visits.js, PUT /:id/checklist), so changing a template never
   rewrites a visit that was already done. */
const router = require('express').Router();
const crypto = require('crypto');
const db = require('../db');
const { requireAuth, requireManager } = require('../middleware/auth');
const { logAudit } = require('../auditLog');

const KEY = 'visit_checklists';
const MAX = 50;

async function list() {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY);
  if (!row) return [];
  try { const value = JSON.parse(row.value); return Array.isArray(value) ? value : []; } catch { return []; }
}
const save = rows => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value').run(KEY, JSON.stringify(rows));

function input(body) {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 120) return { error: 'The name must have 1 to 120 characters' };
  const items = Array.isArray(body.items) ? body.items.map(item => (typeof item === 'string' ? item.trim() : '')).filter(Boolean) : null;
  if (!items || !items.length || items.length > 50 || items.some(item => item.length > 200)) return { error: 'Between 1 and 50 checks of up to 200 characters' };
  return { value: { name, items } };
}

router.get('/', requireAuth, async (req, res) => res.json({ rows: await list(), can_edit: req.user.role === 'manager' }));

router.post('/', requireManager, async (req, res) => {
  const checked = input(req.body);
  if (checked.error) return res.status(400).json({ error: checked.error });
  const rows = await list();
  if (rows.length >= MAX) return res.status(400).json({ error: `At most ${MAX} checklists` });
  const row = { id: crypto.randomUUID(), ...checked.value };
  await save([...rows, row]);
  await logAudit(db, req, 'visit_checklist', null, row.name, 'created', null);
  res.status(201).json(row);
});

router.put('/:id', requireManager, async (req, res) => {
  const checked = input(req.body);
  if (checked.error) return res.status(400).json({ error: checked.error });
  const rows = await list();
  const index = rows.findIndex(row => row.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'Checklist not found' });
  rows[index] = { id: rows[index].id, ...checked.value };
  await save(rows);
  await logAudit(db, req, 'visit_checklist', null, rows[index].name, 'updated', null);
  res.json(rows[index]);
});

router.delete('/:id', requireManager, async (req, res) => {
  const rows = await list();
  const gone = rows.find(row => row.id === req.params.id);
  if (!gone) return res.status(404).json({ error: 'Checklist not found' });
  await save(rows.filter(row => row.id !== req.params.id));
  await logAudit(db, req, 'visit_checklist', null, gone.name, 'deleted', null);
  res.json({ ok: true });
});

module.exports = router;
