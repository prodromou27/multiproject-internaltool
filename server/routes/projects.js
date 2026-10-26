const router = require('express').Router();
const multer = require('multer');
const ExcelJS = require('exceljs');
const { notifyShared, notifyUser } = require('../notifications');
const db = require('../db');
const approvals = require('../approvalAging');
const { sentVersion, conflict } = require('../editVersion');
const { requireAuth, requireManager } = require('../middleware/auth');
const { notify } = require('../notifications');
const { decrypt } = require('../fieldCipher');
const { logAudit } = require('../auditLog');
const { safeCell } = require('../xlsxSafety');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/* ── RAG computation ───────────────────────────────────────── */
function computeRag(row) {
  if (row.rag_override) return row.rag_override;
  if (['closed', 'completed', 'cancelled'].includes(row.status)) return 'green';

  let rag = 'green';

  // Deadline proximity
  if (row.deadline) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dl    = new Date(row.deadline);
    const daysUntil = Math.ceil((dl - today) / 86400000);
    if (daysUntil < 0)       rag = 'red';
    else if (daysUntil <= 14) rag = 'amber';
  }

  // Overdue task ratio
  const total  = row.task_count        || 0;
  const overdue = row.overdue_task_count || 0;
  if (total > 0) {
    const ratio = overdue / total;
    if (ratio > 0.25)                   rag = 'red';
    else if (ratio > 0.10 && rag === 'green') rag = 'amber';
  }

  return rag;
}

/* ── helpers ──────────────────────────────────────────────── */
async function logActivity(project_id, user_id, action, detail) {
  try {
    (await db.prepare(`INSERT INTO project_activity (project_id, user_id, action, detail) VALUES (?, ?, ?, ?)`)
      .run(project_id, user_id, action, detail || null));
  } catch (_) { /* non-fatal */ }
}

async function notifyPendingScores(projectId, projectTitle) {
  try {
    // Count engineers on this project who still lack a scorecard
    const pending = (await db.prepare(`
      SELECT COUNT(*) AS cnt
      FROM project_assignments pa
      JOIN users u ON u.id = pa.user_id AND u.role = 'engineer' AND u.active = 1
      WHERE pa.project_id = ?
        AND pa.user_id NOT IN (
          SELECT engineer_id FROM project_scorecards WHERE project_id = ?
        )
    `).get(projectId, projectId));

    if (!pending || pending.cnt === 0) return; // nothing to do

    const managers = (await db.prepare("SELECT id FROM users WHERE role='manager' AND active=1").all());
    const title = `KPI scores pending: "${projectTitle}"`;
    const body  = `${pending.cnt} engineer${pending.cnt > 1 ? 's' : ''} on "${projectTitle}" still need${pending.cnt === 1 ? 's' : ''} a quality scorecard. Please submit scores in the Scorecards section.`;
    await db.transaction(async (tx) => {
      const ins = tx.prepare("INSERT INTO notifications (user_id, type, title, body) VALUES (?, 'scorecard_pending', ?, ?)");
      for (const m of managers) await ins.run(m.id, title, body);
    });
  } catch (_) { /* non-fatal */ }
}

function normalizeIdList(values, label) {
  if (!Array.isArray(values)) return { error: `${label} must be an array` };
  if (values.length > 100) return { error: `${label} cannot contain more than 100 entries` };
  const ids = [...new Set(values.map(v => Number(v)).filter(Number.isInteger).filter(v => v > 0))];
  if (ids.length !== values.length) return { error: `${label} must contain only positive integer IDs` };
  return { ids };
}

async function loadEngineerMap(ids) {
  if (!ids.length) return {};
  const placeholders = ids.map(() => '?').join(',');
  const engineerMap = {};
  (await db.prepare(`SELECT id, name, email FROM users WHERE id IN (${placeholders}) AND role = 'engineer' AND active = 1`)
    .all(...ids))
    .forEach(e => { engineerMap[e.id] = e; });
  return engineerMap;
}

const VALID_PROJECT_PRIORITIES = new Set(['low', 'medium', 'high']);
const VALID_PROJECT_STATUSES = new Set([
  'not_started', 'in_progress', 'waiting_customer', 'waiting_vendor', 'on_hold',
  'delayed', 'completed_engineer', 'completed', 'pending_approval', 'closed', 'reopened', 'cancelled',
]);
const VALID_RAG = new Set(['red', 'amber', 'green']);

const MAX_CODE = 50;
/** A Project ID as typed: trimmed, 1–50 characters; { value } or { error }. */
function checkProjectCode(value) {
  if (typeof value !== 'string' || !value.trim()) return { error: 'Project ID required' };
  const code = value.trim();
  if (code.length > MAX_CODE) return { error: `Project ID cannot exceed ${MAX_CODE} characters` };
  return { value: code };
}
/** The project already using a Project ID (any letter case), other than exceptId. */
async function codeTakenBy(code, exceptId = null) {
  const row = await db.prepare('SELECT id, title FROM projects WHERE LOWER(project_code) = LOWER(?)').get(code);
  return row && Number(row.id) !== Number(exceptId) ? row : null;
}

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}

function normalizeOptionalId(value, label) {
  if (value === undefined) return { value: undefined };
  if (value === null || value === '') return { value: null };
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return { error: `${label} must be a positive integer` };
  return { value: n };
}

