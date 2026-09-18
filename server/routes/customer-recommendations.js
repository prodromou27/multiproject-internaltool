const router = require('express').Router({ mergeParams: true });
const db = require('../db');
const { requireManager } = require('../middleware/auth');
const { logAudit } = require('../auditLog');
const STATUSES = new Set(['open','accepted','rejected','in_progress','implemented','deferred','converted_to_project','closed']);
const positiveId = value => (typeof value === 'number' || typeof value === 'string') && /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value));

router.use(requireManager, async (req, res, next) => {
  if (['POST','PUT'].includes(req.method) && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) return res.status(400).json({ error: 'A JSON object is required' });
  if (!positiveId(req.params.id)) return res.status(400).json({ error: 'Invalid customer ID' });
  if (!await db.prepare('SELECT id FROM customers WHERE id=?').get(Number(req.params.id))) return res.status(404).json({ error: 'Customer not found' });
  next();
});

router.get('/', async (req, res) => {
  const rawPage = req.query.page ?? '1';
  if (typeof rawPage !== 'string' || !positiveId(rawPage) || !Number.isSafeInteger((Number(rawPage) - 1) * 25)) return res.status(400).json({ error: 'Invalid page' });
  if (req.query.status !== undefined && (typeof req.query.status !== 'string' || !STATUSES.has(req.query.status))) return res.status(400).json({ error: 'Invalid status filter' });
  const page = Number(rawPage), customer = Number(req.params.id);
  const where = `r.customer_id=?${req.query.status ? ' AND r.status=?' : ''}`;
  const params = [customer, ...(req.query.status ? [req.query.status] : [])];
  const [rows, count, visits, owners] = await Promise.all([
    db.prepare(`SELECT r.*,u.name AS owner_name,mv.title AS source_visit_title FROM customer_recommendations r LEFT JOIN users u ON u.id=r.owner_id LEFT JOIN maintenance_visits mv ON mv.id=r.source_visit_id WHERE ${where} ORDER BY r.created_at DESC,r.id DESC LIMIT ? OFFSET ?`).all(...params,25,(page - 1) * 25),
    db.prepare(`SELECT COUNT(*) AS total FROM customer_recommendations r WHERE ${where}`).get(...params),
    db.prepare('SELECT id,title,scheduled_date FROM maintenance_visits WHERE customer_id=? ORDER BY scheduled_date DESC,id DESC LIMIT 50').all(customer),
    db.prepare("SELECT id,name FROM users WHERE active=1 AND role IN ('manager','engineer') ORDER BY name,id LIMIT 500").all(),
  ]);
  res.json({ rows, total: Number(count.total), page, page_size: 25, visits, owners });
});

function validate(body, existing = {}) {
  const value = { ...existing, ...body };
  for (const key of ['finding','recommendation']) if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > 10000) return { error: `${key} must contain 1 to 10000 characters` };
  if (value.follow_up_notes != null && (typeof value.follow_up_notes !== 'string' || value.follow_up_notes.length > 10000)) return { error: 'Follow-up notes must be text of at most 10000 characters' };
  if (!['low','medium','high','critical'].includes(value.risk_level ?? 'medium')) return { error: 'Invalid risk level' };
  if (!STATUSES.has(value.status ?? 'open')) return { error: 'Invalid status' };
  if (value.status === 'converted_to_project' && !existing.related_project_id) return { error: 'Use Convert to project to record a conversion' };
  for (const key of ['owner_id','source_visit_id']) if (value[key] != null && value[key] !== '' && !positiveId(value[key])) return { error: `Invalid ${key}` };
  if (value.due_date != null && value.due_date !== '' && (typeof value.due_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.due_date) || Number(value.due_date.slice(0,4)) < 1900 || Number(value.due_date.slice(0,4)) > 9998 || Number.isNaN(Date.parse(value.due_date)) || new Date(value.due_date).toISOString().slice(0,10) !== value.due_date)) return { error: 'Invalid due date' };
  return { value: { finding: value.finding.trim(), recommendation: value.recommendation.trim(), risk_level: value.risk_level ?? 'medium', owner_id: value.owner_id ? Number(value.owner_id) : null, source_visit_id: value.source_visit_id ? Number(value.source_visit_id) : null, due_date: value.due_date || null, status: value.status ?? 'open', follow_up_notes: value.follow_up_notes || null } };
}

