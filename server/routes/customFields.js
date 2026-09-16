const router = require('express').Router({ mergeParams: true });
const db     = require('../db');
const { requireAuth } = require('../middleware/auth');

function canManage(req) {
  return ['manager', 'planner'].includes(req.user.role);
}

function validateField({ name, field_type, options, sort_order }) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) return 'Field name must contain 1 to 120 characters';
  if (!['text', 'number', 'date', 'select'].includes(field_type)) return 'Invalid field_type';
  if (!Array.isArray(options) || options.length > 100 || options.some(o => typeof o !== 'string' || !o.trim() || o.length > 200)
    || new Set(options).size !== options.length) return 'Options must be a list of unique non-empty strings';
  if (!Number.isSafeInteger(Number(sort_order))) return 'sort_order must be an integer';
  return null;
}

async function checkTaskAccess(req, res, projectId) {
  if (!['manager', 'engineer'].includes(req.user.role)) {
    res.status(403).json({ error: 'Forbidden' }); return null;
  }
  const task = await db.prepare('SELECT id, assigned_to FROM tasks WHERE id = ? AND project_id = ?').get(req.params.taskId, projectId);
  if (!task) { res.status(404).json({ error: 'Task not found in this project' }); return null; }
  if (req.user.role === 'engineer' && task.assigned_to !== req.user.id) {
    res.status(403).json({ error: 'Forbidden' }); return null;
  }
  return task;
}

function validateValue(field, value) {
  if (value !== null && typeof value !== 'string' && typeof value !== 'number') return 'Values must be text, numbers or null';
  const text = value == null ? '' : String(value);
  if (!text.trim()) return field.required ? `${field.name} is required` : null;
  if (text.length > 10000) return `${field.name} cannot exceed 10000 characters`;
  if (field.field_type === 'number' && !Number.isFinite(Number(text))) return `${field.name} must be a finite number`;
  if (field.field_type === 'select' && !JSON.parse(field.options || '[]').includes(text)) return `Invalid option for ${field.name}`;
  if (field.field_type === 'date') {
    const date = new Date(`${text}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || isNaN(date) || date.toISOString().slice(0, 10) !== text) return `Invalid date for ${field.name}`;
  }
  return null;
}

async function checkProjectAccess(req, res) {
  const id = Number(req.params.projectId);
  if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: 'Invalid project ID' }); return null; }
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
  const error = validateField({ name, field_type, options, sort_order });
  if (error) return res.status(400).json({ error });
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
  const error = validateField({ ...f, options: JSON.parse(f.options || '[]'), ...req.body });
  if (error) return res.status(400).json({ error });
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
  const task = await checkTaskAccess(req, res, pid);
  if (!task) return;
  const rows = await db.prepare(`SELECT v.field_id, v.value FROM task_custom_values v
    JOIN project_custom_fields f ON f.id = v.field_id WHERE v.task_id = ? AND f.project_id = ?`).all(task.id, pid);
  const map = {};
  rows.forEach(r => { map[r.field_id] = r.value; });
  res.json(map);
});

// PUT /api/projects/:projectId/custom-fields/values/:taskId  (body: { values: { fieldId: value } })
router.put('/values/:taskId', requireAuth, async (req, res) => {
  const pid = await checkProjectAccess(req, res);
  if (!pid) return;
  const task = await checkTaskAccess(req, res, pid);
  if (!task) return;
  const { values = {} } = req.body;
  if (!values || typeof values !== 'object' || Array.isArray(values)) return res.status(400).json({ error: 'values must be a plain object' });
  const fields = await db.prepare('SELECT * FROM project_custom_fields WHERE project_id = ?').all(pid);
  const fieldsById = new Map(fields.map(f => [String(f.id), f]));
  for (const [fieldId, value] of Object.entries(values)) {
    const field = fieldsById.get(fieldId);
    if (!field) return res.status(400).json({ error: 'Field does not belong to this project' });
    const error = validateValue(field, value);
    if (error) return res.status(400).json({ error });
  }
  await db.transaction(async (tx) => {
    const upsert = tx.prepare('INSERT INTO task_custom_values (task_id, field_id, value) VALUES (?,?,?) ON CONFLICT (task_id, field_id) DO UPDATE SET value = EXCLUDED.value');
    for (const [fieldId, value] of Object.entries(values)) {
      await upsert.run(task.id, parseInt(fieldId, 10), value !== null && value !== undefined ? String(value) : null);
    }
  });
  res.json({ ok: true });
});

module.exports = router;