// List projects — engineers/planners see only assigned ones; managers and PMs see all
router.get('/', requireAuth, async (req, res) => {
  // Task counts in one grouped pass (not three subqueries per project), and the pin as a join.
  const taskJoin = `
    LEFT JOIN (SELECT project_id,
        SUM(CASE WHEN status != 'cancelled' THEN 1 ELSE 0 END) AS task_count,
        SUM(CASE WHEN status IN ('completed','closed') THEN 1 ELSE 0 END) AS done_count,
        SUM(CASE WHEN status NOT IN ('completed','closed','cancelled') AND deadline IS NOT NULL AND deadline < app_today() THEN 1 ELSE 0 END) AS overdue_task_count
      FROM tasks WHERE project_id IS NOT NULL GROUP BY project_id) tc ON tc.project_id = p.id
    LEFT JOIN user_project_pins pin ON pin.project_id = p.id AND pin.user_id = ?`;
  const taskCols = 'COALESCE(tc.task_count, 0) AS task_count, COALESCE(tc.done_count, 0) AS done_count, COALESCE(tc.overdue_task_count, 0) AS overdue_task_count, (pin.user_id IS NOT NULL) AS is_pinned';
  let rows;
  if (req.user.role === 'manager' || req.user.role === 'pm') {
    rows = (await db.prepare(`
      SELECT p.*, u.name as created_by_name, cu.name as customer_name, ${taskCols}
      FROM projects p
      JOIN users u ON p.created_by = u.id
      LEFT JOIN customers cu ON p.customer_id = cu.id
      ${taskJoin}
      ORDER BY is_pinned DESC, p.created_at DESC
    `).all(req.user.id));
  } else {
    rows = (await db.prepare(`
      SELECT p.*, u.name as created_by_name, cu.name as customer_name, ${taskCols}
      FROM projects p
      JOIN project_assignments pa ON pa.project_id = p.id
      JOIN users u ON p.created_by = u.id
      LEFT JOIN customers cu ON p.customer_id = cu.id
      ${taskJoin}
      WHERE pa.user_id = ? ORDER BY is_pinned DESC, p.created_at DESC
    `).all(req.user.id, req.user.id));
  }
  // Customer names are decrypted once per customer, and only where needed: every
  // row for the full list or a search, otherwise only the page sent back.
  const names = new Map();
  const nameOf = value => { if (!names.has(value)) names.set(value, decrypt(value)); return names.get(value); };
  const withName = row => (row.customer_name_decrypted ? row : { ...row, customer_name: nameOf(row.customer_name), customer_name_decrypted: true });
  const clean = ({ customer_name_decrypted, ...row }) => row;
  // Attach computed RAG + live completion %.
  rows=rows.map(r => ({
    ...r,
    task_count: Number(r.task_count), done_count: Number(r.done_count), overdue_task_count: Number(r.overdue_task_count), is_pinned: !!r.is_pinned,
    rag_status:     computeRag({ ...r, task_count: Number(r.task_count), done_count: Number(r.done_count), overdue_task_count: Number(r.overdue_task_count) }),
    completion_pct: r.completion_pct != null
      ? r.completion_pct
      : (Number(r.task_count) > 0 ? Math.round((Number(r.done_count) / Number(r.task_count)) * 100) : 0),
  }));
  if (req.query.paged === undefined) return res.json(rows.map(row => clean(withName(row))));
  if (req.query.paged!=='1' || Object.values(req.query).some(value => typeof value!=='string')) return res.status(400).json({ error:'Invalid project list parameters' });
  const page=Number(req.query.page || 1),pageSize=Number(req.query.page_size || 25),search=(req.query.search || '').trim().toLowerCase();
  const status=req.query.status || 'open',rag=req.query.rag || 'all';
  const statuses=new Set(['open','all','overdue',...VALID_PROJECT_STATUSES]);
  if (!Number.isSafeInteger(page) || page<1 || page>10_000 || !Number.isSafeInteger(pageSize) || pageSize<1 || pageSize>100 || search.length>200 || !statuses.has(status) || !['all','red','amber','green'].includes(rag)) return res.status(400).json({ error:'Invalid project filters or pagination' });
  const terminal=new Set(['closed','cancelled']);
  const searched=search ? rows.map(withName).filter(row => [row.project_code,row.title,row.customer_name,row.created_by_name].some(value => String(value || '').toLowerCase().includes(search))) : rows;
  const counts={ all:searched.length,open:searched.filter(row => !terminal.has(row.status)).length,overdue:searched.filter(row => !terminal.has(row.status) && row.status!=='pending_approval' && row.deadline && row.deadline<require('../appTime').today()).length };
  for (const value of VALID_PROJECT_STATUSES) counts[value]=searched.filter(row => row.status===value).length;
  let filtered=status==='all' ? searched : status==='open' ? searched.filter(row => !terminal.has(row.status)) : status==='overdue' ? searched.filter(row => !terminal.has(row.status) && row.status!=='pending_approval' && row.deadline && row.deadline<require('../appTime').today()) : searched.filter(row => row.status===status);
  counts.rag_all=filtered.length;for (const value of ['red','amber','green']) counts[`rag_${value}`]=filtered.filter(row => row.rag_status===value).length;
  if (rag!=='all') filtered=filtered.filter(row => row.rag_status===rag);
  const offset=(page-1)*pageSize;
  res.json({ rows:filtered.slice(offset,offset+pageSize).map(row => clean(withName(row))),total:filtered.length,page,page_size:pageSize,counts });
});

/* ── Pin / unpin a project ─────────────────────────────────── */
router.post('/:id/pin', requireAuth, async (req, res) => {
  if (!/^\d+$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id)) || Number(req.params.id) < 1)
    return res.status(400).json({ error: 'Invalid project ID' });
  const project = await db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!['manager', 'pm'].includes(req.user.role)
    && !await db.prepare('SELECT 1 FROM project_assignments WHERE project_id = ? AND user_id = ?').get(project.id, req.user.id))
    return res.status(403).json({ error: 'Forbidden' });
  const id = parseInt(req.params.id, 10);
  (await db.prepare('INSERT INTO user_project_pins (user_id, project_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(req.user.id, id));
  res.json({ ok: true });
});
router.delete('/:id/pin', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  (await db.prepare('DELETE FROM user_project_pins WHERE user_id = ? AND project_id = ?').run(req.user.id, id));
  res.json({ ok: true });
});

