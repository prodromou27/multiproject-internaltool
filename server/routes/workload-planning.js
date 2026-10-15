const router = require('express').Router();
const appTime = require('../appTime');
const db = require('../db');
const { requireManager } = require('../middleware/auth');
const { logAudit } = require('../auditLog');
const { validDate, planningWeeks, capacityForEngineer } = require('../workloadModel');
const { getPolicy } = require('../workloadPolicyStore');
const validVersion = value => Number.isSafeInteger(value) && value>=0;
const positiveId = value => Number.isSafeInteger(value) && value>0;
router.use(requireManager);

// The live plan for the four weeks from asOf (or { status, error }).
async function livePlan(asOf) {
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
  if (engineers.length>500 || tasks.length>5000 || visits.length>5000) return { status: 413, error: 'Planning dataset exceeds its limit. Narrow the outstanding assignments before using this view.' };
  return { as_of: asOf, weeks, policy_version: policy.version, engineers: engineers.map(engineer => capacityForEngineer(engineer,weeks,[...tasks,...visits],availability,policy)), coverage: 'Recorded remaining task and visit effort multiplied by configured status weights, then bucketed by due/scheduled date; overdue work goes in the first week. Visit estimates are per assigned engineer. Net weekly availability must account for leave, holidays and meetings. Reports, service follow-ups and undated/future work are excluded from capacity percentages.' };
}

router.get('/', async (req,res) => {
  const asOf = req.query.as_of ?? appTime.today();
  if (!validDate(asOf)) return res.status(400).json({ error: 'as_of must be a real YYYY-MM-DD date' });
  const plan = await livePlan(asOf);
  if (plan.error) return res.status(plan.status).json({ error: plan.error });
  res.json(plan);
});

/* What if (enhancement E05): the live plan with proposed leave and new work laid
   over it, worked out and returned, never saved. Leave lowers that week's
   available hours by its share of the week's working days; new work is spread
   evenly over the working days of its range. Availability that was never entered
   stays unknown (it is not treated as zero), and a week with no available hours
   is shown as such, not as a percentage. */
const calendar = require('../businessCalendar');
const workingDays = (from, to, cal) => {
  const days = [];
  for (let day = from; day <= to;) { if (calendar.isWorkingDay(day, cal)) days.push(day); const next = new Date(`${day}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1); day = next.toISOString().slice(0, 10); }
  return days;
};
function checkChange(change, engineerIds) {
  if (!change || !['leave', 'work'].includes(change.type)) return 'Each change is leave or new work';
  if (!engineerIds.has(change.user_id)) return 'Each change needs an active engineer';
  if (!validDate(change.from) || !validDate(change.to) || change.to < change.from) return 'Each change needs a from and to date, in order';
  if (change.type === 'work' && (typeof change.hours !== 'number' || !Number.isFinite(change.hours) || change.hours <= 0 || change.hours > 2000)) return 'New work needs hours (up to 2000)';
  if (change.technology_id != null && !positiveId(change.technology_id)) return 'Invalid technology';
  return null;
}
const percentOf = (estimated, available, unknown) => (available === null || unknown ? null : available > 0 ? Math.round(estimated / available * 1000) / 10 : null);
const stateOf = (available, unknown) => (available === null ? 'availability_unknown' : unknown ? 'estimates_missing' : available <= 0 ? 'no_hours' : 'known');

router.post('/scenario', async (req,res) => {
  const asOf = req.body?.as_of ?? appTime.today();
  if (!validDate(asOf)) return res.status(400).json({ error: 'as_of must be a real YYYY-MM-DD date' });
  const changes = req.body?.changes;
  if (!Array.isArray(changes) || !changes.length || changes.length > 50) return res.status(400).json({ error: 'Add 1 to 50 changes to try' });
  const plan = await livePlan(asOf);
  if (plan.error) return res.status(plan.status).json({ error: plan.error });
  const engineerIds = new Set(plan.engineers.map(e => e.id));
  for (const change of changes) { const problem = checkChange(change, engineerIds); if (problem) return res.status(400).json({ error: problem }); }
  const cal = await calendar.load();
  const techIds = [...new Set(changes.map(c => c.technology_id).filter(Boolean))];
  const skills = techIds.length ? await db.prepare(`SELECT user_id, technology_id, level FROM engineer_skills WHERE technology_id IN (${techIds.map(() => '?').join(',')})`).all(...techIds) : [];
  const outside = [];
  const engineers = plan.engineers.map(engineer => {
    const mine = changes.filter(c => c.user_id === engineer.id);
    const weeks = engineer.weeks.map(week => {
      const weekDays = workingDays(week.start, week.end, cal).length;
      let available = week.available_hours, extra = 0;
      for (const change of mine) {
        const from = change.from > week.start ? change.from : week.start, to = change.to < week.end ? change.to : week.end;
        const inWeek = from <= to ? workingDays(from, to, cal).length : 0;
        if (change.type === 'leave' && available !== null && weekDays) available = Math.max(0, Math.round(available * (1 - inWeek / weekDays) * 100) / 100);
        if (change.type === 'work') { const all = workingDays(change.from, change.to, cal).length; if (all) extra += change.hours * inWeek / all; }
      }
      const estimated = Math.round((week.estimated_hours + extra) * 100) / 100;
      return { start: week.start, end: week.end,
        live: { estimated_hours: week.estimated_hours, available_hours: week.available_hours, capacity_percent: percentOf(week.estimated_hours, week.available_hours, week.unknown_estimates), state: stateOf(week.available_hours, week.unknown_estimates) },
        scenario: { estimated_hours: estimated, available_hours: available, capacity_percent: percentOf(estimated, available, week.unknown_estimates), state: stateOf(available, week.unknown_estimates) } };
    });
    for (const change of mine) if (change.type === 'work' && change.to > plan.weeks.at(-1).end) outside.push(change.title || 'New work');
    const levels = Object.fromEntries(techIds.map(t => [t, Number(skills.find(s => Number(s.user_id) === engineer.id && Number(s.technology_id) === t)?.level) || null]));
    return { id: engineer.id, name: engineer.name, changed: mine.length > 0, skill_levels: levels, weeks };
  });
  res.json({ saved: false, as_of: asOf, weeks: plan.weeks, engineers, beyond_window: [...new Set(outside)],
    note: 'A scenario only. Nothing is saved; the live plan is unchanged until you record the leave or create the work.' });
});

router.put('/estimate', async (req,res) => {
  const body = req.body || {};
  if (!['task','visit'].includes(body.kind) || !positiveId(body.id) || !validVersion(body.version) || typeof body.remaining_hours !== 'number' || !Number.isFinite(body.remaining_hours) || body.remaining_hours<0 || body.remaining_hours>10000) return res.status(400).json({ error: 'Valid kind, ID, version and numeric remaining hours (0–10000) are required' });
  const table = body.kind==='task' ? 'tasks' : 'maintenance_visits';
  const column = body.kind==='task' ? 'task_id' : 'visit_id';
  if (!await db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(body.id)) return res.status(404).json({ error: 'Work item not found' });
  const sql = body.version===0
    ? `INSERT INTO workload_estimates (${column},remaining_hours,updated_by) VALUES (?,?,?) ON CONFLICT (${column}) DO NOTHING RETURNING *`
    : `UPDATE workload_estimates SET remaining_hours=?,updated_by=?,version=version+1,updated_at=app_now() WHERE ${column}=? AND version=? RETURNING *`;
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
    : `UPDATE workload_availability SET available_hours=?,updated_by=?,version=version+1,updated_at=app_now() WHERE user_id=? AND week_start=? AND version=? RETURNING *`;
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
