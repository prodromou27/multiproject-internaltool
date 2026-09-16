const router = require('express').Router();
const db = require('../db');
const { requireAuth, requireManager } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res) => {
  const rows = await db.prepare('SELECT * FROM technologies WHERE active = 1 ORDER BY sort_order, name').all();
  res.json(rows);
});

router.use(requireManager);

router.post('/', async (req, res) => {
  const { name, sort_order } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  const existing = await db.prepare('SELECT 1 FROM technologies WHERE LOWER(name) = LOWER(?)').get(name.trim());
  if (existing) return res.status(409).json({ error: 'Technology already exists' });
  const result = await db.prepare('INSERT INTO technologies (name, sort_order) VALUES (?, ?)').run(name.trim(), sort_order || 0);
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid ID' });
  const { name, active, sort_order } = req.body;
  await db.prepare(`UPDATE technologies SET name=COALESCE(?,name), active=COALESCE(?,active), sort_order=COALESCE(?,sort_order) WHERE id=?`)
    .run(name?.trim() || null, active != null ? (active ? 1 : 0) : null, sort_order ?? null, id);
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
