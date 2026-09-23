const router = require('express').Router({ mergeParams: true });
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../auditLog');
const { positiveId,canAccessCustomer }=require('../customerAccess');
const { STATUSES,AUTHOR_ROLES,capabilitiesFor,canEdit,validateRecommendation,validateTaskConversion }=require('../services/customerRecommendations');
router.use(requireAuth, async (req, res, next) => {
  if (['POST','PUT'].includes(req.method) && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) return res.status(400).json({ error: 'A JSON object is required' });
  if (!positiveId(req.params.id)) return res.status(400).json({ error: 'Invalid customer ID' });
  const customer=Number(req.params.id);
  if (!await db.prepare('SELECT id FROM customers WHERE id=?').get(customer)) return res.status(404).json({ error: 'Customer not found' });
  if (!await canAccessCustomer(req.user,customer)) return res.status(403).json({ error:'You do not have access to recommendations for this customer' });
  next();
});

router.get('/', async (req, res) => {
  const rawPage = req.query.page ?? '1';
  if (typeof rawPage !== 'string' || !positiveId(rawPage) || !Number.isSafeInteger((Number(rawPage) - 1) * 25)) return res.status(400).json({ error: 'Invalid page' });
  if (req.query.status !== undefined && (typeof req.query.status !== 'string' || !STATUSES.has(req.query.status))) return res.status(400).json({ error: 'Invalid status filter' });
  const page = Number(rawPage), customer = Number(req.params.id);
  const where = `r.customer_id=?${req.query.status ? ' AND r.status=?' : ''}`;
  const params = [customer, ...(req.query.status ? [req.query.status] : [])];
  const [rows, count, visits, owners,projects,summary] = await Promise.all([
    db.prepare(`SELECT r.*,u.name AS owner_name,mv.title AS source_visit_title,t.title AS related_task_title,t.project_id AS related_task_project_id FROM customer_recommendations r LEFT JOIN users u ON u.id=r.owner_id LEFT JOIN maintenance_visits mv ON mv.id=r.source_visit_id LEFT JOIN tasks t ON t.id=r.related_task_id WHERE ${where} ORDER BY r.created_at DESC,r.id DESC LIMIT ? OFFSET ?`).all(...params,25,(page - 1) * 25),
    db.prepare(`SELECT COUNT(*) AS total FROM customer_recommendations r WHERE ${where}`).get(...params),
    req.user.role==='engineer' ? db.prepare('SELECT mv.id,mv.title,mv.scheduled_date FROM maintenance_visits mv JOIN maintenance_visit_engineers mve ON mve.visit_id=mv.id WHERE mv.customer_id=? AND mve.user_id=? ORDER BY mv.scheduled_date DESC,mv.id DESC LIMIT 50').all(customer,req.user.id) : db.prepare('SELECT id,title,scheduled_date FROM maintenance_visits WHERE customer_id=? ORDER BY scheduled_date DESC,id DESC LIMIT 50').all(customer),
    req.user.role==='engineer' ? db.prepare('SELECT id,name,role FROM users WHERE id=?').all(req.user.id) : db.prepare("SELECT id,name,role FROM users WHERE active=1 AND role IN ('manager','engineer') ORDER BY name,id LIMIT 500").all(),
    req.user.role==='engineer' ? db.prepare('SELECT p.id,p.title FROM projects p JOIN project_assignments pa ON pa.project_id=p.id WHERE p.customer_id=? AND pa.user_id=? ORDER BY p.title,p.id LIMIT 500').all(customer,req.user.id) : db.prepare('SELECT id,title FROM projects WHERE customer_id=? ORDER BY title,id LIMIT 500').all(customer),
    db.prepare(`SELECT
      SUM(CASE WHEN status NOT IN ('implemented','rejected','closed','converted_to_project') THEN 1 ELSE 0 END) AS open,
      SUM(CASE WHEN status NOT IN ('implemented','rejected','closed','converted_to_project') AND risk_level IN ('high','critical') THEN 1 ELSE 0 END) AS high_risk,
      SUM(CASE WHEN status='in_progress' THEN 1 ELSE 0 END) AS in_progress,
      SUM(CASE WHEN status='implemented' THEN 1 ELSE 0 END) AS implemented
      FROM customer_recommendations WHERE customer_id=?`).get(customer),
  ]);
  res.json({ rows:rows.map(row => ({ ...row,can_edit:canEdit(req.user,row) })), total: Number(count.total), page, page_size: 25, visits, owners,projects,summary:Object.fromEntries(Object.entries(summary).map(([key,value]) => [key,Number(value || 0)])),capabilities:capabilitiesFor(req.user.role) });
});

