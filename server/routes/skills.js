const router = require('express').Router();
const db = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
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

/* ── Learning plans (E08): a gap becomes a mentor, a target and evidence steps ── */
const realDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const stepTitles = value => Array.isArray(value) && value.length <= 20 && value.every(t => typeof t === 'string' && t.trim() && t.trim().length <= 200) ? value.map(t => t.trim()) : null;

async function plansWhere(where, params) {
  const plans = await db.prepare(`SELECT p.*, u.name AS engineer_name, t.name AS technology_name, m.name AS mentor_name, s.level AS current_level
    FROM learning_plans p JOIN users u ON u.id = p.user_id JOIN technologies t ON t.id = p.technology_id
    LEFT JOIN users m ON m.id = p.mentor_id LEFT JOIN engineer_skills s ON s.user_id = p.user_id AND s.technology_id = p.technology_id
    WHERE ${where} ORDER BY CASE p.status WHEN 'active' THEN 0 ELSE 1 END, p.target_date, p.id`).all(...params);
  if (!plans.length) return [];
  const ids = plans.map(p => p.id), marks = ids.map(() => '?').join(',');
  const [steps, reviews] = await Promise.all([
    db.prepare(`SELECT id, plan_id, title, done_at FROM learning_plan_steps WHERE plan_id IN (${marks}) ORDER BY position, id`).all(...ids),
    db.prepare(`SELECT r.id, r.plan_id, r.note, r.reviewed_at, u.name AS reviewed_by_name FROM learning_plan_reviews r LEFT JOIN users u ON u.id = r.reviewed_by WHERE r.plan_id IN (${marks}) ORDER BY r.reviewed_at DESC, r.id DESC`).all(...ids),
  ]);
  const today = appTime.today();
  return plans.map(p => ({ ...p, current_level: p.current_level == null ? null : Number(p.current_level), overdue: p.status === 'active' && p.target_date < today,
    steps: steps.filter(s => s.plan_id === p.id), reviews: reviews.filter(r => r.plan_id === p.id) }));
}

// Everyone's plans (skill viewers), and who could mentor each technology (Senior or better).
router.get('/plans', requirePermission('skills.view'), async (req, res) => {
  const mentors = await db.prepare(`SELECT s.technology_id, u.id, u.name, s.level FROM engineer_skills s JOIN users u ON u.id = s.user_id
    WHERE u.active = 1 AND u.role = 'engineer' AND s.level >= 3 ORDER BY s.level DESC, u.name`).all();
  res.json({ plans: await plansWhere('1=1', []), mentors: mentors.map(m => ({ ...m, level: Number(m.level) })) });
});
// An engineer's own plans (and those they mentor), for My Work.
router.get('/plans/mine', requireAuth, async (req, res) => {
  res.json({ plans: await plansWhere("(p.user_id = ? OR p.mentor_id = ?) AND p.status = 'active'", [req.user.id, req.user.id]) });
});

async function planInput(body, { creating }) {
  const out = {};
  if (creating) {
    out.user_id = positiveId(body?.user_id); out.technology_id = positiveId(body?.technology_id);
    if (!out.user_id || !out.technology_id) return { error: 'Choose the engineer and the technology' };
    if (!await db.prepare("SELECT 1 FROM users WHERE id = ? AND active = 1 AND role = 'engineer'").get(out.user_id)) return { error: 'Engineer not found' };
    if (!await db.prepare('SELECT 1 FROM technologies WHERE id = ? AND active = 1').get(out.technology_id)) return { error: 'Technology not found' };
  }
  if (creating || body?.target_level !== undefined) {
    if (!LEVELS.some(l => l.value === body?.target_level)) return { error: 'Target level must be Junior, Intermediate, Senior or Expert' };
    out.target_level = body.target_level;
  }
  if (creating || body?.target_date !== undefined) {
    if (!realDay(body?.target_date)) return { error: 'Target date must be a date (YYYY-MM-DD)' };
    out.target_date = body.target_date;
  }
  if (body?.mentor_id !== undefined) {
    out.mentor_id = body.mentor_id === null ? null : positiveId(body.mentor_id);
    if (body.mentor_id !== null && !out.mentor_id) return { error: 'Invalid mentor' };
    if (out.mentor_id && !await db.prepare("SELECT 1 FROM users WHERE id = ? AND active = 1 AND role IN ('engineer','manager')").get(out.mentor_id)) return { error: 'The mentor must be an active engineer or manager' };
  }
  return { value: out };
}

