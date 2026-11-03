const router = require('express').Router();
const db = require('../db');
const { requireAuth, requireManager } = require('../middleware/auth');

// Managers editing the list (?include_inactive=1) also see what is switched off.
router.get('/', requireAuth, async (req, res) => {
  const all = req.query.include_inactive === '1' && req.user.role === 'manager';
  const rows = await db.prepare(`SELECT * FROM technologies ${all ? '' : 'WHERE active = 1'} ORDER BY sort_order, name`).all();
  res.json(rows);
});

router.use(requireManager);

router.post('/', async (req, res) => {
  const { name, sort_order } = req.body;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) return res.status(400).json({ error: 'Name is required (at most 100 characters)' });
  const existing = await db.prepare('SELECT 1 FROM technologies WHERE LOWER(name) = LOWER(?)').get(name.trim());
  if (existing) return res.status(409).json({ error: 'Technology already exists' });
  const result = await db.prepare('INSERT INTO technologies (name, sort_order) VALUES (?, ?)').run(name.trim(), sort_order || 0);
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid ID' });
  const { name, active, sort_order } = req.body;
  if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.trim().length > 100)) return res.status(400).json({ error: 'Name cannot be empty or longer than 100 characters' });
  if (sort_order != null && !Number.isSafeInteger(sort_order)) return res.status(400).json({ error: 'Invalid order' });
  if (name !== undefined && await db.prepare('SELECT 1 FROM technologies WHERE LOWER(name) = LOWER(?) AND id != ?').get(name.trim(), id))
    return res.status(409).json({ error: 'Technology already exists' });
  const updated = await db.prepare(`UPDATE technologies SET name=COALESCE(?,name), active=COALESCE(?,active), sort_order=COALESCE(?,sort_order) WHERE id=?`)
    .run(name?.trim() || null, active != null ? (active ? 1 : 0) : null, sort_order ?? null, id);
  if (!updated.changes) return res.status(404).json({ error: 'Technology not found' });
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid ID' });
  const inUse = await db.prepare('SELECT 1 FROM service_activity_technologies WHERE technology_id = ?').get(id);
  if (inUse) return res.status(409).json({ error: 'Technology is used by existing activities — deactivate it instead of deleting' });
  await db.prepare('DELETE FROM technologies WHERE id = ?').run(id);
  res.json({ ok: true });
});

module.exports = router;
