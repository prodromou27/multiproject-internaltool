const router = require('express').Router();
const db = require('../db');
const { requireAuth, requireManager } = require('../middleware/auth');
const { logAudit } = require('../auditLog');
const { getEnabledTeamIdsForUser } = require('../serviceActivities');
const { validateSlaTargets, getTeamSlaTargets } = require('../teamSla');

function optionalBoolean(value, label) {
  if (value === undefined) return { value: null };
  if (typeof value !== 'boolean') return { error: `${label} must be true or false` };
  return { value: value ? 1 : 0 };
}

function workflowCapabilities(rows) {
  const managedServiceOperations = rows.some(team => !!team.managed_service_operations);
  const projectDelivery = rows.some(team => !!team.project_delivery_enabled);
  return {
    managedServiceOperations,
    serviceActivityTracking: rows.some(team => !!team.service_activity_enabled),
    projectDelivery,
    maintenanceVisits: true,
    managedCustomerAccess: managedServiceOperations,
    profile: managedServiceOperations && projectDelivery ? 'mixed' : managedServiceOperations ? 'managed_services' : projectDelivery ? 'project_delivery' : 'shared',
  };
}

// Any authenticated user — used by the client to decide whether to show the
// Activity Log nav item / route. Server-side routes independently re-check
// team membership + enablement on every request; this endpoint is UX-only.
router.get('/mine', requireAuth, async (req, res) => {
  const rows = await db.prepare(`
    SELECT t.id, t.name, t.service_activity_enabled, t.managed_service_operations, t.project_delivery_enabled
    FROM teams t
    JOIN team_members tm ON tm.team_id = t.id
    WHERE tm.user_id = ?
    ORDER BY t.name
  `).all(req.user.id);
  const capabilities = workflowCapabilities(rows);
  res.json({ teams: rows, service_activity_enabled: capabilities.serviceActivityTracking, capabilities });
});

router.use(requireManager);

router.get('/', async (req, res) => {
  const rows = await db.prepare(`
    SELECT t.*, (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) AS member_count
    FROM teams t ORDER BY t.name
  `).all();
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid ID' });
  const team = await db.prepare('SELECT * FROM teams WHERE id = ?').get(id);
  if (!team) return res.status(404).json({ error: 'Not found' });
  const members = await db.prepare(`
    SELECT u.id, u.name, u.email, u.role FROM team_members tm
    JOIN users u ON u.id = tm.user_id WHERE tm.team_id = ? ORDER BY u.name
  `).all(id);
  const sla = (await getTeamSlaTargets([id]))[id];
  res.json({ ...team, members, sla });
});

/* ── Service Activity SLA targets ─────────────────────────────
 * Per-team response/resolution targets (hours). A team with no row uses the
 * app-wide defaults (server/teamSla.js) — see routes/sla.js for how these
 * are evaluated against open service activities. */
router.put('/:id/sla', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid ID' });
  const team = await db.prepare('SELECT * FROM teams WHERE id = ?').get(id);
  if (!team) return res.status(404).json({ error: 'Not found' });
  const parsed = validateSlaTargets(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  await db.prepare(`
    INSERT INTO team_sla_targets (team_id, response_hours, resolution_hours, updated_by, updated_at)
    VALUES (?, ?, ?, ?, app_now())
    ON CONFLICT (team_id) DO UPDATE SET
      response_hours = EXCLUDED.response_hours, resolution_hours = EXCLUDED.resolution_hours,
      updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
  `).run(id, parsed.value.response_hours, parsed.value.resolution_hours, req.user.id);
  await logAudit(db, req, 'team', id, team.name, 'team_sla_updated',
    `response_hours=${parsed.value.response_hours}; resolution_hours=${parsed.value.resolution_hours}`);
  res.json({ ok: true, sla: parsed.value });
});