router.get('/approvals', requireManager, async (req, res) => {
  const positive = (value, fallback, max = Number.MAX_SAFE_INTEGER) => value === undefined ? fallback
    : typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) <= max ? Number(value) : null;
  const page = positive(req.query.page, 1);
  const pageSize = positive(req.query.page_size, 25, 100);
  if (!page || !pageSize || !Number.isSafeInteger((page - 1) * pageSize)) return res.status(400).json({ error: 'Invalid pagination' });
  const rows = await db.prepare(`SELECT p.id, p.title, p.priority, p.deadline, p.customer_id,
      p.closure_requested_at, p.closure_request_version, p.closure_requested_by, requester.name AS requested_by_name, c.name AS customer_name,
      p.closure_assigned_to AS assigned_to, assignee.name AS assigned_to_name,
      COALESCE(ot.n, 0) AS open_tasks, COALESCE(om.n, 0) AS open_milestones
    FROM projects p LEFT JOIN users requester ON requester.id=p.closure_requested_by
    LEFT JOIN users assignee ON assignee.id=p.closure_assigned_to
    LEFT JOIN (SELECT project_id, COUNT(*) AS n FROM tasks WHERE status NOT IN ('completed','closed','cancelled') GROUP BY project_id) ot ON ot.project_id=p.id
    LEFT JOIN (SELECT project_id, COUNT(*) AS n FROM project_milestones WHERE completed_at IS NULL GROUP BY project_id) om ON om.project_id=p.id
    LEFT JOIN customers c ON c.id=p.customer_id WHERE p.status='pending_approval'
    ORDER BY p.closure_requested_at ASC NULLS LAST, p.id ASC LIMIT ? OFFSET ?`).all(pageSize, (page - 1) * pageSize);
  const { total } = await db.prepare("SELECT COUNT(*) AS total FROM projects WHERE status='pending_approval'").get();
  // How long each has waited against its target, and who could take it (approvalAging.js).
  const cal = await require('../businessCalendar').load();
  const [eligible, counts] = await Promise.all([approvals.reviewers('closure'), approvals.assignedCounts('closure')]);
  res.json({ rows: rows.map(row => ({ ...row, customer_name: decrypt(row.customer_name), open_tasks: Number(row.open_tasks), open_milestones: Number(row.open_milestones),
    ...approvals.aging(row.closure_requested_at, 'closure', cal), suggested_delegate: approvals.suggestDelegate(eligible, counts, row.closure_requested_by) })),
    reviewers: eligible.map(r => ({ ...r, assigned: counts.get(r.id) || 0 })), total: Number(total), page, page_size: pageSize });
});

