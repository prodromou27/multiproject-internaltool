const router = require('express').Router();
const db = require('../db');
const { requirePermission } = require('../middleware/auth');
const { logAudit } = require('../auditLog');
const { DATA_SOURCES, PERIODS, validateDefinition, evaluate, parseConfig, calculateDefinition } = require('../kpiDefinitions');
const { decrypt } = require('../fieldCipher');
const appTime = require('../appTime');

function parseNumber(value, label, { min = 0 } = {}) {
  if (value === undefined || value === null || value === '') return { value: null };
  const n = Number(value);
  if (!Number.isFinite(n) || n < min) return { error: `${label} must be a number greater than or equal to ${min}` };
  return { value: n };
}

function definitionResponse(row) {
  return row ? { ...row, enabled: !!row.enabled, calculation_config: parseConfig(row.calculation_config) } : row;
}

function pageValue(value, fallback, max) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return parsed >= 1 && parsed <= max ? parsed : null;
}

function listQuery(query) {
  const allowed = new Set(['page', 'page_size', 'search', 'category', 'data_source', 'scope_type', 'enabled']);
  if (Object.keys(query).some(key => !allowed.has(key)) || Object.values(query).some(Array.isArray)) return { error: 'Invalid KPI filters' };
  const page = pageValue(query.page, 1, 10000), pageSize = pageValue(query.page_size, 25, 100);
  if (!page || !pageSize) return { error: 'Invalid pagination values' };
  const search = (query.search || '').trim();
  if (search.length > 200) return { error: 'Search cannot exceed 200 characters' };
  if (query.enabled !== undefined && !['true', 'false'].includes(query.enabled)) return { error: 'Enabled filter must be true or false' };
  const sourceKeys = new Set(DATA_SOURCES.map(source => source.key));
  if (query.data_source && !sourceKeys.has(query.data_source)) return { error: 'Invalid data source filter' };
  if (query.scope_type && !['organization', 'team', 'project', 'customer', 'engineer'].includes(query.scope_type)) return { error: 'Invalid scope filter' };
  return { page, pageSize, offset: (page - 1) * pageSize, search, category: (query.category || '').trim(), dataSource: query.data_source || '', scopeType: query.scope_type || '', enabled: query.enabled };
}

async function validateScopeReferences(source, connection = db) {
  if (source.scope_type === 'team' && !await connection.prepare('SELECT id FROM teams WHERE id=?').get(source.team_id)) return 'Team not found';
  if (source.scope_type === 'project' && !await connection.prepare('SELECT id FROM projects WHERE id=?').get(source.project_id)) return 'Project not found';
  if (source.scope_type === 'customer' && !await connection.prepare('SELECT id FROM customers WHERE id=?').get(source.customer_id)) return 'Customer not found';
  if (source.scope_type === 'engineer' && !await connection.prepare('SELECT id FROM users WHERE id=? AND active=1').get(source.user_id)) return 'Engineer not found';
  return null;
}

router.get('/definitions/meta', requirePermission('kpis.view'), async (_req, res) => {
  const [teams, projects, customers, engineers] = await Promise.all([
    db.prepare('SELECT id,name FROM teams ORDER BY name').all(),
    db.prepare("SELECT id,title FROM projects WHERE status NOT IN ('closed','cancelled') ORDER BY title LIMIT 500").all(),
    db.prepare('SELECT id,name FROM customers WHERE active=1').all(),
    db.prepare("SELECT id,name,role FROM users WHERE active=1 ORDER BY name").all(),
  ]);
  res.json({ data_sources: DATA_SOURCES, periods: Object.entries(PERIODS).map(([key, label]) => ({ key, label })), scopes: ['organization', 'team', 'project', 'customer', 'engineer'],
    visualizations: ['number', 'gauge', 'progress', 'trend', 'bar'], teams, projects,
    customers: customers.map(row => ({ id: row.id, name: decrypt(row.name) })).sort((a, b) => a.name.localeCompare(b.name)), engineers });
});

