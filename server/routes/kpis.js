const router = require('express').Router();
const db = require('../db');
const { requirePermission } = require('../middleware/auth');

function parseNumber(value, label, { min = 0 } = {}) {
  if (value === undefined || value === null || value === '') return { value: null };
  const n = Number(value);
  if (!Number.isFinite(n) || n < min) return { error: `${label} must be a number greater than or equal to ${min}` };
  return { value: n };
}

router.get('/:project_id', requirePermission('kpis.view'), async (req, res) => {
  const rows = (await db.prepare('SELECT k.*, u.name as updated_by_name FROM kpis k LEFT JOIN users u ON k.updated_by = u.id WHERE k.project_id = ? ORDER BY k.id').all(req.params.project_id));
  res.json(rows);
});

router.post('/:project_id', requirePermission('kpis.manage'), async (req, res) => {
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

router.put('/:project_id/:id', requirePermission('kpis.manage'), async (req, res) => {
  const { name, target_value, current_value, unit } = req.body;
  if (name !== undefined && !name?.trim()) return res.status(400).json({ error: 'Name cannot be empty' });
  if (name?.trim().length > 120) return res.status(400).json({ error: 'Name cannot exceed 120 characters' });
  const target = parseNumber(target_value, 'target_value', { min: 0.000001 });
  if (target.error) return res.status(400).json({ error: target.error });
  const current = parseNumber(current_value, 'current_value', { min: 0 });
  if (current.error) return res.status(400).json({ error: current.error });
  const result = (await db.prepare(`UPDATE kpis SET name=COALESCE(?,name), target_value=COALESCE(?,target_value),
    current_value=COALESCE(?,current_value), unit=COALESCE(?,unit),
    updated_by=?, updated_at=app_now() WHERE id=? AND project_id=?`)
    .run(name?.trim() || null, target.value, current.value, unit?.trim() || null, req.user.id, req.params.id, req.params.project_id));
  if (!result.changes) return res.status(404).json({ error: 'KPI not found' });
  res.json({ ok: true });
});

router.delete('/:project_id/:id', requirePermission('kpis.manage'), async (req, res) => {
  const result = (await db.prepare('DELETE FROM kpis WHERE id = ? AND project_id = ?').run(req.params.id, req.params.project_id));
  if (!result.changes) return res.status(404).json({ error: 'KPI not found' });
  res.json({ ok: true });
});

module.exports = router;