// ── Export ─────────────────────────────────────────────────────────────────
router.get('/export', requireManager, async (req, res) => {
  const rows = await db.prepare(`
    SELECT p.id, p.project_code, p.title, p.description, p.status, p.priority, p.start_date, p.deadline,
      cu.name AS customer_name, u.name AS created_by_name, p.created_at
    FROM projects p
    JOIN users u ON p.created_by = u.id
    LEFT JOIN customers cu ON p.customer_id = cu.id
    ORDER BY p.created_at DESC
  `).all();
  const members = rows.length ? await db.prepare(`
    SELECT pa.project_id, eu.name FROM project_assignments pa JOIN users eu ON eu.id = pa.user_id
    WHERE pa.project_id IN (${rows.map(() => '?').join(',')}) ORDER BY pa.project_id, eu.name
  `).all(...rows.map(r => r.id)) : [];
  const membersByProject = new Map();
  for (const m of members) { if (!membersByProject.has(m.project_id)) membersByProject.set(m.project_id, []); membersByProject.get(m.project_id).push(m.name); }
  for (const row of rows) row.member_names = (membersByProject.get(row.id) || []).join(', ');
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Projects');
  worksheet.addRow(['Project ID', 'Title', 'Description', 'Status', 'Priority', 'Start Date', 'Deadline', 'Customer', 'Members', 'Created By', 'Created At']);
  for (const row of rows) worksheet.addRow([
    safeCell(row.project_code), safeCell(row.title), safeCell(row.description), safeCell(row.status), safeCell(row.priority),
    row.start_date || '', row.deadline || '', safeCell(decrypt(row.customer_name) || ''), safeCell(row.member_names || ''),
    safeCell(row.created_by_name), row.created_at || '',
  ]);
  const buf = await workbook.xlsx.writeBuffer();
  res.setHeader('Content-Disposition', 'attachment; filename="projects.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// ── Template download (before any other GET that could shadow it) ──────────
router.get('/template/download', requireManager, async (req, res) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Projects');
  [
    ['project_code*', 'title*', 'description*', 'start_date*', 'member_names*', 'customer_name', 'priority', 'deadline'],
    ['PRJ-2026-001', 'Network refresh', 'Replace core switches', '2026-11-01', 'Alice Engineer, Bob Smith', 'Acme Corp', 'high', '2027-02-01'],
    ['PRJ-2026-002', 'Internal audit',  'Annual security review', '2026-11-15', 'Alice Engineer', '', 'medium', ''],
  ].forEach(row => worksheet.addRow(row));
  [16, 24, 30, 14, 34, 22, 12, 14].forEach((w, i) => { worksheet.getColumn(i + 1).width = w; });
  const buf = await workbook.xlsx.writeBuffer();
  res.setHeader('Content-Disposition', 'attachment; filename="projects_template.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// Convert an ExcelJS cell value to string, handling dates and rich text.
function projectCellToString(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object' && v.richText) return v.richText.map(rt => rt.text || '').join('');
  if (typeof v === 'object' && v.formula !== undefined) return projectCellToString(v.result);
  return String(v);
}
// Equivalent of XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false }).
function projectSheetToJson(worksheet) {
  if (!worksheet || worksheet.rowCount < 2) return [];
  const headerRow = worksheet.getRow(1);
  const maxCol = headerRow.cellCount;
  const headers = [];
  for (let c = 1; c <= maxCol; c++) headers[c] = projectCellToString(headerRow.getCell(c).value);
  const rows = [];
  for (let r = 2; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const obj = {};
    for (let c = 1; c <= maxCol; c++) { if (headers[c]) obj[headers[c]] = projectCellToString(row.getCell(c).value); }
    rows.push(obj);
  }
  return rows;
}

// The workbook's rows: { rows, hash } or { error }.
async function readProjectWorkbook(file) {
  if (!file) return { error: 'No file uploaded' };
  const workbook = new ExcelJS.Workbook();
  try { require('../uploadUtils').assertSafeSpreadsheet(file.buffer); await workbook.xlsx.load(file.buffer); }
  catch (e) { return { error: e.status === 400 ? e.message : 'Could not parse file. Use .xlsx format' }; }
  const rows = projectSheetToJson(workbook.worksheets[0]);
  if (!rows.length) return { error: 'File is empty or has no data rows' };
  if (rows.length > 5000) return { error: 'Maximum 5000 rows per import. Please split your file.' };
  const normalize = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.replace(/\*/g, '').trim().toLowerCase().replace(/\s+/g, '_'),
    v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'string' ? v.trim() : String(v ?? '').trim()]));
  return { rows: rows.map(normalize), hash: require('crypto').createHash('sha256').update(file.buffer).digest('hex') };
}

// What importing would do: each row new, already there (same Project ID), or not imported with the reason.
async function planProjectImport(read) {
  const customers = (await db.prepare('SELECT id, name FROM customers').all()).map(c => ({ id: Number(c.id), name: decrypt(c.name) || '' }));
  const users = await db.prepare("SELECT id, name, email FROM users WHERE role='engineer' AND active=1").all();
  const findCustomer = name => customers.find(c => c.name.toLowerCase() === name.toLowerCase()) || null;
  const findEngineer = q => users.find(u => u.name.toLowerCase() === q.toLowerCase() || (u.email || '').toLowerCase() === q.toLowerCase()) || null;
  const seen = new Set();
  const rows = await Promise.all(read.rows.map(async (row, i) => {
    const rowNum = i + 2, base = { row: rowNum, name: row.title || row.project_code || '', values: row };
    const fail = (error, kind) => ({ ...base, action: 'error', error, kind });
    for (const field of ['project_code', 'title', 'description', 'start_date', 'member_names']) if (!row[field]) return fail(`Missing: ${field}`);
    const code = row.project_code;
    if (code.length > 50) return fail('Project ID cannot exceed 50 characters');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.start_date) || Number.isNaN(Date.parse(row.start_date))) return fail(`start_date must be YYYY-MM-DD, not "${row.start_date}"`);
    if (row.deadline && (!/^\d{4}-\d{2}-\d{2}$/.test(row.deadline) || Number.isNaN(Date.parse(row.deadline)))) return fail(`deadline must be YYYY-MM-DD, not "${row.deadline}"`);
    if (row.deadline && row.deadline < row.start_date) return fail('The deadline cannot be before the start date');
    const priority = (row.priority || 'medium').toLowerCase();
    if (!VALID_PROJECT_PRIORITIES.has(priority)) return fail(`priority must be one of: ${[...VALID_PROJECT_PRIORITIES].join(', ')}`);
    let customerId = null;
    if (row.customer_name) {
      const customer = findCustomer(row.customer_name);
      if (!customer) return fail(`Customer not found: "${row.customer_name}"`);
      customerId = customer.id;
    }
    const members = [];
    for (const name of row.member_names.split(',').map(x => x.trim()).filter(Boolean)) {
      const engineer = findEngineer(name);
      if (!engineer) return fail(`Engineer not found: "${name}"`);
      members.push(Number(engineer.id));
    }
    if (!members.length) return fail('member_names must name at least one active engineer');
    const key = code.toLowerCase();
    if (await codeTakenBy(code)) return { ...base, action: 'unchanged', error: `Already there: Project ID ${code}` };
    if (seen.has(key)) return fail('The same Project ID appears earlier in the file', 'duplicate');
    seen.add(key);
    return { ...base, action: 'create',
      value: { project_code: code, title: row.title, description: row.description, start_date: row.start_date, deadline: row.deadline || null, priority, customer_id: customerId, members } };
  }));
  const count = action => rows.filter(r => r.action === action).length;
  const { last } = await db.prepare('SELECT MAX(id) AS last FROM projects').get();
  const token = require('crypto').createHash('sha256').update(`${read.hash}|${last || 0}`).digest('hex');
  return { rows, token, counts: { create: count('create'), update: 0, unchanged: count('unchanged'), errors: count('error'), duplicates: rows.filter(r => r.kind === 'duplicate').length, total: rows.length } };
}
const projectPreviewOf = plan => ({ token: plan.token, counts: plan.counts,
  rows: plan.rows.map(({ row, name, action, kind, error, values }) => ({ row, name, action, kind, error, values: action === 'create' ? undefined : values })) });

router.post('/import/preview', requireManager, upload.single('file'), async (req, res) => {
  const read = await readProjectWorkbook(req.file);
  if (read.error) return res.status(400).json({ error: read.error });
  res.json(projectPreviewOf(await planProjectImport(read)));
});

router.post('/import', requireManager, upload.single('file'), async (req, res) => {
  const read = await readProjectWorkbook(req.file);
  if (read.error) return res.status(400).json({ error: read.error });
  const plan = await planProjectImport(read);
  if (req.body?.preview_token && req.body.preview_token !== plan.token)
    return res.status(409).json({ error: 'The file or the projects changed since the review. Review the import again.', code: 'IMPORT_CHANGED', preview: projectPreviewOf(plan) });
  let imported = 0;
  const errors = plan.rows.filter(r => r.action !== 'create').map(r => ({ row: r.row, error: r.error }));
  // Each new project on its own: one that fails is reported, the others go in.
  for (const row of plan.rows.filter(r => r.action === 'create')) {
    try {
      const pid = await db.transaction(async tx => {
        const created = await tx.prepare('INSERT INTO projects (project_code, title, description, priority, start_date, deadline, customer_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(row.value.project_code, row.value.title.trim(), row.value.description.trim(), row.value.priority, row.value.start_date, row.value.deadline, row.value.customer_id, req.user.id);
        const ins = tx.prepare('INSERT INTO project_assignments (project_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING');
        for (const uid of row.value.members) await ins.run(created.lastInsertRowid, uid);
        return created.lastInsertRowid;
      });
      logActivity(pid, req.user.id, 'project_created', row.value.title);
      imported++;
    } catch (e) { errors.push({ row: row.row, error: e.message }); }
  }
  res.json({ imported, skipped: errors.length, errors });
});

function requireProjectId(req, res, next) {
  if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id))) {
    return res.status(400).json({ error: 'Invalid project ID' });
  }
  next();
}

