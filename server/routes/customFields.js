const router = require('express').Router({ mergeParams: true });
const db     = require('../db');
const { requireAuth } = require('../middleware/auth');

function canManage(req) {
  return ['manager', 'planner'].includes(req.user.role);
}

async function checkProjectAccess(req, res) {
  const id = parseInt(req.params.projectId, 10);
  if (!id) { res.status(400).json({ error: 'Invalid project ID' }); return null; }
  const p = (await db.prepare('SELECT id FROM projects WHERE id = ?').get(id));
  if (!p) { res.status(404).json({ error: 'Project not found' }); return null; }
  if (req.user.role !== 'manager' && req.user.role !== 'pm') {
    const assigned = (await db.prepare('SELECT 1 FROM project_assignments WHERE project_id = ? AND user_id = ?').get(id, req.user.id));
    if (!assigned) { res.status(403).json({ error: 'Forbidden' }); return null; }
  }
  return id;
}

// GET /api/projects/:projectId/custom-fields
router.get('/', requireAuth, async (req, res) => {
  const pid = await checkProjectAccess(req, res);
  if (!pid) return;
  const fields = (await db.prepare('SELECT * FROM project_custom_fields WHERE project_id = ? ORDER BY sort_order, id').all(pid));
  res.json(fields.map(f => ({ ...f, options: f.options ? JSON.parse(f.options) : [] })));
});

// POST /api/projects/:projectId/custom-fields
router.post('/', requireAuth, async (req, res) => {
  const pid = await checkProjectAccess(req, res);
  if (!pid) return;
  if (!canManage(req)) return res.status(403).json({ error: 'Forbidden' });
  const { name, field_type = 'text', options = [], required = false, sort_order = 0 } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const VALID_TYPES = ['text', 'number', 'date', 'select'];
  if (!VALID_TYPES.includes(field_type)) return res.status(400).json({ error: 'Invalid field_type' });
  const r = (await db.prepare(
    'INSERT INTO project_custom_fields (project_id, name, field_type, options, required, sort_order) VALUES (?,?,?,?,?,?)'
  ).run(pid, name.trim(), field_type, JSON.stringify(options), required ? 1 : 0, Number(sort_order) || 0));
  res.json({ id: r.lastInsertRowid });
});

// PUT /api/projects/:projectId/custom-fields/:fid
router.put('/:fid', requireAuth, async (req, res) => {
  const pid = await checkProjectAccess(req, res);
  if (!pid) return;
  if (!canManage(req)) return res.status(403).json({ error: 'Forbidden' });
  const f = (await db.prepare('SELECT * FROM project_custom_fields WHERE id = ? AND project_id = ?').get(req.params.fid, pid));
  if (!f) return res.status(404).json({ error: 'Field not found' });
  const { name, field_type, options, required, sort_order } = req.body;
  // Reject explicitly empty name (COALESCE would silently ignore it)
  if (name !== undefined && !name?.trim()) return res.status(400).json({ error: 'name cannot be empty' });
  (await db.prepare(`UPDATE project_custom_fields SET
    name=COALESCE(?,name), field_type=COALESCE(?,field_type),
    options=COALESCE(?,options), required=COALESCE(?,required), sort_order=COALESCE(?,sort_order)
    WHERE id=?`).run(
    name?.trim() || null, field_type || null,
    options !== undefined ? JSON.stringify(options) : null,
    required !== undefined ? (required ? 1 : 0) : null,
    sort_order !== undefined ? Number(sort_order) : null,
    f.id
  ));
  res.json({ ok: true });
});

// DELETE /api/projects/:projectId/custom-fields/:fid
router.delete('/:fid', requireAuth, async (req, res) => {
  const pid = await checkProjectAccess(req, res);
  if (!pid) return;
  if (!canManage(req)) return res.status(403).json({ error: 'Forbidden' });
  (await db.prepare('DELETE FROM project_custom_fields WHERE id = ? AND project_id = ?').run(req.params.fid, pid));
  res.json({ ok: true });
});

// GET /api/projects/:projectId/custom-fields/values/:taskId
router.get('/values/:taskId', requireAuth, async (req, res) => {
  const pid = await checkProjectAccess(req, res);
  if (!pid) return;
  // Verify the task actually belongs to this project (prevents cross-project data leak)
  const task = (await db.prepare('SELECT id FROM tasks WHERE id = ? AND project_id = ?').get(req.params.taskId, pid));
  if (!task) return res.status(404).json({ error: 'Task not found in this project' });
  const rows = (await db.prepare('SELECT field_id, value FROM task_custom_values WHERE task_id = ?').all(req.params.taskId));
  const map = {};
  rows.forEach(r => { map[r.field_id] = r.value; });
  res.json(map);
});

// PUT /api/projects/:projectId/custom-fields/values/:taskId  (body: { values: { fieldId: value } })
router.put('/values/:taskId', requireAuth, async (req, res) => {
  const pid = await checkProjectAccess(req, res);
  if (!pid) return;
  const task = (await db.prepare('SELECT id FROM tasks WHERE id = ? AND project_id = ?').get(req.params.taskId, pid));
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const { values = {} } = req.body;
  if (typeof values !== 'object' || Array.isArray(values)) return res.status(400).json({ error: 'values must be a plain object' });
  await db.transaction(async (tx) => {
    const upsert = tx.prepare('INSERT INTO task_custom_values (task_id, field_id, value) VALUES (?,?,?) ON CONFLICT (task_id, field_id) DO UPDATE SET value = EXCLUDED.value');
    for (const [fieldId, value] of Object.entries(values)) {
      await upsert.run(task.id, parseInt(fieldId, 10), value !== null && value !== undefined ? String(value) : null);
    }
  });
  res.json({ ok: true });
});

module.exports = router;
