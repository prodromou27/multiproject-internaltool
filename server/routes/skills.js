const router = require('express').Router();
const db = require('../db');
const { requirePermission } = require('../middleware/auth');
const { hasPermission } = require('../permissions');
const { logAudit } = require('../auditLog');
const appTime = require('../appTime');
const { LEVELS, coverage } = require('../skillMatrix');

const positiveId = value => /^\d+$/.test(String(value)) && Number(value) > 0 ? Number(value) : null;

// The whole matrix: technologies (with how many customer devices use each), active
// engineers and their teams, ratings, activity logged per technology in the last
// 12 months as evidence, and coverage per technology.
router.get('/', requirePermission('skills.view'), async (req, res) => {
  const since = appTime.addDays(appTime.today(), -365);
  const [technologies, engineers, memberships, teams, ratings, activity, assets, canManage] = await Promise.all([
    db.prepare('SELECT id, name, skill_target FROM technologies WHERE active = 1 ORDER BY sort_order, name').all(),
    db.prepare("SELECT id, name FROM users WHERE active = 1 AND role = 'engineer' ORDER BY name").all(),
    db.prepare('SELECT team_id, user_id FROM team_members').all(),
    db.prepare('SELECT id, name FROM teams ORDER BY name').all(),
    db.prepare(`SELECT s.user_id, s.technology_id, s.level, s.note, s.rated_at, u.name AS rated_by_name
                FROM engineer_skills s LEFT JOIN users u ON u.id = s.rated_by`).all(),
    db.prepare(`SELECT a.engineer_id AS user_id, sat.technology_id, COUNT(*) AS activities, MAX(a.activity_date) AS last_date
                FROM service_activity_technologies sat JOIN service_activities a ON a.id = sat.service_activity_id
                WHERE a.activity_date >= ? AND a.status <> 'cancelled'
                GROUP BY a.engineer_id, sat.technology_id`).all(since),
    db.prepare(`SELECT technology_id, COUNT(*) AS devices, COUNT(DISTINCT customer_id) AS customers
                FROM customer_assets WHERE technology_id IS NOT NULL AND lifecycle_status = 'active'
                GROUP BY technology_id`).all(),
    hasPermission(req.user, 'skills.manage'),
  ]);
  const engineerIds = new Set(engineers.map(e => Number(e.id)));
  const current = ratings.filter(r => engineerIds.has(Number(r.user_id)));
  const assetsBy = new Map(assets.map(a => [Number(a.technology_id), a]));
  res.json({
    levels: LEVELS,
    technologies: technologies.map(t => ({ ...t, devices: Number(assetsBy.get(Number(t.id))?.devices || 0), customers: Number(assetsBy.get(Number(t.id))?.customers || 0) })),
    engineers: engineers.map(e => ({ ...e, team_ids: memberships.filter(m => Number(m.user_id) === Number(e.id)).map(m => Number(m.team_id)) })),
    teams,
    ratings: current.map(r => ({ ...r, level: Number(r.level) })),
    activity: activity.filter(a => engineerIds.has(Number(a.user_id))).map(a => ({ ...a, activities: Number(a.activities) })),
    coverage: coverage(technologies, current),
    activity_since: since,
    can_manage: canManage,
  });
});

// Rate one engineer on one technology; level null removes the rating.
router.put('/ratings/:userId/:technologyId', requirePermission('skills.manage'), async (req, res) => {
  const userId = positiveId(req.params.userId), technologyId = positiveId(req.params.technologyId);
  if (!userId || !technologyId) return res.status(400).json({ error: 'Invalid engineer or technology' });
  const { level, note } = req.body || {};
  if (level !== null && !LEVELS.some(l => l.value === level)) return res.status(400).json({ error: 'Level must be Junior, Intermediate, Senior or Expert' });
  if (note != null && (typeof note !== 'string' || note.length > 500)) return res.status(400).json({ error: 'Note must be at most 500 characters' });
  const [engineer, technology] = await Promise.all([
    db.prepare("SELECT id, name FROM users WHERE id = ? AND active = 1 AND role = 'engineer'").get(userId),
    db.prepare('SELECT id, name FROM technologies WHERE id = ?').get(technologyId),
  ]);
  if (!engineer) return res.status(404).json({ error: 'Engineer not found' });
  if (!technology) return res.status(404).json({ error: 'Technology not found' });
  const label = `${engineer.name} — ${technology.name}`;
  if (level === null) {
    await db.prepare('DELETE FROM engineer_skills WHERE user_id = ? AND technology_id = ?').run(userId, technologyId);
    await logAudit(db, req, 'engineer_skill', userId, label, 'deleted', 'Rating removed');
    return res.json({ ok: true });
  }
  await db.prepare(`INSERT INTO engineer_skills (user_id, technology_id, level, note, rated_by, rated_at) VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT (user_id, technology_id) DO UPDATE SET level = EXCLUDED.level, note = EXCLUDED.note, rated_by = EXCLUDED.rated_by, rated_at = EXCLUDED.rated_at`)
    .run(userId, technologyId, level, note?.trim() || null, req.user.id, new Date().toISOString());
  await logAudit(db, req, 'engineer_skill', userId, label, 'updated', `Rated ${LEVELS.find(l => l.value === level).label}`);
  res.json({ ok: true });
});

// How many Senior-or-better engineers a technology needs.
router.put('/technologies/:id/target', requirePermission('skills.manage'), async (req, res) => {
  const id = positiveId(req.params.id);
  const target = req.body?.target;
  if (!id) return res.status(400).json({ error: 'Invalid technology' });
  if (!Number.isInteger(target) || target < 1 || target > 20) return res.status(400).json({ error: 'Target must be a whole number from 1 to 20' });
  const technology = await db.prepare('SELECT name FROM technologies WHERE id = ?').get(id);
  if (!technology) return res.status(404).json({ error: 'Technology not found' });
  await db.prepare('UPDATE technologies SET skill_target = ? WHERE id = ?').run(target, id);
  await logAudit(db, req, 'technology', id, technology.name, 'updated', `Skilled engineers needed: ${target}`);
  res.json({ ok: true });
});

module.exports = router;