router.get('/:id', requireAuth, requireProjectId, async (req, res) => {
  const p = (await db.prepare(`
    SELECT p.*, u.name as created_by_name, cu.name as customer_name, cu.contact_name as customer_contact, cu.contact_email as customer_email,
      requester.name AS closure_requested_by_name, reviewer.name AS closure_reviewed_by_name
    FROM projects p
    JOIN users u ON p.created_by = u.id
    LEFT JOIN customers cu ON p.customer_id = cu.id
    LEFT JOIN users requester ON requester.id=p.closure_requested_by
    LEFT JOIN users reviewer ON reviewer.id=p.closure_reviewed_by
    WHERE p.id = ?`).get(req.params.id));
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'manager' && req.user.role !== 'pm') {
    const assigned = (await db.prepare('SELECT 1 FROM project_assignments WHERE project_id = ? AND user_id = ?').get(p.id, req.user.id));
    if (!assigned) return res.status(403).json({ error: 'Forbidden' });
  }
  const members = (await db.prepare('SELECT u.id, u.name, u.email, u.role FROM project_assignments pa JOIN users u ON pa.user_id = u.id WHERE pa.project_id = ?').all(p.id));
  const updates = (await db.prepare('SELECT s.*, u.name as user_name FROM project_status_updates s JOIN users u ON s.user_id = u.id WHERE s.project_id = ? ORDER BY s.created_at DESC').all(p.id));
  res.json({
    ...p,
    customer_name:    decrypt(p.customer_name),
    customer_contact: decrypt(p.customer_contact),
    customer_email:   decrypt(p.customer_email),
    members,
    updates,
  });
});

/* ── Activity feed ─────────────────────────────────────────── */
router.get('/:id/activity', requireAuth, requireProjectId, async (req, res) => {
  const p = (await db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id));
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'manager' && req.user.role !== 'pm') {
    const assigned = (await db.prepare('SELECT 1 FROM project_assignments WHERE project_id = ? AND user_id = ?').get(p.id, req.user.id));
    if (!assigned) return res.status(403).json({ error: 'Forbidden' });
  }
  const rows = (await db.prepare(`
    SELECT pa.*, u.name as user_name, u.role as user_role
    FROM project_activity pa
    JOIN users u ON pa.user_id = u.id
    WHERE pa.project_id = ?
    ORDER BY pa.created_at DESC
    LIMIT 100
  `).all(req.params.id));
  res.json(rows);
});


router.post('/', requireManager, async (req, res) => {
  const { title, description, priority, deadline, customer_id, member_ids, start_date } = req.body;
  // Required: Project ID, name, description, start date and at least one engineer; the deadline is optional.
  const code = checkProjectCode(req.body.project_code);
  if (code.error) return res.status(400).json({ error: code.error });
  if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'Project name required' });
  if (title.trim().length > 500) return res.status(400).json({ error: 'Title cannot exceed 500 characters' });
  if (typeof description !== 'string' || !description.trim()) return res.status(400).json({ error: 'Description required' });
  if (description.length > 10000) return res.status(400).json({ error: 'Description cannot exceed 10000 characters' });
  if (priority && !VALID_PROJECT_PRIORITIES.has(priority)) return res.status(400).json({ error: 'Invalid priority value' });
  if (!isIsoDate(start_date)) return res.status(400).json({ error: 'Start date required (YYYY-MM-DD)' });
  if (deadline && !isIsoDate(deadline)) return res.status(400).json({ error: 'deadline must be YYYY-MM-DD' });
  if (deadline && deadline < start_date) return res.status(400).json({ error: 'The deadline cannot be before the start date' });
  if (!Array.isArray(member_ids) || !member_ids.length) return res.status(400).json({ error: 'Assign at least one engineer' });
  const taken = await codeTakenBy(code.value);
  if (taken) return res.status(409).json({ error: `Project ID ${code.value} is already used by "${taken.title}"` });
  const normalizedCustomer = normalizeOptionalId(customer_id, 'customer_id');
  if (normalizedCustomer.error) return res.status(400).json({ error: normalizedCustomer.error });
  if (normalizedCustomer.value) {
    const customer = await db.prepare('SELECT id FROM customers WHERE id = ?').get(normalizedCustomer.value);
    if (!customer) return res.status(400).json({ error: 'customer_id does not exist' });
  }
  let engineerMap = {};
  let normalizedMemberIds = [];
  if (member_ids !== undefined) {
    const normalized = normalizeIdList(member_ids, 'member_ids');
    if (normalized.error) return res.status(400).json({ error: normalized.error });
    normalizedMemberIds = normalized.ids;
    engineerMap = await loadEngineerMap(normalizedMemberIds);
    if (Object.keys(engineerMap).length !== normalizedMemberIds.length)
      return res.status(400).json({ error: 'member_ids may only include active engineers' });
  }
  const pid = await db.transaction(async tx => {
    const result = await tx.prepare('INSERT INTO projects (project_code, title, description, priority, start_date, deadline, customer_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(code.value, title.trim(), description.trim(), priority || 'medium', start_date, deadline || null, normalizedCustomer.value || null, req.user.id);
    const ins = tx.prepare('INSERT INTO project_assignments (project_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING');
    for (const uid of normalizedMemberIds) await ins.run(result.lastInsertRowid, uid);
    return result.lastInsertRowid;
  });
  logActivity(pid, req.user.id, 'project_created', title);
  if (normalizedMemberIds.length > 0) {
    for (const uid of normalizedMemberIds) {
      const engineer = engineerMap[uid];
      logActivity(pid, req.user.id, 'member_added', engineer.name);
      notify('project.assigned', {
        engineer_id:    uid,
        engineer_name:  engineer.name,
        engineer_email: engineer.email,
        project_id:     pid,
        project_title:  title,
        deadline:       deadline || null,
        priority:       priority || 'medium',
      });
    }
  }
  res.json({ id: pid });
});