async function references(value, customer, tx, existing = {},user) {
  if (value.owner_id && value.owner_id !== existing.owner_id && !await tx.prepare("SELECT id FROM users WHERE id=? AND active=1 AND role IN ('manager','engineer')").get(value.owner_id)) return 'Owner must be an active manager or engineer';
  if (value.source_visit_id && !await tx.prepare('SELECT id FROM maintenance_visits WHERE id=? AND customer_id=?').get(value.source_visit_id,customer)) return 'Source visit must belong to this customer';
  if (user?.role==='engineer' && value.source_visit_id && !await tx.prepare('SELECT 1 FROM maintenance_visit_engineers WHERE visit_id=? AND user_id=?').get(value.source_visit_id,user.id)) return 'Engineers may only use an assigned source visit';
}
async function history(tx, req, row, action) {
  await tx.prepare('INSERT INTO recommendation_history (recommendation_id,user_id,action,status,version) VALUES (?,?,?,?,?)').run(row.id,req.user.id,action,row.status,row.version);
  await logAudit(tx,req,'recommendation',row.id,'Customer recommendation',action,`customer_id=${row.customer_id}; version=${row.version}`);
}
const conflict = res => res.status(409).json({ error: 'This recommendation changed. Reload before saving.', code: 'RECOMMENDATION_CONFLICT' });

router.post('/', async (req, res) => {
  if (!AUTHOR_ROLES.has(req.user.role)) return res.status(403).json({ error:'This role cannot record recommendations' });
  const body=req.user.role==='engineer' ? { ...req.body,owner_id:req.user.id } : req.body;
  const input = validateRecommendation(body);
  if (input.error) return res.status(400).json({ error: input.error });
  const value = input.value, customer = Number(req.params.id);
  const result = await db.transaction(async tx => {
    const error = await references(value,customer,tx,{},req.user);
    if (error) return { error };
    const row = (await tx.prepare('INSERT INTO customer_recommendations (customer_id,finding,recommendation,risk_level,owner_id,source_visit_id,due_date,status,follow_up_notes,created_by) VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING *').all(customer,value.finding,value.recommendation,value.risk_level,value.owner_id,value.source_visit_id,value.due_date,value.status,value.follow_up_notes,req.user.id))[0];
    await history(tx,req,row,'created');
    return { row };
  });
  if (result.error) return res.status(400).json({ error: result.error });
  res.status(201).json(result.row);
});

router.put('/:recommendationId', async (req, res) => {
  if (!positiveId(req.params.recommendationId) || !positiveId(req.body.version)) return res.status(400).json({ error: 'Valid recommendation ID and version are required' });
  const customer = Number(req.params.id), id = Number(req.params.recommendationId);
  const existing = await db.prepare('SELECT * FROM customer_recommendations WHERE id=? AND customer_id=?').get(id,customer);
  if (!existing) return res.status(404).json({ error: 'Recommendation not found' });
  if (!canEdit(req.user,existing)) return res.status(403).json({ error:'Only management or the recommendation author can edit it' });
  const body=req.user.role==='engineer' ? { ...req.body,owner_id:req.user.id } : req.body;
  const input = validateRecommendation(body,existing);
  if (input.error) return res.status(400).json({ error: input.error });
  const value = input.value;
  const result = await db.transaction(async tx => {
    const error = await references(value,customer,tx,existing,req.user);
    if (error) return { error };
    const row = (await tx.prepare(`UPDATE customer_recommendations SET finding=?,recommendation=?,risk_level=?,owner_id=?,source_visit_id=?,due_date=?,status=?,follow_up_notes=?,version=version+1,updated_at=app_now() WHERE id=? AND customer_id=? AND version=? RETURNING *`).all(value.finding,value.recommendation,value.risk_level,value.owner_id,value.source_visit_id,value.due_date,value.status,value.follow_up_notes,id,customer,Number(req.body.version)))[0];
    if (row) await history(tx,req,row,'updated');
    return { row };
  });
  if (result.error) return res.status(400).json({ error: result.error });
  if (!result.row) return conflict(res);
  res.json(result.row);
});

