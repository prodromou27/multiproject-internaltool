const router = require('express').Router();
const db = require('../db');
const { requireManager } = require('../middleware/auth');
const { logAudit } = require('../auditLog');
const { validDate } = require('../workloadModel');
const { validatePolicy,pressureForEngineer } = require('../workloadPolicy');
const { getPolicy } = require('../workloadPolicyStore');
router.use(requireManager);
router.get('/policy',async (req,res) => {
  const row = await db.prepare("SELECT value FROM settings WHERE key='status_config'").get();
  let statuses = {};
  try { statuses=JSON.parse(row?.value || '{}') || {}; } catch { /* retain default states */ }
  res.json({ policy: await getPolicy(),statuses: { task: Array.isArray(statuses.task) ? statuses.task : [],visit: Array.isArray(statuses.visit) ? statuses.visit : [] } });
});
router.put('/policy',async (req,res) => {
  let policy;
  try { policy=validatePolicy(req.body); } catch (error) { return res.status(400).json({ error: error.message }); }
  const version=req.body.version;
  const row=version===0
    ? await db.prepare('INSERT INTO workload_policy (id,configuration,updated_by) VALUES (1,?,?) ON CONFLICT (id) DO NOTHING RETURNING version').get(JSON.stringify(policy),req.user.id)
    : await db.prepare("UPDATE workload_policy SET configuration=?,updated_by=?,updated_at=app_now(),version=version+1 WHERE id=1 AND version=? RETURNING version").get(JSON.stringify(policy),req.user.id,version);
  if (!row) return res.status(409).json({ error: 'Workload settings changed. Reload before saving.',code: 'WORKLOAD_POLICY_CONFLICT' });
  await logAudit(db,req,'workload_policy',1,'Workload weights','updated',`version=${row.version}`);
  res.json({ ...policy,version: row.version });
});
router.get('/',async (req,res) => {
  const asOf=req.query.as_of ?? new Date().toISOString().slice(0,10);
  if (!validDate(asOf)) return res.status(400).json({ error: 'as_of must be a real YYYY-MM-DD date' });
  const row=await db.prepare("SELECT value FROM settings WHERE key='status_config'").get();
  let statuses = {};
  try { statuses=JSON.parse(row?.value || '{}') || {}; } catch { /* retain default terminal states */ }
  const terminal=[...new Set(['completed','closed','cancelled',...(Array.isArray(statuses.task) ? statuses.task.filter(row => row?.is_terminal).map(row => row.value) : [])])];
  const visitTerminal=[...new Set(['completed','cancelled',...(Array.isArray(statuses.visit) ? statuses.visit.filter(row => row?.is_terminal).map(row => row.value) : [])])];
  const cancelled = [...new Set(['cancelled',...(Array.isArray(statuses.service_activity) ? statuses.service_activity.filter(row => /cancel/i.test(row?.value || '') || /cancel/i.test(row?.label || '')).map(row => row.value) : [])])];
  const [policy,engineers,tasks,visits,reports,followUps] = await Promise.all([
    getPolicy(),
    db.prepare("SELECT id,name FROM users WHERE role='engineer' AND active=1 ORDER BY name,id LIMIT 501").all(),
    db.prepare(`SELECT t.id,t.title,t.status,t.priority,t.deadline AS date,t.assigned_to AS user_id,'task' AS kind FROM tasks t JOIN users u ON u.id=t.assigned_to WHERE u.role='engineer' AND u.active=1 AND t.status NOT IN (${terminal.map(() => '?').join(',')}) ORDER BY t.id LIMIT 5001`).all(...terminal),
    db.prepare(`SELECT v.id,v.title,v.status,v.scheduled_date AS date,a.user_id,'visit' AS kind FROM maintenance_visits v JOIN maintenance_visit_engineers a ON a.visit_id=v.id JOIN users u ON u.id=a.user_id WHERE u.role='engineer' AND u.active=1 AND v.status NOT IN (${visitTerminal.map(() => '?').join(',')}) ORDER BY v.id,a.user_id LIMIT 5001`).all(...visitTerminal),
    db.prepare("SELECT v.id,v.title,v.status,v.scheduled_date AS date,a.user_id,'report' AS kind FROM maintenance_visits v JOIN maintenance_visit_engineers a ON a.visit_id=v.id JOIN users u ON u.id=a.user_id WHERE u.role='engineer' AND u.active=1 AND v.status IN ('in_progress','completed') AND v.report_sent=0 AND v.scheduled_date<=? ORDER BY v.id,a.user_id LIMIT 5001").all(asOf),
    db.prepare(`SELECT sa.id,sa.title,sa.status,sa.follow_up_date AS date,sa.engineer_id AS user_id,'follow_up' AS kind FROM service_activities sa JOIN users u ON u.id=sa.engineer_id WHERE u.role='engineer' AND u.active=1 AND sa.follow_up_required=1 AND sa.follow_up_task_id IS NULL AND sa.status NOT IN (${cancelled.map(() => '?').join(',')}) ORDER BY sa.id LIMIT 5001`).all(...cancelled),
  ]);
  if (engineers.length>500 || [tasks,visits,reports,followUps].some(rows => rows.length>5000)) return res.status(413).json({ error: 'Pressure dataset exceeds its assignment limit; totals have not been truncated.' });
  const grouped=new Map(engineers.map(engineer => [engineer.id,[]]));
  for (const item of [...tasks,...visits,...reports,...followUps]) grouped.get(item.user_id)?.push(item);
  res.json({ as_of: asOf,policy,engineers: engineers.map(engineer => pressureForEngineer(engineer,grouped.get(engineer.id),asOf,policy)).sort((a,b) => b.pressure_points-a.pressure_points || a.name.localeCompare(b.name) || a.id-b.id),coverage: 'Pressure points are an urgency signal, not hours, capacity or a performance rating. Covers assigned outstanding tasks, visits, pending internal visit reports and unlinked service follow-ups. Linked follow-ups count under their assigned task owner. Report dates use visit dates and are not SLA breach calculations. Forwarding reports, ongoing activities, unassigned work and project/recommendation risk are excluded. Due soon covers today and the next six dates.' });
});
module.exports = router;