router.get('/definitions', requirePermission('kpis.view'), async (req, res) => {
  const parsed = listQuery(req.query);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const clauses = [], params = [];
  if (parsed.search) { const term = `%${parsed.search.replace(/[\\%_]/g, match => `\\${match}`)}%`; clauses.push('(d.name ILIKE ? OR d.description ILIKE ? OR d.category ILIKE ?)'); params.push(term, term, term); }
  if (parsed.category) { clauses.push('d.category=?'); params.push(parsed.category); }
  if (parsed.dataSource) { clauses.push('d.data_source=?'); params.push(parsed.dataSource); }
  if (parsed.scopeType) { clauses.push('d.scope_type=?'); params.push(parsed.scopeType); }
  if (parsed.enabled !== undefined) { clauses.push('d.enabled=?'); params.push(parsed.enabled === 'true' ? 1 : 0); }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const total = Number((await db.prepare(`SELECT COUNT(*) AS count FROM kpi_definitions d${where}`).get(...params)).count);
  const rows = await db.prepare(`SELECT d.*,t.name AS team_name,p.title AS project_title,c.name AS customer_name,u.name AS engineer_name,v.value AS current_value,v.status AS current_status,v.calculated_at AS last_calculated_at
    FROM kpi_definitions d
    LEFT JOIN teams t ON t.id=d.team_id LEFT JOIN projects p ON p.id=d.project_id LEFT JOIN customers c ON c.id=d.customer_id LEFT JOIN users u ON u.id=d.user_id
    LEFT JOIN (SELECT definition_id,MAX(id) AS value_id FROM kpi_values GROUP BY definition_id) latest ON latest.definition_id=d.id
    LEFT JOIN kpi_values v ON v.id=latest.value_id
    ${where} ORDER BY d.display_order,d.name,d.id LIMIT ? OFFSET ?`).all(...params, parsed.pageSize, parsed.offset);
  const counts = await db.prepare("SELECT COUNT(*) AS total,COUNT(*) FILTER (WHERE enabled=1) AS enabled,COUNT(*) FILTER (WHERE enabled=0) AS disabled,COUNT(*) FILTER (WHERE scope_type='team') AS team_scoped FROM kpi_definitions").get();
  res.json({ rows: rows.map(row => definitionResponse({ ...row, customer_name: row.customer_name ? decrypt(row.customer_name) : null })), total, page: parsed.page, page_size: parsed.pageSize, counts });
});

