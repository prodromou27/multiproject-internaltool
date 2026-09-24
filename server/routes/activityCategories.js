const router = require('express').Router();
const db = require('../db');
const { requireAuth, requireManager } = require('../middleware/auth');

// Any authenticated user with module access reads categories (for the quick-log form
// and for display elsewhere, e.g. the customer service profile). Every category is
// visible here regardless of team — access to *use* one for a specific activity is
// enforced separately in routes/serviceActivities.js (GET /meta), which scopes the
// list to the team the activity actually belongs to.
router.get('/', requireAuth, async (req, res) => {
  const categories = await db.prepare(`
    SELECT c.*, t.name AS team_name FROM activity_categories c
    LEFT JOIN teams t ON t.id = c.team_id
    WHERE c.active = 1 ORDER BY c.sort_order, c.name
  `).all();
  const subcategories = await db.prepare(
    'SELECT * FROM activity_subcategories WHERE active = 1 ORDER BY sort_order, name'
  ).all();
  res.json(categories.map(c => ({
    ...c,
    subcategories: subcategories.filter(s => s.category_id === c.id),
  })));
});

router.use(requireManager);

// null/undefined = shared/global category (visible to every team). Anything else
// must be an existing team's id.
async function resolveTeamId(value) {
  if (value === undefined || value === null || value === '') return { value: null };
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) return { error: 'Invalid team ID' };
  if (!await db.prepare('SELECT 1 FROM teams WHERE id = ?').get(id)) return { error: 'Team not found' };
  return { value: id };
}

// Uniqueness is scoped per team_id (global categories and each team's categories
// each have their own namespace) — see the comment on activity_categories in db.js.
async function nameTaken(name, teamId, excludeId) {
  // "team_id IS NOT DISTINCT FROM ?" would be the natural Postgres phrasing, but
  // pg-mem (used by the local/CI test suite) doesn't parse it, and binding a bare
  // null positional param against an integer column trips up its type inference
  // too — so this branches instead of trying to express both cases in one query.
  const exclude = excludeId ?? -1;
  return !!await (teamId === null
    ? db.prepare('SELECT 1 FROM activity_categories WHERE LOWER(name) = LOWER(?) AND team_id IS NULL AND id != ?').get(name, exclude)
    : db.prepare('SELECT 1 FROM activity_categories WHERE LOWER(name) = LOWER(?) AND team_id = ? AND id != ?').get(name, teamId, exclude));
}

router.post('/', async (req, res) => {
  const { name, sort_order, require_attachment, require_asset } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  const team = await resolveTeamId(req.body.team_id);
  if (team.error) return res.status(400).json({ error: team.error });
  if (await nameTaken(name.trim(), team.value)) return res.status(409).json({ error: 'Category already exists' });
  const result = await db.prepare('INSERT INTO activity_categories (name, team_id, sort_order, require_attachment, require_asset) VALUES (?, ?, ?, ?, ?)')
    .run(name.trim(), team.value, sort_order || 0, require_attachment ? 1 : 0, require_asset ? 1 : 0);
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid ID' });
  const existing = await db.prepare('SELECT * FROM activity_categories WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Category not found' });
  const { name, active, sort_order, require_attachment, require_asset } = req.body;

  let teamId = existing.team_id;
  if (req.body.team_id !== undefined) {
    const team = await resolveTeamId(req.body.team_id);
    if (team.error) return res.status(400).json({ error: team.error });
    teamId = team.value;
  }
  const nextName = name?.trim() || existing.name;
  if ((name?.trim() || teamId !== existing.team_id) && await nameTaken(nextName, teamId, id))
    return res.status(409).json({ error: 'Category already exists' });

  await db.prepare(`UPDATE activity_categories SET name=?, team_id=?, active=COALESCE(?,active), sort_order=COALESCE(?,sort_order), require_attachment=COALESCE(?,require_attachment), require_asset=COALESCE(?,require_asset) WHERE id=?`)
    .run(nextName, teamId, active != null ? (active ? 1 : 0) : null, sort_order ?? null, require_attachment != null ? (require_attachment ? 1 : 0) : null, require_asset != null ? (require_asset ? 1 : 0) : null, id);
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
