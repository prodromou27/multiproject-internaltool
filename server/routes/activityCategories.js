const router = require('express').Router();
const db = require('../db');
const { requireAuth, requireManager } = require('../middleware/auth');

// Any authenticated user with module access reads categories (for the quick-log form).
router.get('/', requireAuth, async (req, res) => {
  const categories = await db.prepare(
    'SELECT * FROM activity_categories WHERE active = 1 ORDER BY sort_order, name'
  ).all();
  const subcategories = await db.prepare(
    'SELECT * FROM activity_subcategories WHERE active = 1 ORDER BY sort_order, name'
  ).all();
  res.json(categories.map(c => ({
    ...c,
    subcategories: subcategories.filter(s => s.category_id === c.id),
  })));
});

router.use(requireManager);

router.post('/', async (req, res) => {
  const { name, sort_order } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  const existing = await db.prepare('SELECT 1 FROM activity_categories WHERE LOWER(name) = LOWER(?)').get(name.trim());
  if (existing) return res.status(409).json({ error: 'Category already exists' });
  const result = await db.prepare('INSERT INTO activity_categories (name, sort_order) VALUES (?, ?)')
    .run(name.trim(), sort_order || 0);
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid ID' });
  const { name, active, sort_order } = req.body;
  await db.prepare(`UPDATE activity_categories SET name=COALESCE(?,name), active=COALESCE(?,active), sort_order=COALESCE(?,sort_order) WHERE id=?`)
    .run(name?.trim() || null, active != null ? (active ? 1 : 0) : null, sort_order ?? null, id);
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid ID' });
  const inUse = await db.prepare('SELECT 1 FROM service_activities WHERE category_id = ?').get(id);
  if (inUse) return res.status(409).json({ error: 'Category is used by existing activities — deactivate it instead of deleting' });
  await db.prepare('DELETE FROM activity_categories WHERE id = ?').run(id);
  res.json({ ok: true });
});

/* ── Subcategories ─────────────────────────────────────────── */
router.post('/:id/subcategories', async (req, res) => {
  const categoryId = parseInt(req.params.id, 10);
  if (!categoryId) return res.status(400).json({ error: 'Invalid ID' });
  const category = await db.prepare('SELECT 1 FROM activity_categories WHERE id = ?').get(categoryId);
  if (!category) return res.status(404).json({ error: 'Category not found' });
  const { name, sort_order } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  try {
    const result = await db.prepare('INSERT INTO activity_subcategories (category_id, name, sort_order) VALUES (?, ?, ?)')
      .run(categoryId, name.trim(), sort_order || 0);
    res.json({ id: result.lastInsertRowid });
  } catch (e) {
    res.status(409).json({ error: 'Subcategory already exists for this category' });
  }
});

router.put('/:id/subcategories/:subId', async (req, res) => {
  const subId = parseInt(req.params.subId, 10);
  if (!subId) return res.status(400).json({ error: 'Invalid ID' });
  const { name, active, sort_order } = req.body;
  await db.prepare(`UPDATE activity_subcategories SET name=COALESCE(?,name), active=COALESCE(?,active), sort_order=COALESCE(?,sort_order) WHERE id=? AND category_id=?`)
    .run(name?.trim() || null, active != null ? (active ? 1 : 0) : null, sort_order ?? null, subId, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id/subcategories/:subId', async (req, res) => {
  const subId = parseInt(req.params.subId, 10);
  if (!subId) return res.status(400).json({ error: 'Invalid ID' });
  await db.prepare('DELETE FROM activity_subcategories WHERE id = ? AND category_id = ?').run(subId, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