router.post('/definitions/preview', requirePermission('kpis.manage'), async (req, res) => {
  const parsed = validateDefinition(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const referenceError = await validateScopeReferences(parsed.value);
  if (referenceError) return res.status(400).json({ error: referenceError });
  const calculation = await calculateDefinition(db, parsed.value);
  res.json({ ...calculation, status: evaluate(calculation.value, parsed.value) });
});

router.post('/definitions', requirePermission('kpis.manage'), async (req, res) => {
  const parsed = validateDefinition(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const referenceError = await validateScopeReferences(parsed.value);
  if (referenceError) return res.status(400).json({ error: referenceError });
  const d = parsed.value;
  const result = await db.prepare(`INSERT INTO kpi_definitions (name,description,category,data_source,calculation_config,target_value,warning_threshold,critical_threshold,direction,scope_type,team_id,project_id,customer_id,user_id,enabled,display_order,visualization_type,created_by,updated_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(d.name, d.description, d.category, d.data_source, JSON.stringify(d.calculation_config), d.target_value, d.warning_threshold, d.critical_threshold, d.direction, d.scope_type, d.team_id, d.project_id, d.customer_id, d.user_id, d.enabled ? 1 : 0, d.display_order, d.visualization_type, req.user.id, req.user.id);
  await logAudit(db, req, 'kpi_definition', result.lastInsertRowid, d.name, 'kpi_definition_created', `source=${d.data_source}; scope=${d.scope_type}`);
  res.status(201).json({ id: result.lastInsertRowid, version: 1 });
});

router.put('/definitions/:id', requirePermission('kpis.manage'), async (req, res) => {
  if (!Number.isSafeInteger(req.body.version) || req.body.version < 1) return res.status(400).json({ error: 'Version is required' });
  const result = await db.transaction(async tx => {
    const current = await tx.prepare('SELECT * FROM kpi_definitions WHERE id=? FOR UPDATE').get(req.params.id);
    if (!current) return { status: 404, error: 'KPI definition not found' };
    if (current.version !== req.body.version) return { status: 409, error: 'KPI definition changed since it was loaded', code: 'KPI_CONFLICT', current: definitionResponse(current) };
    const parsed = validateDefinition({ ...definitionResponse(current), ...req.body, enabled: req.body.enabled ?? !!current.enabled, calculation_config: req.body.calculation_config ?? parseConfig(current.calculation_config) });
    if (parsed.error) return { status: 400, error: parsed.error };
    const referenceError = await validateScopeReferences(parsed.value, tx);
    if (referenceError) return { status: 400, error: referenceError };
    const d = parsed.value, nextVersion = current.version + 1;
    await tx.prepare(`UPDATE kpi_definitions SET name=?,description=?,category=?,data_source=?,calculation_config=?,target_value=?,warning_threshold=?,critical_threshold=?,direction=?,scope_type=?,team_id=?,project_id=?,customer_id=?,user_id=?,enabled=?,display_order=?,visualization_type=?,version=?,updated_by=?,updated_at=app_now() WHERE id=?`).run(d.name, d.description, d.category, d.data_source, JSON.stringify(d.calculation_config), d.target_value, d.warning_threshold, d.critical_threshold, d.direction, d.scope_type, d.team_id, d.project_id, d.customer_id, d.user_id, d.enabled ? 1 : 0, d.display_order, d.visualization_type, nextVersion, req.user.id, req.params.id);
    return { version: nextVersion, name: d.name };
  });
  if (result.status) return res.status(result.status).json(result);
  await logAudit(db, req, 'kpi_definition', Number(req.params.id), result.name, 'kpi_definition_updated', `version=${result.version}`);
  res.json({ ok: true, version: result.version });
});

router.post('/definitions/:id/state', requirePermission('kpis.manage'), async (req, res) => {
  if (typeof req.body.enabled !== 'boolean' || !Number.isSafeInteger(req.body.version)) return res.status(400).json({ error: 'Enabled and version are required' });
  const update = await db.prepare('UPDATE kpi_definitions SET enabled=?,version=version+1,updated_by=?,updated_at=app_now() WHERE id=? AND version=?').run(req.body.enabled ? 1 : 0, req.user.id, req.params.id, req.body.version);
  if (!update.changes) {
    const current = await db.prepare('SELECT id,version,enabled FROM kpi_definitions WHERE id=?').get(req.params.id);
    if (!current) return res.status(404).json({ error: 'KPI definition not found' });
    return res.status(409).json({ error: 'KPI definition changed since it was loaded', code: 'KPI_CONFLICT', current: { ...current, enabled: !!current.enabled } });
  }
  await logAudit(db, req, 'kpi_definition', Number(req.params.id), null, req.body.enabled ? 'kpi_definition_activated' : 'kpi_definition_deactivated');
  res.json({ ok: true, version: req.body.version + 1, enabled: req.body.enabled });
});

router.post('/definitions/:id/test', requirePermission('kpis.manage'), async (req, res) => {
  const definition = await db.prepare('SELECT * FROM kpi_definitions WHERE id=?').get(req.params.id);
  if (!definition) return res.status(404).json({ error: 'KPI definition not found' });
  const calculation = await calculateDefinition(db, definition);
  res.json({ ...calculation, status: evaluate(calculation.value, definition), persisted: false });
});

router.post('/definitions/:id/calculate', requirePermission('kpis.manage'), async (req, res) => {
  const definition = await db.prepare('SELECT * FROM kpi_definitions WHERE id=?').get(req.params.id);
  if (!definition) return res.status(404).json({ error: 'KPI definition not found' });
  if (!definition.enabled) return res.status(409).json({ error: 'Activate this KPI before recording a value' });
  const calculation = await calculateDefinition(db, definition), status = evaluate(calculation.value, definition);
  if (status === 'no_data') return res.status(409).json({ error: 'There is nothing to measure for this KPI in its period yet' });
  const inserted = await db.prepare('INSERT INTO kpi_values (definition_id,value,status,period_start,period_end,calculated_by,source_summary) VALUES (?,?,?,?,?,?,?)').run(definition.id, calculation.value, status, req.body?.period_start || null, req.body?.period_end || null, req.user.id, JSON.stringify(calculation.facts));
  await logAudit(db, req, 'kpi_definition', definition.id, definition.name, 'kpi_value_calculated', `value=${calculation.value}; status=${status}`);
  res.status(201).json({ id: inserted.lastInsertRowid, ...calculation, status });
});

router.get('/definitions/:id/values', requirePermission('kpis.view'), async (req, res) => {
  const page = pageValue(req.query.page, 1, 10000), pageSize = pageValue(req.query.page_size, 25, 100);
  if (!page || !pageSize || Object.keys(req.query).some(key => !['page', 'page_size'].includes(key)) || Object.values(req.query).some(Array.isArray)) return res.status(400).json({ error: 'Invalid history pagination' });
  const definition = await db.prepare('SELECT id,name FROM kpi_definitions WHERE id=?').get(req.params.id);
  if (!definition) return res.status(404).json({ error: 'KPI definition not found' });
  const total = Number((await db.prepare('SELECT COUNT(*) AS count FROM kpi_values WHERE definition_id=?').get(req.params.id)).count);
  const rows = await db.prepare('SELECT v.*,u.name AS calculated_by_name FROM kpi_values v LEFT JOIN users u ON u.id=v.calculated_by WHERE v.definition_id=? ORDER BY v.calculated_at DESC,v.id DESC LIMIT ? OFFSET ?').all(req.params.id, pageSize, (page - 1) * pageSize);
  res.json({ definition, rows: rows.map(row => ({ ...row, source_summary: parseConfig(row.source_summary) })), total, page, page_size: pageSize });
});

/* ── Scorecard: every enabled KPI, measured now ───────────────────── */
router.get('/scorecard', requirePermission('kpis.view'), async (req, res) => {
  const definitions = await db.prepare(`SELECT d.*,t.name AS team_name,p.title AS project_title,c.name AS customer_name,u.name AS engineer_name FROM kpi_definitions d
    LEFT JOIN teams t ON t.id=d.team_id LEFT JOIN projects p ON p.id=d.project_id LEFT JOIN customers c ON c.id=d.customer_id LEFT JOIN users u ON u.id=d.user_id
    WHERE d.enabled=1 ORDER BY d.display_order,d.name,d.id`).all();
  const rows = [];
  for (const definition of definitions) {
    try {
      const result = await calculateDefinition(db, definition);
      rows.push({ ...definitionResponse({ ...definition, customer_name: definition.customer_name ? decrypt(definition.customer_name) : null }), ...result, status: evaluate(result.value, definition),
        breakdown: result.breakdown?.map(row => ({ ...row })) });
    } catch (error) {
      rows.push({ ...definitionResponse(definition), value: null, status: 'no_data', error: error.status ? error.message : 'Could not be calculated' });
    }
  }
  res.json({ rows, today: appTime.today() });
});

/* ── Records: entries managers log for a "Recorded entries" KPI ─────── */
async function recordsDefinition(req, res) {
  const definition = await db.prepare('SELECT id,name,data_source,calculation_config FROM kpi_definitions WHERE id=?').get(req.params.id);
  if (!definition) { res.status(404).json({ error: 'KPI definition not found' }); return null; }
  if (definition.data_source !== 'records') { res.status(400).json({ error: 'This KPI is not measured from recorded entries' }); return null; }
  return definition;
}
router.get('/definitions/:id/records', requirePermission('kpis.view'), async (req, res) => {
  const definition = await recordsDefinition(req, res);
  if (!definition) return;
  const rows = await db.prepare(`SELECT r.*,u.name AS engineer_name,c.name AS created_by_name FROM kpi_records r LEFT JOIN users u ON u.id=r.user_id LEFT JOIN users c ON c.id=r.created_by
    WHERE r.definition_id=? ORDER BY r.record_date DESC,r.id DESC LIMIT 500`).all(definition.id);
  res.json({ definition: { id: definition.id, name: definition.name, config: parseConfig(definition.calculation_config) }, rows });
});
router.post('/definitions/:id/records', requirePermission('kpis.manage'), async (req, res) => {
  const definition = await recordsDefinition(req, res);
  if (!definition) return;
  const { user_id: userId, record_date: date, value = 1, note } = req.body || {};
  if (userId !== null && userId !== undefined && (!Number.isSafeInteger(userId) || userId < 1)) return res.status(400).json({ error: 'Choose an engineer' });
  if (userId && !await db.prepare('SELECT id FROM users WHERE id=?').get(userId)) return res.status(400).json({ error: 'Engineer not found' });
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return res.status(400).json({ error: 'A valid date is required' });
  const amount = Number(value);
  if (!Number.isFinite(amount) || Math.abs(amount) > 1e9) return res.status(400).json({ error: 'The value must be a number' });
  if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > 500)) return res.status(400).json({ error: 'The note can be up to 500 characters' });
  const created = await db.prepare('INSERT INTO kpi_records (definition_id,user_id,record_date,value,note,created_by) VALUES (?,?,?,?,?,?)').run(definition.id, userId || null, date, amount, note?.trim() || null, req.user.id);
  await logAudit(db, req, 'kpi_definition', definition.id, definition.name, 'kpi_record_added', `date=${date}; value=${amount}${userId ? `; user_id=${userId}` : ''}`);
  res.status(201).json({ id: created.lastInsertRowid });
});
router.delete('/records/:recordId', requirePermission('kpis.manage'), async (req, res) => {
  const record = await db.prepare('SELECT r.id,r.definition_id,d.name FROM kpi_records r JOIN kpi_definitions d ON d.id=r.definition_id WHERE r.id=?').get(req.params.recordId);
  if (!record) return res.status(404).json({ error: 'Record not found' });
  await db.prepare('DELETE FROM kpi_records WHERE id=?').run(record.id);
  await logAudit(db, req, 'kpi_definition', record.definition_id, record.name, 'kpi_record_deleted', `record_id=${record.id}`);
  res.json({ ok: true });
});

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