router.put('/:id', requireManager, async (req, res) => {
  const p = (await db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id));
  if (!p) return res.status(404).json({ error: 'Not found' });
  const version = sentVersion(req.body);
  if (version.error) return res.status(400).json({ error: version.error });
  if (version.value !== undefined && version.value !== Number(p.edit_version)) return conflict(res, 'This project', { ...p, customer_name: undefined });

  const { title, description, priority, deadline, customer_id, status, pending_from_customer, completion_pct, rag_override, start_date } = req.body;
  // Project ID and start date: when sent, a Project ID cannot be emptied and stays unique; '' clears the start date.
  let nextCode = p.project_code;
  if (req.body.project_code !== undefined) {
    const code = checkProjectCode(req.body.project_code);
    if (code.error) return res.status(400).json({ error: code.error });
    const taken = await codeTakenBy(code.value, p.id);
    if (taken) return res.status(409).json({ error: `Project ID ${code.value} is already used by "${taken.title}"` });
    nextCode = code.value;
  }
  if (start_date !== undefined && start_date !== null && start_date !== '' && !isIsoDate(start_date)) return res.status(400).json({ error: 'start_date must be YYYY-MM-DD' });
  const nextStart = start_date === undefined ? p.start_date : (start_date || null);
  const nextDeadline = deadline === undefined ? p.deadline : (deadline || null);
  if (nextStart && nextDeadline && nextDeadline < nextStart && (start_date !== undefined || deadline !== undefined))
    return res.status(400).json({ error: 'The deadline cannot be before the start date' });
  if (pending_from_customer != null && (typeof pending_from_customer !== 'string' || pending_from_customer.length > 10000))
    return res.status(400).json({ error: 'pending_from_customer must be text of at most 10000 characters' });
  if (title !== undefined && (typeof title !== 'string' || !title.trim())) return res.status(400).json({ error: 'Title cannot be empty' });
  if (typeof title === 'string' && title.trim().length > 500) return res.status(400).json({ error: 'Title cannot exceed 500 characters' });
  if (description !== undefined && description !== null && typeof description !== 'string') return res.status(400).json({ error: 'Description must be text' });
  if (description && description.length > 10000) return res.status(400).json({ error: 'Description cannot exceed 10000 characters' });
  if (priority && !VALID_PROJECT_PRIORITIES.has(priority)) return res.status(400).json({ error: 'Invalid priority value' });
  if (status && !VALID_PROJECT_STATUSES.has(status)) return res.status(400).json({ error: 'Invalid status value' });
  if (status && status !== p.status && (p.status === 'pending_approval' || status === 'pending_approval')) {
    return res.status(400).json({ error: 'Use the closure request and review controls to change approval status', code: 'CLOSURE_REVIEW_REQUIRED' });
  }
  if (deadline && !isIsoDate(deadline)) return res.status(400).json({ error: 'deadline must be YYYY-MM-DD' });
  const normalizedCustomer = normalizeOptionalId(customer_id, 'customer_id');
  if (normalizedCustomer.error) return res.status(400).json({ error: normalizedCustomer.error });
  if (normalizedCustomer.value) {
    const customer = await db.prepare('SELECT id FROM customers WHERE id = ?').get(normalizedCustomer.value);
    if (!customer) return res.status(400).json({ error: 'customer_id does not exist' });
  }
  const targetCustomer=normalizedCustomer.value !== undefined ? normalizedCustomer.value : p.customer_id;
  if (targetCustomer!==p.customer_id && await db.prepare('SELECT 1 FROM customer_recommendations r JOIN tasks t ON t.id=r.related_task_id WHERE t.project_id=? LIMIT 1').get(p.id)) return res.status(409).json({ error:'This project has tasks converted from customer recommendations and must keep its customer relationship' });
  if (completion_pct !== undefined) {
    const pct = Number(completion_pct);
    if (!Number.isInteger(pct) || pct < 0 || pct > 100) return res.status(400).json({ error: 'completion_pct must be an integer between 0 and 100' });
  }
  if (rag_override !== undefined && rag_override !== '' && rag_override !== null && !VALID_RAG.has(rag_override))
    return res.status(400).json({ error: 'Invalid rag_override value' });

  // Manage pending_from_customer: set when requires_reason status, clear when leaving it, preserve otherwise
  let newPfc;
  if (status === 'waiting_customer' || status === 'waiting_vendor') {
    newPfc = pending_from_customer !== undefined ? pending_from_customer : p.pending_from_customer;
  } else if (status && status !== p.status) {
    newPfc = null;
  } else {
    newPfc = p.pending_from_customer;
  }

  // rag_override: null/undefined = keep existing; '' = clear override; 'red'/'amber'/'green' = set
  const newRagOverride = rag_override !== undefined
    ? (rag_override === '' ? null : rag_override)
    : p.rag_override;

  const changed = await db.prepare(`UPDATE projects SET title=COALESCE(?,title), description=COALESCE(?,description),
    priority=COALESCE(?,priority), deadline=?, customer_id=?,
    status=COALESCE(?,status), pending_from_customer=?,
    completion_pct=COALESCE(?,completion_pct), rag_override=?, project_code=?, start_date=?, edit_version=edit_version+1,
    updated_at=app_now() WHERE id=? AND status=? AND closure_request_version=? AND edit_version=?`)
    .run(title?.trim() || null, description, priority, nextDeadline, normalizedCustomer.value !== undefined ? normalizedCustomer.value : p.customer_id, status, newPfc,
         completion_pct !== undefined ? completion_pct : null, newRagOverride, nextCode, nextStart, p.id, p.status, p.closure_request_version, p.edit_version);
  if (!changed.changes) {
    const now = await db.prepare('SELECT * FROM projects WHERE id = ?').get(p.id);
    if (version.value !== undefined) return conflict(res, 'This project', now);
    return res.status(409).json({ error: 'Project changed. Reload before saving.', code: 'PROJECT_CONFLICT' });
  }
  if (status && status !== p.status) {
    logActivity(p.id, req.user.id, 'status_changed', `${p.status} → ${status}`);
    if (status === 'closed' || status === 'completed') {
      notifyPendingScores(p.id, title || p.title);
    }
  }
  res.json({ ok: true });
});

