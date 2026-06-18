const router = require('express').Router();
const db = require('../db');
const { requireAuth, requireManager } = require('../middleware/auth');

function parseNumber(value, label, { min = 0 } = {}) {
  if (value === undefined || value === null || value === '') return { value: null };
  const n = Number(value);
  if (!Number.isFinite(n) || n < min) return { error: `${label} must be a number greater than or equal to ${min}` };
  return { value: n };
}

// Engineers can view KPIs for projects they're assigned to; managers see all
router.get('/:project_id', requireAuth, async (req, res) => {
  if (req.user.role === 'engineer') {
    const assigned = (await db.prepare('SELECT 1 FROM project_assignments WHERE project_id = ? AND user_id = ?').get(req.params.project_id, req.user.id));
    if (!assigned) return res.status(403).json({ error: 'Forbidden' });
  }
  const rows = (await db.prepare('SELECT k.*, u.name as updated_by_name FROM kpis k LEFT JOIN users u ON k.updated_by = u.id WHERE k.project_id = ? ORDER BY k.id').all(req.params.project_id));
  res.json(rows);
});

router.post('/:project_id', requireManager, async (req, res) => {
  const { name, target_value, current_value, unit } = req.body;
  if (!name?.trim() || target_value == null) return res.status(400).json({ error: 'Name and target required' });
  if (name.trim().length > 120) return res.status(400).json({ error: 'Name cannot exceed 120 characters' });
  const target = parseNumber(target_value, 'target_value', { min: 0.000001 });
  if (target.error) return res.status(400).json({ error: target.error });
  const current = parseNumber(current_value ?? 0, 'current_value', { min: 0 });
  if (current.error) return res.status(400).json({ error: current.error });
  const project = (await db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.project_id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const result = (await db.prepare('INSERT INTO kpis (project_id, name, target_value, current_value, unit, updated_by) VALUES (?, ?, ?, ?, ?, ?)').run(req.params.project_id, name.trim(), target.value, current.value, unit?.trim() || null, req.user.id));
  res.json({ id: result.lastInsertRowid });
});

router.put('/:project_id/:id', requireManager, async (req, res) => {
  const { name, target_value, current_value, unit } = req.body;
  if (name !== undefined && !name?.trim()) return res.status(400).json({ error: 'Name cannot be empty' });
  if (name?.trim().length > 120) return res.status(400).json({ error: 'Name cannot exceed 120 characters' });
  const target = parseNumber(target_value, 'target_value', { min: 0.000001 });
  if (target.error) return res.status(400).json({ error: target.error });
  const current = parseNumber(current_value, 'current_value', { min: 0 });
  if (current.error) return res.status(400).json({ error: current.error });
  const result = (await db.prepare(`UPDATE kpis SET name=COALESCE(?,name), target_value=COALESCE(?,target_value),
    current_value=COALESCE(?,current_value), unit=COALESCE(?,unit),
    updated_by=?, updated_at=datetime('now') WHERE id=? AND project_id=?`)
    .run(name?.trim() || null, target.value, current.value, unit?.trim() || null, req.user.id, req.params.id, req.params.project_id));
  if (!result.changes) return res.status(404).json({ error: 'KPI not found' });
  res.json({ ok: true });
});

router.delete('/:project_id/:id', requireManager, async (req, res) => {
  const result = (await db.prepare('DELETE FROM kpis WHERE id = ? AND project_id = ?').run(req.params.id, req.params.project_id));
  if (!result.changes) return res.status(404).json({ error: 'KPI not found' });
  res.json({ ok: true });
});

module.exports = router;
