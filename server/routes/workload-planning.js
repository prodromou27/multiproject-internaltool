const router = require('express').Router();
const db = require('../db');
const { requireManager } = require('../middleware/auth');
const { logAudit } = require('../auditLog');
const { validDate, planningWeeks, capacityForEngineer } = require('../workloadModel');
const { getPolicy } = require('../workloadPolicyStore');
const validVersion = value => Number.isSafeInteger(value) && value>=0;
const positiveId = value => Number.isSafeInteger(value) && value>0;
router.use(requireManager);

router.get('/', async (req,res) => {
  const asOf = req.query.as_of ?? new Date().toISOString().slice(0,10);
  if (!validDate(asOf)) return res.status(400).json({ error: 'as_of must be a real YYYY-MM-DD date' });
  const weeks = planningWeeks(asOf);
  const setting = await db.prepare("SELECT value FROM settings WHERE key='status_config'").get();
  let config;
  try { config = JSON.parse(setting?.value || '{}') || {}; } catch { config = {}; }
  const policy = await getPolicy();
  const terminal = [...new Set(['completed','closed','cancelled',...(Array.isArray(config.task) ? config.task.filter(row => row?.is_terminal).map(row => row.value) : [])])];
  const visitTerminal = [...new Set(['completed','cancelled',...(Array.isArray(config.visit) ? config.visit.filter(row => row?.is_terminal).map(row => row.value) : [])])];
  const [engineers,tasks,visits,availability] = await Promise.all([
    db.prepare("SELECT id,name FROM users WHERE role='engineer' AND active=1 ORDER BY name,id LIMIT 501").all(),
    db.prepare(`SELECT t.id,t.title,t.status,t.deadline AS date,t.assigned_to AS user_id,'task' AS kind,we.remaining_hours,COALESCE(we.version,0) AS estimate_version FROM tasks t JOIN users u ON u.id=t.assigned_to LEFT JOIN workload_estimates we ON we.task_id=t.id WHERE u.role='engineer' AND u.active=1 AND t.status NOT IN (${terminal.map(() => '?').join(',')}) ORDER BY t.deadline ASC NULLS LAST,t.id ASC LIMIT 5001`).all(...terminal),
    db.prepare(`SELECT mv.id,mv.title,mv.status,mv.scheduled_date AS date,mve.user_id,'visit' AS kind,we.remaining_hours,COALESCE(we.version,0) AS estimate_version FROM maintenance_visits mv JOIN maintenance_visit_engineers mve ON mve.visit_id=mv.id JOIN users u ON u.id=mve.user_id LEFT JOIN workload_estimates we ON we.visit_id=mv.id WHERE u.role='engineer' AND u.active=1 AND mv.status NOT IN (${visitTerminal.map(() => '?').join(',')}) ORDER BY mv.scheduled_date,mv.id LIMIT 5001`).all(...visitTerminal),
    db.prepare('SELECT user_id,week_start,available_hours,version FROM workload_availability WHERE week_start>=? AND week_start<=?').all(weeks[0].start,weeks.at(-1).start),
  ]);
  if (engineers.length>500 || tasks.length>5000 || visits.length>5000) return res.status(413).json({ error: 'Planning dataset exceeds its limit. Narrow the outstanding assignments before using this view.' });
  res.json({ as_of: asOf, weeks, policy_version: policy.version, engineers: engineers.map(engineer => capacityForEngineer(engineer,weeks,[...tasks,...visits],availability,policy)), coverage: 'Recorded remaining task and visit effort multiplied by configured status weights, then bucketed by due/scheduled date; overdue work goes in the first week. Visit estimates are per assigned engineer. Net weekly availability must account for leave, holidays and meetings. Reports, service follow-ups and undated/future work are excluded from capacity percentages.' });
});

router.put('/estimate', async (req,res) => {
  const body = req.body || {};
  if (!['task','visit'].includes(body.kind) || !positiveId(body.id) || !validVersion(body.version) || typeof body.remaining_hours !== 'number' || !Number.isFinite(body.remaining_hours) || body.remaining_hours<0 || body.remaining_hours>10000) return res.status(400).json({ error: 'Valid kind, ID, version and numeric remaining hours (0–10000) are required' });
  const table = body.kind==='task' ? 'tasks' : 'maintenance_visits';
  const column = body.kind==='task' ? 'task_id' : 'visit_id';
  if (!await db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(body.id)) return res.status(404).json({ error: 'Work item not found' });
  const sql = body.version===0
    ? `INSERT INTO workload_estimates (${column},remaining_hours,updated_by) VALUES (?,?,?) ON CONFLICT (${column}) DO NOTHING RETURNING *`
    : `UPDATE workload_estimates SET remaining_hours=?,updated_by=?,version=version+1,updated_at=datetime('now') WHERE ${column}=? AND version=? RETURNING *`;
  const params = body.version===0 ? [body.id,body.remaining_hours,req.user.id] : [body.remaining_hours,req.user.id,body.id,body.version];
  const row = (await db.prepare(sql).all(...params))[0];
  if (!row) return res.status(409).json({ error: 'Estimate changed. Refresh before saving.', code: 'WORKLOAD_CONFLICT' });
  await logAudit(db,req,'workload_estimate',row.id,'Work estimate','updated',`${body.kind}_id=${body.id}; hours=${body.remaining_hours}`);
  res.json(row);
});

router.put('/availability', async (req,res) => {
  const body = req.body || {};
  if (!positiveId(body.user_id) || !validVersion(body.version) || !validDate(body.week_start) || new Date(`${body.week_start}T00:00:00Z`).getUTCDay()!==1 || typeof body.available_hours !== 'number' || !Number.isFinite(body.available_hours) || body.available_hours<0 || body.available_hours>168) return res.status(400).json({ error: 'Valid engineer, Monday week start, version and numeric net available hours (0–168) are required' });
  if (!await db.prepare("SELECT id FROM users WHERE id=? AND role='engineer' AND active=1").get(body.user_id)) return res.status(400).json({ error: 'Availability requires an active engineer' });
  const sql = body.version===0
    ? 'INSERT INTO workload_availability (user_id,week_start,available_hours,updated_by) VALUES (?,?,?,?) ON CONFLICT (user_id,week_start) DO NOTHING RETURNING *'
    : `UPDATE workload_availability SET available_hours=?,updated_by=?,version=version+1,updated_at=datetime('now') WHERE user_id=? AND week_start=? AND version=? RETURNING *`;
  const params = body.version===0 ? [body.user_id,body.week_start,body.available_hours,req.user.id] : [body.available_hours,req.user.id,body.user_id,body.week_start,body.version];
  const row = (await db.prepare(sql).all(...params))[0];
  if (!row) return res.status(409).json({ error: 'Availability changed. Refresh before saving.', code: 'WORKLOAD_CONFLICT' });
  await logAudit(db,req,'workload_availability',row.id,'Engineer availability','updated',`user_id=${body.user_id}; week=${body.week_start}; hours=${body.available_hours}`);
  res.json(row);
});

router.use((error,req,res,next) => {
  if (error.code === '23503') return res.status(409).json({ error: 'The linked work item or engineer changed. Refresh before saving.' });
  next(error);
});
module.exports = router;