async function references(value, customer, tx, existing = {}) {
  if (value.owner_id && value.owner_id !== existing.owner_id && !await tx.prepare("SELECT id FROM users WHERE id=? AND active=1 AND role IN ('manager','engineer')").get(value.owner_id)) return 'Owner must be an active manager or engineer';
  if (value.source_visit_id && !await tx.prepare('SELECT id FROM maintenance_visits WHERE id=? AND customer_id=?').get(value.source_visit_id,customer)) return 'Source visit must belong to this customer';
}
async function history(tx, req, row, action) {
  await tx.prepare('INSERT INTO recommendation_history (recommendation_id,user_id,action,status,version) VALUES (?,?,?,?,?)').run(row.id,req.user.id,action,row.status,row.version);
  await logAudit(tx,req,'recommendation',row.id,'Customer recommendation',action,`customer_id=${row.customer_id}; version=${row.version}`);
}
const conflict = res => res.status(409).json({ error: 'This recommendation changed. Reload before saving.', code: 'RECOMMENDATION_CONFLICT' });

router.post('/', async (req, res) => {
  const input = validate(req.body);
  if (input.error) return res.status(400).json({ error: input.error });
  const value = input.value, customer = Number(req.params.id);
  const result = await db.transaction(async tx => {
    const error = await references(value,customer,tx);
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
  const input = validate(req.body,existing);
  if (input.error) return res.status(400).json({ error: input.error });
  const value = input.value;
  const result = await db.transaction(async tx => {
    const error = await references(value,customer,tx,existing);
    if (error) return { error };
    const row = (await tx.prepare(`UPDATE customer_recommendations SET finding=?,recommendation=?,risk_level=?,owner_id=?,source_visit_id=?,due_date=?,status=?,follow_up_notes=?,version=version+1,updated_at=datetime('now') WHERE id=? AND customer_id=? AND version=? RETURNING *`).all(value.finding,value.recommendation,value.risk_level,value.owner_id,value.source_visit_id,value.due_date,value.status,value.follow_up_notes,id,customer,Number(req.body.version)))[0];
    if (row) await history(tx,req,row,'updated');
    return { row };
  });
  if (result.error) return res.status(400).json({ error: result.error });
  if (!result.row) return conflict(res);
  res.json(result.row);
});

router.post('/:recommendationId/convert-to-project', async (req, res) => {
  if (!positiveId(req.params.recommendationId) || !positiveId(req.body.version)) return res.status(400).json({ error: 'Valid recommendation ID and version are required' });
  if (typeof req.body.title !== 'string' || !req.body.title.trim() || req.body.title.trim().length > 300) return res.status(400).json({ error: 'Project title must contain 1 to 300 characters' });
  const customer = Number(req.params.id), id = Number(req.params.recommendationId);
  const result = await db.transaction(async tx => {
    const row = (await tx.prepare(`UPDATE customer_recommendations SET version=version+1 WHERE id=? AND customer_id=? AND version=? AND related_project_id IS NULL RETURNING *`).all(id,customer,Number(req.body.version)))[0];
    if (!row) return null;
    const project = await tx.prepare('INSERT INTO projects (title,description,customer_id,deadline,created_by) VALUES (?,?,?,?,?)').run(req.body.title.trim(),`${row.finding}\n\nRecommendation: ${row.recommendation}`,customer,row.due_date,req.user.id);
    if (row.owner_id && await tx.prepare("SELECT id FROM users WHERE id=? AND active=1 AND role='engineer'").get(row.owner_id)) await tx.prepare('INSERT INTO project_assignments (project_id,user_id) VALUES (?,?)').run(project.lastInsertRowid,row.owner_id);
    const converted = (await tx.prepare("UPDATE customer_recommendations SET related_project_id=?,status='converted_to_project',updated_at=datetime('now') WHERE id=? RETURNING *").all(project.lastInsertRowid,id))[0];
    await history(tx,req,converted,'converted_to_project');
    await tx.prepare('INSERT INTO project_activity (project_id,user_id,action,detail) VALUES (?,?,?,?)').run(project.lastInsertRowid,req.user.id,'created',`Converted from customer recommendation ${id}`);
    return converted;
  });
  if (!result) return conflict(res);
  res.status(201).json(result);
});

router.use((error, req, res, next) => {
  if (error.code === '23503') return res.status(409).json({ error: 'A linked customer, source visit, project or owner changed. Reload before saving.' });
  next(error);
});

module.exports = router;