router.post('/plans', requirePermission('skills.manage'), async (req, res) => {
  const checked = await planInput(req.body, { creating: true });
  if (checked.error) return res.status(400).json({ error: checked.error });
  const p = checked.value;
  if (p.mentor_id === p.user_id) return res.status(400).json({ error: 'Someone cannot mentor themselves' });
  const steps = req.body.steps === undefined ? [] : stepTitles(req.body.steps);
  if (!steps) return res.status(400).json({ error: 'Up to 20 steps of up to 200 characters' });
  if (await db.prepare("SELECT 1 FROM learning_plans WHERE user_id = ? AND technology_id = ? AND status = 'active'").get(p.user_id, p.technology_id))
    return res.status(409).json({ error: 'This engineer already has an active plan for this technology' });
  const id = await db.transaction(async tx => {
    const created = await tx.prepare('INSERT INTO learning_plans (user_id, technology_id, target_level, target_date, mentor_id, created_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
      .get(p.user_id, p.technology_id, p.target_level, p.target_date, p.mentor_id ?? null, req.user.id);
    for (const [index, title] of steps.entries()) await tx.prepare('INSERT INTO learning_plan_steps (plan_id, title, position) VALUES (?, ?, ?)').run(created.id, title, index);
    return created.id;
  });
  const [plan] = await plansWhere('p.id = ?', [id]);
  await logAudit(db, req, 'learning_plan', id, `${plan.engineer_name} — ${plan.technology_name}`, 'created', `Target ${LEVELS.find(l => l.value === p.target_level).label} by ${p.target_date}`);
  const { notifyUser } = require('../notifications');
  for (const [userId, title] of [[p.user_id, `A learning plan for ${plan.technology_name} was set up with you`], [p.mentor_id, `You are mentoring ${plan.engineer_name} on ${plan.technology_name}`]])
    if (userId && userId !== req.user.id) notifyUser(userId, 'learning_plan', { title, body: `Target: ${LEVELS.find(l => l.value === p.target_level).label} by ${p.target_date}.` }, { title, body: 'See My Work', link: '/my-day' }, { channels: false });
  res.status(201).json(plan);
});

async function loadPlan(req, res) {
  const id = positiveId(req.params.id);
  const plan = id && await db.prepare('SELECT * FROM learning_plans WHERE id = ?').get(id);
  if (!plan) { res.status(404).json({ error: 'Learning plan not found' }); return null; }
  return plan;
}

router.put('/plans/:id', requirePermission('skills.manage'), async (req, res) => {
  const plan = await loadPlan(req, res);
  if (!plan) return;
  const checked = await planInput(req.body, { creating: false });
  if (checked.error) return res.status(400).json({ error: checked.error });
  const changes = { ...checked.value };
  if (changes.mentor_id && changes.mentor_id === plan.user_id) return res.status(400).json({ error: 'Someone cannot mentor themselves' });
  if (req.body.status !== undefined) {
    if (!['active', 'completed', 'cancelled'].includes(req.body.status)) return res.status(400).json({ error: 'Status must be active, completed or cancelled' });
    changes.status = req.body.status;
    changes.closed_at = req.body.status === 'active' ? null : new Date().toISOString();
  }
  const keys = Object.keys(changes);
  if (!keys.length) return res.status(400).json({ error: 'Nothing to change' });
  await db.prepare(`UPDATE learning_plans SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map(k => changes[k]), plan.id);
  await logAudit(db, req, 'learning_plan', plan.id, null, changes.status && changes.status !== plan.status ? `plan_${changes.status}` : 'updated', keys.join(', '));
  res.json((await plansWhere('p.id = ?', [plan.id]))[0]);
});

// The engineer (or anyone who manages skills) ticks a step off.
router.put('/plans/:id/steps/:stepId', requireAuth, async (req, res) => {
  const plan = await loadPlan(req, res);
  if (!plan) return;
  const own = Number(plan.user_id) === Number(req.user.id);
  if (!own && !await hasPermission(req.user, 'skills.manage')) return res.status(403).json({ error: 'Only the engineer or a skills manager can change the steps' });
  if (typeof req.body?.done !== 'boolean') return res.status(400).json({ error: 'done must be true or false' });
  const changed = await db.prepare('UPDATE learning_plan_steps SET done_at = ?, done_by = ? WHERE id = ? AND plan_id = ?')
    .run(req.body.done ? new Date().toISOString() : null, req.body.done ? req.user.id : null, positiveId(req.params.stepId), plan.id);
  if (!changed.changes) return res.status(404).json({ error: 'Step not found' });
  res.json((await plansWhere('p.id = ?', [plan.id]))[0]);
});

router.post('/plans/:id/reviews', requirePermission('skills.manage'), async (req, res) => {
  const plan = await loadPlan(req, res);
  if (!plan) return;
  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
  if (!note || note.length > 1000) return res.status(400).json({ error: 'A review note of up to 1000 characters' });
  await db.prepare('INSERT INTO learning_plan_reviews (plan_id, note, reviewed_by) VALUES (?, ?, ?)').run(plan.id, note, req.user.id);
  await logAudit(db, req, 'learning_plan', plan.id, null, 'reviewed', null);
  res.status(201).json((await plansWhere('p.id = ?', [plan.id]))[0]);
});

module.exports = router;