// Deleting a project for good (managers): its tasks, updates, files, milestones, KPIs and
// time logged on its tasks go with it. Recommendations that pointed at it are kept.
router.delete('/:id', requireManager, async (req, res) => {
  if (!/^[1-9]\d*$/.test(String(req.params.id))) return res.status(400).json({ error: 'Invalid project ID' });
  const project = await db.prepare('SELECT id, title, project_code FROM projects WHERE id = ?').get(Number(req.params.id));
  if (!project) return res.status(404).json({ error: 'Not found' });
  const files = await db.transaction(async tx => {
    await logAudit(tx, req, 'project', project.id, project.title, 'project_deleted', project.project_code ? `project_id=${project.project_code}` : null);
    return require('../permanentDelete').deleteProject(tx, project.id);
  });
  await require('../permanentDelete').removeFiles(files);
  require('../liveUpdates').emitChange('projects');
  res.json({ ok: true });
});

// Engineer/planner requests closure — must be assigned to the project; PM is read-only
async function recordClosureEvent(tx, req, project, action, message, version) {
  await tx.prepare('INSERT INTO project_status_updates (project_id, user_id, message) VALUES (?, ?, ?)').run(project.id, req.user.id, message);
  await tx.prepare('INSERT INTO project_activity (project_id, user_id, action, detail) VALUES (?, ?, ?, ?)')
    .run(project.id, req.user.id, action, JSON.stringify({ request_version: version, message }));
}

async function notifyClosure(tx, req, project, type, title, message, managers = false) {
  const recipients = managers
    ? await tx.prepare("SELECT id FROM users WHERE role='manager' AND active=1 AND id != ?").all(req.user.id)
    : await tx.prepare('SELECT u.id FROM project_assignments pa JOIN users u ON u.id=pa.user_id WHERE pa.project_id=? AND u.active=1 AND u.id != ?').all(project.id, req.user.id);
  for (const user of recipients) await tx.prepare('INSERT INTO notifications (user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?)')
    .run(user.id, type, title, message, `/projects/${project.id}`);
  return recipients.map(user => user.id);
}

// The bell entries are written in the transaction; this sends each person's own channels afterwards.
function alertClosure(userIds, title, message, project) {
  for (const userId of userIds) notifyUser(userId, 'project_closure', { title, body: message, facts: [{ name: 'Project', value: project.title }] }, {}, { bell: false })
    .catch(error => console.error('[closure alert]', error.message));
}