router.post('/:recommendationId/convert-to-project', async (req, res) => {
  if (req.user.role!=='manager') return res.status(403).json({ error:'Only management can convert recommendations to projects' });
  if (!positiveId(req.params.recommendationId) || !positiveId(req.body.version)) return res.status(400).json({ error: 'Valid recommendation ID and version are required' });
  if (typeof req.body.title !== 'string' || !req.body.title.trim() || req.body.title.trim().length > 300) return res.status(400).json({ error: 'Project title must contain 1 to 300 characters' });
  const customer = Number(req.params.id), id = Number(req.params.recommendationId);
  const result = await db.transaction(async tx => {
    const row = (await tx.prepare(`UPDATE customer_recommendations SET version=version+1 WHERE id=? AND customer_id=? AND version=? AND related_project_id IS NULL RETURNING *`).all(id,customer,Number(req.body.version)))[0];
    if (!row) return null;
    const project = await tx.prepare('INSERT INTO projects (title,description,customer_id,deadline,created_by) VALUES (?,?,?,?,?)').run(req.body.title.trim(),`${row.finding}\n\nRecommendation: ${row.recommendation}`,customer,row.due_date,req.user.id);
    if (row.owner_id && await tx.prepare("SELECT id FROM users WHERE id=? AND active=1 AND role='engineer'").get(row.owner_id)) await tx.prepare('INSERT INTO project_assignments (project_id,user_id) VALUES (?,?)').run(project.lastInsertRowid,row.owner_id);
    const converted = (await tx.prepare("UPDATE customer_recommendations SET related_project_id=?,status='converted_to_project',updated_at=app_now() WHERE id=? RETURNING *").all(project.lastInsertRowid,id))[0];
    await history(tx,req,converted,'converted_to_project');
    await tx.prepare('INSERT INTO project_activity (project_id,user_id,action,detail) VALUES (?,?,?,?)').run(project.lastInsertRowid,req.user.id,'created',`Converted from customer recommendation ${id}`);
    return converted;
  });
  if (!result) return conflict(res);
  res.status(201).json(result);
});

router.post('/:recommendationId/convert-to-task',async (req,res) => {
  if (!AUTHOR_ROLES.has(req.user.role)) return res.status(403).json({ error:'This role cannot convert recommendations to tasks' });
  const body=req.body || {};
  const input=validateTaskConversion(body,req.params.recommendationId);
  if (input.error) return res.status(400).json({ error:input.error });
  const value=input.value,customer=Number(req.params.id),id=value.recommendation_id,project=await db.prepare('SELECT id FROM projects WHERE id=? AND customer_id=?').get(value.project_id,customer);
  if (!project) return res.status(400).json({ error:'Project must belong to this customer' });
  const assignee=await db.prepare("SELECT id FROM users WHERE id=? AND active=1 AND role='engineer'").get(value.assigned_to);
  if (!assignee || (req.user.role==='engineer' && value.assigned_to!==req.user.id)) return res.status(400).json({ error:'Assignee must be an eligible active engineer' });
  if (req.user.role==='engineer' && !await db.prepare('SELECT 1 FROM project_assignments WHERE project_id=? AND user_id=?').get(project.id,req.user.id)) return res.status(403).json({ error:'Engineers can only create tasks in assigned projects' });
  const existing=await db.prepare('SELECT * FROM customer_recommendations WHERE id=? AND customer_id=?').get(id,customer);
  if (!existing) return res.status(404).json({ error:'Recommendation not found' });
  if (!canEdit(req.user,existing)) return res.status(403).json({ error:'Only management or the recommendation author can convert it' });
  const result=await db.transaction(async tx => {
    const row=(await tx.prepare('UPDATE customer_recommendations SET version=version+1 WHERE id=? AND customer_id=? AND version=? AND related_project_id IS NULL AND related_task_id IS NULL RETURNING *').all(id,customer,value.version))[0];
    if (!row) return null;
    const task=await tx.prepare("INSERT INTO tasks (project_id,title,description,status,priority,assigned_to,deadline,is_adhoc,created_by) VALUES (?,?,?,'open',?,?,?,0,?)").run(project.id,value.title,`${row.finding}\n\nRecommendation: ${row.recommendation}`,value.priority,value.assigned_to,value.deadline || row.due_date || null,req.user.id);
    const converted=(await tx.prepare("UPDATE customer_recommendations SET related_task_id=?,status='implemented',updated_at=app_now() WHERE id=? RETURNING *").all(task.lastInsertRowid,id))[0];
    await history(tx,req,converted,'converted_to_task');
    await tx.prepare('INSERT INTO project_activity (project_id,user_id,action,detail) VALUES (?,?,?,?)').run(project.id,req.user.id,'task_created',`Task ${task.lastInsertRowid} converted from recommendation ${id}`);
    return { recommendation:converted,task_id:task.lastInsertRowid };
  });
  if (!result) return conflict(res);
  res.status(201).json(result);
});

router.use((error, req, res, next) => {
  if (error.code === '23503') return res.status(409).json({ error: 'A linked customer, source visit, project or owner changed. Reload before saving.' });
  next(error);
});

module.exports = router;