router.post('/', async (req, res) => {
  const { name, description, service_activity_enabled } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  const tracking=optionalBoolean(service_activity_enabled,'service_activity_enabled');
  const managed=optionalBoolean(req.body.managed_service_operations,'managed_service_operations');
  const delivery=optionalBoolean(req.body.project_delivery_enabled,'project_delivery_enabled');
  const invalid=[tracking,managed,delivery].find(value => value.error);
  if (invalid) return res.status(400).json({ error:invalid.error });
  const trackingValue=tracking.value ?? 0;
  const managedValue=managed.value ?? trackingValue;
  const deliveryValue=delivery.value ?? (managedValue ? 0 : 1);
  const existing = await db.prepare('SELECT 1 FROM teams WHERE LOWER(name) = LOWER(?)').get(name.trim());
  if (existing) return res.status(409).json({ error: 'A team with this name already exists' });
  const result = await db.prepare(
    'INSERT INTO teams (name, description, service_activity_enabled, managed_service_operations, project_delivery_enabled) VALUES (?, ?, ?, ?, ?)'
  ).run(name.trim(), description || null, trackingValue, managedValue, deliveryValue);
  await logAudit(db, req, 'team', result.lastInsertRowid, name.trim(), 'team_created',
    `service_activity_enabled=${trackingValue}; managed_service_operations=${managedValue}; project_delivery_enabled=${deliveryValue}`);
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid ID' });
  const team = await db.prepare('SELECT * FROM teams WHERE id = ?').get(id);
  if (!team) return res.status(404).json({ error: 'Not found' });
  const { name, description, service_activity_enabled } = req.body;
  if (name !== undefined && !name?.trim()) return res.status(400).json({ error: 'Name cannot be empty' });
  const tracking=optionalBoolean(service_activity_enabled,'service_activity_enabled');
  const managed=optionalBoolean(req.body.managed_service_operations,'managed_service_operations');
  const delivery=optionalBoolean(req.body.project_delivery_enabled,'project_delivery_enabled');
  const invalid=[tracking,managed,delivery].find(value => value.error);
  if (invalid) return res.status(400).json({ error:invalid.error });
  if (name?.trim()) {
    const dupe = await db.prepare('SELECT 1 FROM teams WHERE LOWER(name) = LOWER(?) AND id != ?').get(name.trim(), id);
    if (dupe) return res.status(409).json({ error: 'A team with this name already exists' });
  }
  await db.prepare(`UPDATE teams SET name=COALESCE(?,name), description=?, service_activity_enabled=COALESCE(?,service_activity_enabled),
    managed_service_operations=COALESCE(?,managed_service_operations),project_delivery_enabled=COALESCE(?,project_delivery_enabled) WHERE id=?`)
    .run(name?.trim() || null, description !== undefined ? description : team.description,
      tracking.value,managed.value,delivery.value,id);
  if (service_activity_enabled != null && !!service_activity_enabled !== !!team.service_activity_enabled) {
    await logAudit(db, req, 'team', id, name?.trim() || team.name, 'team_tracking_toggled',
      `service_activity_enabled ${!!team.service_activity_enabled}->${!!service_activity_enabled}`);
  }
  if (managed.value!==null || delivery.value!==null) await logAudit(db,req,'team',id,name?.trim() || team.name,'team_workflow_updated',
    `managed_service_operations=${managed.value ?? Number(team.managed_service_operations)}; project_delivery_enabled=${delivery.value ?? Number(team.project_delivery_enabled)}`);
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid ID' });
  const team = await db.prepare('SELECT * FROM teams WHERE id = ?').get(id);
  if (team) await logAudit(db, req, 'team', id, team.name, 'team_deleted', null);
  await db.prepare('DELETE FROM teams WHERE id = ?').run(id);
  res.json({ ok: true });
});

/* ── Membership ────────────────────────────────────────────── */
router.put('/:id/members', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid ID' });
  const team = await db.prepare('SELECT * FROM teams WHERE id = ?').get(id);
  if (!team) return res.status(404).json({ error: 'Not found' });
  const { user_ids } = req.body;
  if (!Array.isArray(user_ids)) return res.status(400).json({ error: 'user_ids must be an array' });
  await db.transaction(async (tx) => {
    await tx.prepare('DELETE FROM team_members WHERE team_id = ?').run(id);
    const ins = tx.prepare('INSERT INTO team_members (team_id, user_id) VALUES (?, ?)');
    for (const uid of user_ids) {
      if (Number.isInteger(uid) && uid > 0) await ins.run(id, uid);
    }
  });
  await logAudit(db, req, 'team', id, team.name, 'team_members_updated', `count=${user_ids.length}`);
  res.json({ ok: true });
});

module.exports = router;