router.post('/:id/request-closure', requireAuth, async (req, res) => {
  if (req.user.role === 'pm') return res.status(403).json({ error: 'PMs have read-only access to projects' });
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid project ID' });
  const project = await db.prepare('SELECT * FROM projects WHERE id=?').get(id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (req.user.role !== 'manager' && !await db.prepare('SELECT 1 FROM project_assignments WHERE project_id=? AND user_id=?').get(id, req.user.id)) return res.status(403).json({ error: 'You are not assigned to this project' });
  if (['closed', 'cancelled', 'pending_approval'].includes(project.status)) return res.status(400).json({ error: 'Cannot request closure in current status' });
  let reviewers = [];
  const changed = await db.transaction(async tx => {
    const result = await tx.prepare(`UPDATE projects SET status='pending_approval', closure_requested_at=app_now(),
        closure_requested_by=?, closure_request_version=closure_request_version+1,
        closure_reviewed_by=NULL, closure_reviewed_at=NULL, closure_review_comment=NULL, closure_decision=NULL, updated_at=app_now()
      WHERE id=? AND status NOT IN ('closed','cancelled','pending_approval') AND closure_request_version=?`).run(req.user.id, id, project.closure_request_version);
    if (!result.changes) return false;
    const message = `Closure requested by ${req.user.name}`;
    await recordClosureEvent(tx, req, project, 'closure_requested', message, project.closure_request_version + 1);
    reviewers = await notifyClosure(tx, req, project, 'project.closure_requested', `Closure review: ${project.title}`, message, true);
    return true;
  });
  if (changed) alertClosure(reviewers, `🔒 Closure review: ${project.title}`, `**${req.user.name}** asked to close **${project.title}**.`, project);
  if (!changed) return res.status(409).json({ error: 'Project changed; reload before requesting closure' });
  await logAudit(db, req, 'project', id, project.title, 'closure_requested', null);
  notifyShared('project_closure_requested', { title: '🔒 Project closure requested', body: `**${req.user.name}** asked to close **${project.title}**.`,
    facts: [{ name: 'Project', value: project.title }, { name: 'Requested by', value: req.user.name }] });
  res.json({ ok: true, request_version: project.closure_request_version + 1 });
});

async function reviewClosure(req, res, decision) {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid project ID' });
  const body = req.body || {};
  if (body.comment !== undefined && (typeof body.comment !== 'string' || body.comment.length > 2000)) return res.status(400).json({ error: 'Review comment must be text of at most 2000 characters' });
  const comment = body.comment?.trim() || null;
  if (decision === 'rejected' && !comment) return res.status(400).json({ error: 'Explain what needs revision before rejecting closure' });
  if (body.request_version !== undefined && (!Number.isSafeInteger(body.request_version) || body.request_version < 0)) return res.status(400).json({ error: 'Invalid closure request version' });
  const project = await db.prepare('SELECT * FROM projects WHERE id=?').get(id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (body.request_version !== undefined && body.request_version !== project.closure_request_version) return res.status(409).json({ error: 'This closure request has changed. Reload before reviewing.', code: 'CLOSURE_CONFLICT' });
  if (project.status !== 'pending_approval') return res.status(409).json({ error: 'This project is no longer awaiting closure review', code: 'CLOSURE_CONFLICT' });
  const approved = decision === 'approved';
  const message = approved ? `Project closed and approved by ${req.user.name}${comment ? ': ' + comment : ''}` : `Closure rejected by ${req.user.name}: ${comment}`;
  let team = [];
  const changed = await db.transaction(async tx => {
    const result = await tx.prepare(`UPDATE projects SET status=?, closed_by=?, closed_at=CASE WHEN ?=1 THEN app_now() ELSE NULL END,
      closure_reviewed_by=?, closure_reviewed_at=app_now(), closure_review_comment=?, closure_decision=?, updated_at=app_now()
      WHERE id=? AND status='pending_approval' AND closure_request_version=?`)
      .run(approved ? 'closed' : 'reopened', approved ? req.user.id : null,
        approved ? 1 : 0,
        req.user.id, comment, decision, id, project.closure_request_version);
    if (!result.changes) return false;
    await recordClosureEvent(tx, req, project, approved ? 'project_closed' : 'closure_rejected', message, project.closure_request_version);
    team = await notifyClosure(tx, req, project, `project.closure_${decision}`, `${approved ? 'Closure approved' : 'Revision requested'}: ${project.title}`, message);
    return true;
  });
  if (changed) alertClosure(team, `${approved ? '✅ Closure approved' : '↩️ Revision requested'}: ${project.title}`, message, project);
  if (!changed) return res.status(409).json({ error: 'This closure request has changed. Reload before reviewing.', code: 'CLOSURE_CONFLICT' });
  await logAudit(db, req, 'project', id, project.title, `closure_${decision}`, comment);
  notifyShared('project_closure_decided', { title: approved ? '✅ Project closed' : '↩️ Project closure returned', body: message,
    facts: [{ name: 'Project', value: project.title }, { name: approved ? 'Approved by' : 'Returned by', value: req.user.name }] });
  if (approved) await notifyPendingScores(id, project.title);
  res.json({ ok: true });
}

// Hand a closure request to one reviewer (or back to all with user_id null); E04.
router.post('/:id/closure-delegate', requireManager, requireProjectId, async (req, res) => {
  const userId = req.body?.user_id === null ? null : Number(req.body?.user_id);
  if (userId !== null && (!Number.isSafeInteger(userId) || userId < 1)) return res.status(400).json({ error: 'user_id must be a reviewer or null' });
  const result = await approvals.delegate('closure', Number(req.params.id), userId, { by: req.user });
  if (result.error) return res.status(result.status).json({ error: result.error });
  await logAudit(db, req, 'project', result.item.id, result.item.title, 'closure_delegated', result.delegate ? `to ${result.delegate.name}` : 'to any reviewer');
  res.json({ ok: true, assigned_to: result.delegate?.id ?? null });
});

router.post('/:id/approve-closure', requireManager, (req, res) => reviewClosure(req, res, 'approved'));
router.post('/:id/reject-closure', requireManager, (req, res) => reviewClosure(req, res, 'rejected'));

router.post('/:id/status-update', requireAuth, async (req, res) => {
  if (req.user.role === 'pm') return res.status(403).json({ error: 'Forbidden — PMs have read-only access to projects' });
  const { message } = req.body;
  if (typeof message !== 'string' || !message.trim()) return res.status(400).json({ error: 'Message required' });
  if (message.length > 2000) return res.status(400).json({ error: 'Message cannot exceed 2000 characters' });
  // Non-managers must be assigned to the project
  const p = await db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'manager') {
    const assigned = (await db.prepare('SELECT 1 FROM project_assignments WHERE project_id = ? AND user_id = ?').get(req.params.id, req.user.id));
    if (!assigned) return res.status(403).json({ error: 'Forbidden — you are not assigned to this project' });
  }
  (await db.prepare('INSERT INTO project_status_updates (project_id, user_id, message) VALUES (?, ?, ?)').run(req.params.id, req.user.id, message));
  logActivity(req.params.id, req.user.id, 'status_update', message.slice(0, 80));
  res.json({ ok: true });
});

router.post('/:id/members', requireManager, async (req, res) => {
  const { user_ids } = req.body;
  if (!Array.isArray(user_ids) || user_ids.length === 0)
    return res.status(400).json({ error: 'user_ids array required' });
  const pid = req.params.id;
  const project = (await db.prepare('SELECT title, deadline, priority FROM projects WHERE id = ?').get(pid));
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const normalized = normalizeIdList(user_ids, 'user_ids');
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  const engineerMap = await loadEngineerMap(normalized.ids);
  if (Object.keys(engineerMap).length !== normalized.ids.length)
    return res.status(400).json({ error: 'user_ids may only include active engineers' });

  const ins = db.prepare('INSERT INTO project_assignments (project_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING');
  for (const uid of normalized.ids) {
    const result = await ins.run(pid, uid);
    if (result.changes > 0) {
      const engineer = engineerMap[uid];
      logActivity(pid, req.user.id, 'member_added', engineer.name);
      notify('project.assigned', {
        engineer_id:    uid,
        engineer_name:  engineer.name,
        engineer_email: engineer.email,
        project_id:     parseInt(pid),
        project_title:  project.title,
        deadline:       project.deadline || null,
        priority:       project.priority,
      });
    }
  }
  res.json({ ok: true });
});

router.delete('/:id/members/:uid', requireManager, async (req, res) => {
  const engineer = (await db.prepare('SELECT name FROM users WHERE id = ?').get(req.params.uid));
  (await db.prepare('DELETE FROM project_assignments WHERE project_id = ? AND user_id = ?').run(req.params.id, req.params.uid));
  if (engineer) logActivity(req.params.id, req.user.id, 'member_removed', engineer.name);
  res.json({ ok: true });
});

router.use((error, req, res, next) => {
  if (error.code === '23503') return res.status(409).json({ error: 'A linked record prevents this change. Projects converted from recommendations must keep their customer relationship.' });
  next(error);
});

module.exports = router;
