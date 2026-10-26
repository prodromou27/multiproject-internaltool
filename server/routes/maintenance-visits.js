const router  = require('express').Router();
const { notifyShared, notifyUser } = require('../notifications');
const multer  = require('multer');
const ExcelJS = require('exceljs');
const db = require('../db');
const { sentVersion, conflict } = require('../editVersion');
const { requireAuth, requireManager, requireManagerOrPlanner, requireDownloadManagerOrPlanner } = require('../middleware/auth');
const { notify } = require('../notifications');
const { safeCell } = require('../xlsxSafety');
const { decrypt } = require('../fieldCipher');
const { visitInvite, inviteFileName } = require('../visitInvite');
const { maintenanceVisitFilters, searchMaintenanceVisits } = require('../maintenanceVisitFilters');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── Helpers ──────────────────────────────────────────────────────────────────
const BASE_SELECT = `
  SELECT mv.*,
    c.name as customer_name, c.contact_name, c.contact_email, c.contact_phone,
    cb.name as created_by_name,
    rs.name as report_sent_by_name,
    rc.name as report_sent_to_customer_by_name
  FROM maintenance_visits mv
  JOIN customers c ON mv.customer_id = c.id
  LEFT JOIN users cb ON mv.created_by = cb.id
  LEFT JOIN users rs ON mv.report_sent_by = rs.id
  LEFT JOIN users rc ON mv.report_sent_to_customer_by = rc.id`;

// Parse the CSV of engineer IDs into an array of numbers, and decrypt
// any customer PII fields that came through the JOIN as ciphertext.
function parseEngIds(row) {
  return {
    ...row,
    customer_name:  decrypt(row.customer_name),
    contact_name:  decrypt(row.contact_name),
    contact_email: decrypt(row.contact_email),
    contact_phone: decrypt(row.contact_phone),
    engineer_ids: [],engineer_names: '',
    asset_ids: [],
    contract_ids: [],contract_references: '',
    checklist: parseChecklist(row.checklist),
  };
}
function parseChecklist(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

// A visit's checklist as sent by the form, checked: { value } or { error }.
function checklistInput(body) {
  const c = body?.checklist;
  if (c === null) return { value: null };
  if (!c || typeof c !== 'object' || typeof c.name !== 'string' || !c.name.trim() || c.name.length > 120 || !Array.isArray(c.items) || !c.items.length || c.items.length > 50)
    return { error: 'A checklist needs a name and 1 to 50 checks' };
  const items = [];
  for (const item of c.items) {
    if (!item || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 200) return { error: 'Each check needs text of up to 200 characters' };
    if (item.note != null && (typeof item.note !== 'string' || item.note.length > 1000)) return { error: 'Notes may have up to 1000 characters' };
    if (!['open', 'ok', 'issue', 'na'].includes(item.result ?? 'open')) return { error: 'A check is ok, an issue, not applicable or still open' };
    items.push({ text: item.text.trim(), result: item.result ?? 'open', note: item.note?.trim() || null });
  }
  return { value: { name: c.name.trim(), items } };
}

// Replace the full engineer set for a visit (within an existing transaction or standalone),
// marking at most one of them its supervisor. Always coerces IDs to positive integers —
// rejects anything that doesn't parse cleanly.
async function replaceEngineers(visitId, engineerIds, supervisorId, tx) {
  if (!tx) return db.transaction(client => replaceEngineers(visitId, engineerIds, supervisorId, client));
  await tx.prepare('DELETE FROM maintenance_visit_engineers WHERE visit_id = ?').run(visitId);
  const ins = tx.prepare('INSERT INTO maintenance_visit_engineers (visit_id, user_id, is_supervisor) VALUES (?, ?, ?) ON CONFLICT DO NOTHING');
  for (const uid of engineerIds || []) await ins.run(visitId, uid, uid === supervisorId ? 1 : 0);
}

// supervisor_id: must be one of the visit's (about to be saved) engineer_ids, or empty/null for none.
function validateSupervisorId(value, engineerIds) {
  if (value === undefined || value === null || value === '') return { value: null };
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) return { error: 'supervisor_id must be a positive integer' };
  if (!(engineerIds || []).includes(id)) return { error: 'supervisor_id must be one of the assigned engineers' };
  return { value: id };
}

async function isAssignedEngineer(visitId, userId) {
  return !!(await db.prepare('SELECT 1 FROM maintenance_visit_engineers WHERE visit_id = ? AND user_id = ?').get(visitId, userId));
}

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}

function validateVisitText(body) {
  for (const field of ['notes', 'description']) {
    if (body[field] != null && (typeof body[field] !== 'string' || body[field].length > 10000))
      return `${field} must be text of at most 10000 characters`;
  }
  return null;
}

async function validateCustomerId(customerId) {
  const id = Number(customerId);
  if (!Number.isInteger(id) || id <= 0) return { error: 'customer_id must be a positive integer' };
  const customer = await db.prepare('SELECT id, name FROM customers WHERE id = ?').get(id);
  if (!customer) return { error: 'customer_id does not exist' };
  return { id, customer };
}

async function validateEngineerIds(values) {
  if (values === undefined) return { ids: undefined, engineers: {} };
  if (!Array.isArray(values)) return { error: 'engineer_ids must be an array' };
  if (values.length > 100) return { error: 'engineer_ids cannot contain more than 100 entries' };
  const ids = [...new Set(values.map(v => Number(v)).filter(Number.isInteger).filter(v => v > 0))];
  if (ids.length !== values.length) return { error: 'engineer_ids must contain only positive integer IDs' };
  if (!ids.length) return { ids, engineers: {} };
  const placeholders = ids.map(() => '?').join(',');
  const engineers = {};
  (await db.prepare(`SELECT id, name, email FROM users WHERE id IN (${placeholders}) AND role='engineer' AND active=1`).all(...ids))
    .forEach(e => { engineers[e.id] = e; });
  if (Object.keys(engineers).length !== ids.length)
    return { error: 'engineer_ids may only include active engineers' };
  return { ids, engineers };
}

async function validateAssetIds(values,customerId) {
  if (values===undefined) return { ids:undefined };
  if (!Array.isArray(values) || values.length>100 || values.some(id => !Number.isSafeInteger(id) || id<1) || new Set(values).size!==values.length) return { error:'asset_ids must contain at most 100 unique positive integer IDs' };
  if (values.length) {
    const rows=await db.prepare(`SELECT id FROM customer_assets WHERE customer_id=? AND id IN (${values.map(() => '?').join(',')})`).all(customerId,...values);
    if (rows.length!==values.length) return { error:'Every selected asset must belong to the visit customer' };
  }
  return { ids:values };
}
async function replaceAssets(visitId,customerId,assetIds,tx) {
  await tx.prepare('DELETE FROM maintenance_visit_assets WHERE visit_id=?').run(visitId);
  for (const assetId of assetIds || []) await tx.prepare('INSERT INTO maintenance_visit_assets (visit_id,asset_id,customer_id) VALUES (?,?,?)').run(visitId,assetId,customerId);
}

// A visit can combine work covered by more than one of the customer's contracts.
async function validateContractIds(values,customerId) {
  if (values===undefined) return { ids:undefined };
  if (!Array.isArray(values) || values.length>20 || values.some(id => !Number.isSafeInteger(id) || id<1) || new Set(values).size!==values.length) return { error:'contract_ids must contain at most 20 unique positive integer IDs' };
  if (values.length) {
    const rows=await db.prepare(`SELECT id FROM customer_contracts WHERE customer_id=? AND id IN (${values.map(() => '?').join(',')})`).all(customerId,...values);
    if (rows.length!==values.length) return { error:'Every selected contract must belong to the visit customer' };
  }
  return { ids:values };
}
async function replaceContracts(visitId,customerId,contractIds,tx) {
  await tx.prepare('DELETE FROM maintenance_visit_contracts WHERE visit_id=?').run(visitId);
  for (const contractId of contractIds || []) await tx.prepare('INSERT INTO maintenance_visit_contracts (visit_id,contract_id,customer_id) VALUES (?,?,?)').run(visitId,contractId,customerId);
}

// Convert an ExcelJS cell value to string, handling dates and rich text.
function cellToString(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object' && v.richText) return v.richText.map(rt => rt.text || '').join('');
  if (typeof v === 'object' && v.formula !== undefined) return cellToString(v.result);
  return String(v);
}

// Equivalent of XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false }).
// Returns an array of plain objects keyed by the first-row headers.
function sheetToJson(worksheet) {
  if (!worksheet || worksheet.rowCount < 2) return [];
  const headerRow = worksheet.getRow(1);
  const maxCol = headerRow.cellCount;
  const headers = [];
  for (let c = 1; c <= maxCol; c++) {
    headers[c] = cellToString(headerRow.getCell(c).value);
  }
  const rows = [];
  for (let r = 2; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const obj = {};
    for (let c = 1; c <= maxCol; c++) {
      if (!headers[c]) continue;
      obj[headers[c]] = cellToString(row.getCell(c).value);
    }
    rows.push(obj);
  }
  return rows;
}

// ── List ─────────────────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const filters = maintenanceVisitFilters(req.query, req.user);
  if (filters.error) return res.status(400).json({ error: filters.error });
  res.json(await filteredVisits(filters));
});

async function filteredVisits(filters) {
  const rows = (await db.prepare(BASE_SELECT + ` WHERE ${filters.where} ORDER BY mv.scheduled_date ASC, mv.id ASC`).all(...filters.params)).map(parseEngIds);
  return enrichVisitLinks(searchMaintenanceVisits(rows, filters.search));
}

async function enrichVisitLinks(rows) {
  if (!rows.length) return rows;
  const placeholders=rows.map(() => '?').join(','),ids=rows.map(row => row.id);
  const [links,engineers,contracts]=await Promise.all([
    db.prepare(`SELECT visit_id,asset_id FROM maintenance_visit_assets WHERE visit_id IN (${placeholders}) ORDER BY visit_id,asset_id`).all(...ids),
    db.prepare(`SELECT mve.visit_id,mve.user_id,u.name,mve.is_supervisor FROM maintenance_visit_engineers mve JOIN users u ON u.id=mve.user_id WHERE mve.visit_id IN (${placeholders}) ORDER BY mve.visit_id,u.name,u.id`).all(...ids),
    db.prepare(`SELECT mvc.visit_id,mvc.contract_id,ct.reference FROM maintenance_visit_contracts mvc JOIN customer_contracts ct ON ct.id=mvc.contract_id WHERE mvc.visit_id IN (${placeholders}) ORDER BY mvc.visit_id,ct.id`).all(...ids),
  ]);
  const byVisit=new Map();for(const link of links) { if(!byVisit.has(link.visit_id)) byVisit.set(link.visit_id,[]);byVisit.get(link.visit_id).push(link.asset_id); }
  const engineerMap=new Map();for(const engineer of engineers) { if(!engineerMap.has(engineer.visit_id)) engineerMap.set(engineer.visit_id,[]);engineerMap.get(engineer.visit_id).push(engineer); }
  const contractMap=new Map();for(const contract of contracts) { if(!contractMap.has(contract.visit_id)) contractMap.set(contract.visit_id,[]);contractMap.get(contract.visit_id).push(contract); }
  return rows.map(row => {
    const assigned=engineerMap.get(row.id) || [];
    const linkedContracts=contractMap.get(row.id) || [];
    const supervisor=assigned.find(item => item.is_supervisor);
    return { ...row,asset_ids:byVisit.get(row.id) || [],
      engineer_ids:assigned.map(item => item.user_id),engineer_names:assigned.map(item => item.name).join(', '),
      supervisor_id:supervisor ? supervisor.user_id : null,supervisor_name:supervisor ? supervisor.name : null,
      contract_ids:linkedContracts.map(item => item.contract_id),
      contract_references:linkedContracts.map(item => decrypt(item.reference)).join(', ') };
  });
}

// Export uses the same authorized selection and stable order as the list.
router.get('/export', requireDownloadManagerOrPlanner, async (req, res) => {
  const filters = maintenanceVisitFilters(req.query, req.user);
  if (filters.error) return res.status(400).json({ error: filters.error });
  const rows = await filteredVisits(filters);
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Visits');
  worksheet.addRow(['Title','Customer','Scheduled Date','Status','Engineers','Supervisor','Contracts','Report Status','Notes']);
  for (const row of rows) worksheet.addRow([
    safeCell(row.title), safeCell(row.customer_name || ''), row.scheduled_date || '', safeCell(row.status),
    safeCell(row.engineer_names || ''), safeCell(row.supervisor_name || ''), safeCell(row.contract_references || ''),
    row.report_sent_to_customer ? 'Sent to PM' : row.report_sent ? 'Report Complete' : 'Pending', safeCell(row.notes || ''),
  ]);
  const buf = await workbook.xlsx.writeBuffer();
  res.setHeader('Content-Disposition', 'attachment; filename="maintenance-visits.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// ── Template download (before /:id) ─────────────────────────────────────────
router.get('/template/download', requireDownloadManagerOrPlanner, async (req, res) => {
  const workbook  = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Maintenance Visits');
  [
    ['customer_name*', 'title*', 'description', 'scheduled_date*', 'engineer_names', 'supervisor_name', 'contract_numbers', 'notes'],
    ['Acme Corp', 'Q1 Health Check', 'Annual review', '2026-03-15', 'Alice Engineer, Bob Smith', 'Alice Engineer', 'CTR-2026-001, CTR-2026-002', ''],
    ['Beta Ltd',  'Q2 Review',       '',              '2026-06-20', '',                           '',               '',                           'Pending assignment'],
  ].forEach(row => worksheet.addRow(row));
  [22, 22, 26, 16, 34, 20, 26, 30].forEach((w, i) => { worksheet.getColumn(i + 1).width = w; });
  const buf = await workbook.xlsx.writeBuffer();
  res.setHeader('Content-Disposition', 'attachment; filename="maintenance_visits_template.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

router.get('/assets/choices',requireManagerOrPlanner,async (req,res) => {
  const check=await validateCustomerId(req.query.customer_id);
  if (check.error) return res.status(400).json({ error:check.error });
  const rows=await db.prepare("SELECT id,name,asset_type,hostname,lifecycle_status FROM customer_assets WHERE customer_id=? AND lifecycle_status IN ('active','spare') ORDER BY id LIMIT 501").all(check.id);
  if (rows.length>500) return res.status(413).json({ error:'This customer has more than 500 active assets; retire unused records before scheduling them' });
  res.json(rows.map(row => ({ ...row,name:decrypt(row.name),hostname:decrypt(row.hostname) })));
});

router.get('/contracts/choices',requireManagerOrPlanner,async (req,res) => {
  const check=await validateCustomerId(req.query.customer_id);
  if (check.error) return res.status(400).json({ error:check.error });
  const rows=await db.prepare('SELECT id,reference,description,start_date,end_date FROM customer_contracts WHERE customer_id=? ORDER BY end_date DESC LIMIT 501').all(check.id);
  if (rows.length>500) return res.status(413).json({ error:'This customer has more than 500 contracts; archive old ones before scheduling against them' });
  res.json(rows.map(row => ({ ...row,reference:decrypt(row.reference),description:decrypt(row.description) })));
});

// ── Get single ───────────────────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  const mv = (await db.prepare(BASE_SELECT + ' WHERE mv.id = ?').get(req.params.id));
  if (!mv) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'engineer' && !await isAssignedEngineer(mv.id, req.user.id))
    return res.status(403).json({ error: 'Forbidden' });
  res.json((await enrichVisitLinks([parseEngIds(mv)]))[0]);
});

// ── Calendar invitation (.ics) for one visit ─────────────────────────────────
// The same people who can open the visit can add it to their calendar.
router.get('/:id/calendar.ics', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid visit ID' });
  const mv = await db.prepare('SELECT id, customer_id, title, description, notes, scheduled_date, status, updated_at FROM maintenance_visits WHERE id = ?').get(id);
  if (!mv) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'engineer' && !await isAssignedEngineer(mv.id, req.user.id)) return res.status(403).json({ error: 'Forbidden' });
  const customer = await db.prepare('SELECT name, address, location, contact_name, contact_phone, contact_email FROM customers WHERE id = ?').get(mv.customer_id) || {};
  const engineers = (await db.prepare('SELECT u.name FROM maintenance_visit_engineers mve JOIN users u ON u.id = mve.user_id WHERE mve.visit_id = ? ORDER BY u.name').all(mv.id)).map(row => row.name);
  const plain = Object.fromEntries(Object.entries(customer).map(([key, value]) => [key, value == null ? value : decrypt(value)]));
  const body = visitInvite({ visit: mv, customer: plain, engineers, appUrl: process.env.APP_URL || `${req.protocol}://${req.get('host')}` });
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${inviteFileName(mv)}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(body);
});

// ── Create ───────────────────────────────────────────────────────────────────
/* Before saving: what is wrong with this date, time and engineers (visitScheduling.js).
   The form shows these; saving rechecks, and hard ones need confirm_warnings. */
const { validateTimes, checkVisit } = require('../visitScheduling');
async function scheduleProblems(body, existing = null) {
  const times = validateTimes(body, existing || {});
  if (times.error) return { error: times.error };
  const engineerIds = body.engineer_ids !== undefined ? body.engineer_ids
    : existing ? (await db.prepare('SELECT user_id FROM maintenance_visit_engineers WHERE visit_id = ?').all(existing.id)).map(row => row.user_id) : [];
  const assetIds = body.asset_ids !== undefined ? body.asset_ids
    : existing ? (await db.prepare('SELECT asset_id FROM maintenance_visit_assets WHERE visit_id = ?').all(existing.id)).map(row => row.asset_id) : [];
  const warnings = await checkVisit({ id: existing?.id, customer_id: body.customer_id || existing?.customer_id, scheduled_date: body.scheduled_date || existing?.scheduled_date,
    ...times.value, engineer_ids: Array.isArray(engineerIds) ? engineerIds : [], asset_ids: Array.isArray(assetIds) ? assetIds : [] });
  return { times: times.value, warnings };
}
const needsConfirmation = (warnings, body) => warnings.some(w => w.severity === 'hard') && body.confirm_warnings !== true;

router.post('/check', requireManagerOrPlanner, async (req, res) => {
  if (!req.body || !isIsoDate(req.body.scheduled_date)) return res.status(400).json({ error: 'scheduled_date must be YYYY-MM-DD' });
  if (req.body.engineer_ids !== undefined && (!Array.isArray(req.body.engineer_ids) || req.body.engineer_ids.some(id => !Number.isSafeInteger(Number(id)))))
    return res.status(400).json({ error: 'engineer_ids must be a list of ids' });
  const existing = req.body.id ? await db.prepare('SELECT * FROM maintenance_visits WHERE id = ?').get(Number(req.body.id)) : null;
  const result = await scheduleProblems(req.body, existing);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ warnings: result.warnings });
});

router.post('/', requireManagerOrPlanner, async (req, res) => {
  const inputError = validateVisitText(req.body);
  if (inputError) return res.status(400).json({ error: inputError });
  const { customer_id, title, description, scheduled_date, engineer_ids, asset_ids, notes, contract_ids, supervisor_id } = req.body;
  if (!customer_id || !title || !scheduled_date)
    return res.status(400).json({ error: 'customer_id, title and scheduled_date are required' });
  if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'title is required' });
  if (title.trim().length > 500) return res.status(400).json({ error: 'title cannot exceed 500 characters' });
  if (!isIsoDate(scheduled_date)) return res.status(400).json({ error: 'scheduled_date must be YYYY-MM-DD' });
  const customerCheck = await validateCustomerId(customer_id);
  if (customerCheck.error) return res.status(400).json({ error: customerCheck.error });
  const engineerCheck = await validateEngineerIds(engineer_ids);
  if (engineerCheck.error) return res.status(400).json({ error: engineerCheck.error });
  const assetCheck=await validateAssetIds(asset_ids,customerCheck.id);
  if (assetCheck.error) return res.status(400).json({ error:assetCheck.error });
  const contractCheck = await validateContractIds(contract_ids,customerCheck.id);
  if (contractCheck.error) return res.status(400).json({ error: contractCheck.error });
  const supervisorCheck = validateSupervisorId(supervisor_id, engineerCheck.ids || []);
  if (supervisorCheck.error) return res.status(400).json({ error: supervisorCheck.error });
  const schedule = await scheduleProblems({ ...req.body, customer_id: customerCheck.id, engineer_ids: engineerCheck.ids || [], asset_ids: assetCheck.ids || [] });
  if (schedule.error) return res.status(400).json({ error: schedule.error });
  if (needsConfirmation(schedule.warnings, req.body))
    return res.status(409).json({ error: 'This visit needs a second look before it is saved', code: 'VISIT_CHECK', warnings: schedule.warnings });

  const visitId = await db.transaction(async tx => {
    const result = await tx.prepare(
      'INSERT INTO maintenance_visits (customer_id, title, description, scheduled_date, start_time, duration_minutes, notes, created_by) VALUES (?,?,?,?,?,?,?,?)'
    ).run(customerCheck.id, title.trim(), description || null, scheduled_date, schedule.times.start_time, schedule.times.duration_minutes, notes || null, req.user.id);

    await replaceEngineers(result.lastInsertRowid, engineerCheck.ids || [], supervisorCheck.value, tx);
    await replaceAssets(result.lastInsertRowid,customerCheck.id,assetCheck.ids || [],tx);
    await replaceContracts(result.lastInsertRowid,customerCheck.id,contractCheck.ids || [],tx);
    return result.lastInsertRowid;
  });

  if (engineerCheck.ids?.length) {
    if (engineerCheck.ids.length) {
      engineerCheck.ids.forEach(uid => {
        const eng = engineerCheck.engineers[uid];
        if (eng && customerCheck.customer) {
          notify('visit.assigned', {
            engineer_id: uid, engineer_name: eng.name, engineer_email: eng.email,
            visit_title: title.trim(), customer_name: decrypt(customerCheck.customer.name), scheduled_date,
          });
        }
      });
    }
  }

  res.json({ id: visitId });
});

// ── Import ───────────────────────────────────────────────────────────────────
// The workbook's rows: { rows, hash } or { error }.
async function readVisitWorkbook(file) {
  if (!file) return { error: 'No file uploaded' };
  const workbook = new ExcelJS.Workbook();
  try { require('../uploadUtils').assertSafeSpreadsheet(file.buffer); await workbook.xlsx.load(file.buffer); }
  catch (e) { return { error: e.status === 400 ? e.message : 'Could not parse file. Use .xlsx format' }; }
  const rows = sheetToJson(workbook.worksheets[0]);
  if (!rows.length) return { error: 'File is empty or has no data rows' };
  if (rows.length > 5000) return { error: 'Maximum 5000 rows per import. Please split your file.' };
  const normalize = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.replace(/\*/g, '').trim().toLowerCase().replace(/\s+/g, '_'),
    v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'string' ? v.trim() : String(v ?? '').trim()]));
  return { rows: rows.map(normalize), hash: require('crypto').createHash('sha256').update(file.buffer).digest('hex') };
}

// What importing would do: each row new, already there (same customer, title and day),
// or not imported with the reason; a visit on a day off is flagged but still planned.
async function planVisitImport(read, userId) {
  const { parseDay } = require('../customerImport');
  const calendar = require('../businessCalendar');
  const cal = await calendar.load();
  const customers = (await db.prepare('SELECT id, name FROM customers').all()).map(c => ({ id: Number(c.id), name: decrypt(c.name) || '' }));
  const users = await db.prepare("SELECT id, name, email FROM users WHERE role='engineer' AND active=1").all();
  const contracts = (await db.prepare('SELECT id, customer_id, reference FROM customer_contracts').all())
    .map(c => ({ id: Number(c.id), customer_id: Number(c.customer_id), reference: decrypt(c.reference) || '' }));
  const findCustomer = name => customers.find(c => c.name.toLowerCase() === name.toLowerCase()) || null;
  const findEngineer = q => users.find(u => u.name.toLowerCase() === q.toLowerCase() || (u.email || '').toLowerCase() === q.toLowerCase()) || null;
  const findContract = (customerId, number) => contracts.find(c => c.customer_id === customerId && c.reference.toLowerCase() === number.toLowerCase()) || null;
  const existing = new Set((await db.prepare('SELECT customer_id, title, scheduled_date FROM maintenance_visits').all())
    .map(v => `${v.customer_id}|${String(v.title).trim().toLowerCase()}|${String(v.scheduled_date).slice(0, 10)}`));
  const seen = new Set();
  const rows = read.rows.map((row, i) => {
    const rowNum = i + 2, base = { row: rowNum, name: row.title || '', values: row };
    const fail = (error, kind) => ({ ...base, action: 'error', error, kind });
    for (const field of ['customer_name', 'title', 'scheduled_date']) if (!row[field]) return fail(`Missing: ${field}`);
    const customer = findCustomer(row.customer_name);
    if (!customer) return fail(`Customer not found: "${row.customer_name}"`);
    const day = parseDay(row.scheduled_date);
    if (!day) return fail(`scheduled_date must be a date (YYYY-MM-DD or DD/MM/YYYY), not "${row.scheduled_date}"`);
    const engineers = [];
    for (const name of (row.engineer_names || row.engineer_name || '').split(',').map(x => x.trim()).filter(Boolean)) {
      const engineer = findEngineer(name);
      if (!engineer) return fail(`Engineer not found: "${name}"`);
      engineers.push(Number(engineer.id));
    }
    const supervisorName = row.supervisor_name || row.supervisor || '';
    let supervisorId = null;
    if (supervisorName) {
      const supervisor = findEngineer(supervisorName);
      if (!supervisor) return fail(`Supervisor not found: "${supervisorName}"`);
      if (!engineers.includes(Number(supervisor.id))) return fail(`Supervisor "${supervisorName}" must also be one of the assigned engineers`);
      supervisorId = Number(supervisor.id);
    }
    const contractIds = [];
    for (const number of (row.contract_numbers || row.contract_number || '').split(',').map(x => x.trim()).filter(Boolean)) {
      const contract = findContract(customer.id, number);
      if (!contract) return fail(`Contract not found for ${customer.name}: "${number}"`);
      contractIds.push(contract.id);
    }
    const key = `${customer.id}|${row.title.trim().toLowerCase()}|${day}`;
    if (existing.has(key)) return { ...base, action: 'unchanged', error: `Already there: ${customer.name}, ${day}` };
    if (seen.has(key)) return fail('The same customer, title and day appear earlier in the file', 'duplicate');
    seen.add(key);
    const off = calendar.dayOff(day, cal);
    return { ...base, action: 'create', warning: off ? (off.kind === 'holiday' ? `Public holiday: ${off.name}` : 'Not a working day') : null,
      value: { customer_id: customer.id, title: row.title, description: row.description || null, scheduled_date: day, notes: row.notes || null, engineers, supervisorId, contractIds } };
  });
  const count = action => rows.filter(r => r.action === action).length;
  const { last } = await db.prepare('SELECT MAX(id) AS last FROM maintenance_visits').get();
  const token = require('crypto').createHash('sha256').update(`${read.hash}|${userId}|${last || 0}`).digest('hex');
  return { rows, token, counts: { create: count('create'), update: 0, unchanged: count('unchanged'), errors: count('error'), duplicates: rows.filter(r => r.kind === 'duplicate').length, total: rows.length } };
}
const visitPreviewOf = plan => ({ token: plan.token, counts: plan.counts,
  rows: plan.rows.map(({ row, name, action, kind, error, warning, values }) => ({ row, name, action, kind, error: error || warning || undefined, values: action === 'create' ? undefined : values })) });

router.post('/import/preview', requireManagerOrPlanner, upload.single('file'), async (req, res) => {
  const read = await readVisitWorkbook(req.file);
  if (read.error) return res.status(400).json({ error: read.error });
  res.json(visitPreviewOf(await planVisitImport(read, req.user.id)));
});

router.post('/import', requireManagerOrPlanner, upload.single('file'), async (req, res) => {
  const read = await readVisitWorkbook(req.file);
  if (read.error) return res.status(400).json({ error: read.error });
  const plan = await planVisitImport(read, req.user.id);
  if (req.body?.preview_token && req.body.preview_token !== plan.token)
    return res.status(409).json({ error: 'The file or the visits changed since the review. Review the import again.', code: 'IMPORT_CHANGED', preview: visitPreviewOf(plan) });
  let imported = 0;
  const errors = plan.rows.filter(r => r.action !== 'create').map(r => ({ row: r.row, error: r.error }));
  // Each new visit on its own: one that fails is reported, the others go in.
  for (const row of plan.rows.filter(r => r.action === 'create')) {
    try {
      await db.transaction(async tx => {
        const created = await tx.prepare('INSERT INTO maintenance_visits (customer_id, title, description, scheduled_date, notes, created_by) VALUES (?,?,?,?,?,?)')
          .run(row.value.customer_id, row.value.title, row.value.description, row.value.scheduled_date, row.value.notes, req.user.id);
        for (const uid of row.value.engineers) await tx.prepare('INSERT INTO maintenance_visit_engineers (visit_id, user_id, is_supervisor) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
          .run(created.lastInsertRowid, uid, uid === row.value.supervisorId ? 1 : 0);
        for (const contractId of row.value.contractIds) await tx.prepare('INSERT INTO maintenance_visit_contracts (visit_id, contract_id, customer_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
          .run(created.lastInsertRowid, contractId, row.value.customer_id);
      });
      imported++;
    } catch (e) { errors.push({ row: row.row, error: e.message }); }
  }
  res.json({ imported, skipped: errors.length, errors });
});

// ── Update ───────────────────────────────────────────────────────────────────
router.put('/:id', requireAuth, async (req, res) => {
  const inputError = validateVisitText(req.body);
  if (inputError) return res.status(400).json({ error: inputError });
  const mv = (await db.prepare('SELECT * FROM maintenance_visits WHERE id = ?').get(req.params.id));
  if (!mv) return res.status(404).json({ error: 'Not found' });

  if (req.user.role === 'engineer') {
    if (!await isAssignedEngineer(mv.id, req.user.id)) return res.status(403).json({ error: 'Forbidden' });
    const { notes } = req.body;
    (await db.prepare(`UPDATE maintenance_visits SET notes=?, updated_at=app_now() WHERE id=?`).run(notes ?? mv.notes, mv.id));
    return res.json({ ok: true });
  }

  // Managers and planners can do full edits
  if (req.user.role !== 'manager' && req.user.role !== 'planner')
    return res.status(403).json({ error: 'Forbidden' });
  const version = sentVersion(req.body);
  if (version.error) return res.status(400).json({ error: version.error });
  if (version.value !== undefined && version.value !== Number(mv.edit_version)) return conflict(res, 'This visit', mv);

  const { customer_id, title, description, scheduled_date, engineer_ids, asset_ids, status, notes, contract_ids, supervisor_id } = req.body;
  const VALID_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'];
  if (status !== undefined && !VALID_STATUSES.includes(status))
    return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
  if (title !== undefined && (typeof title !== 'string' || !title.trim())) return res.status(400).json({ error: 'title cannot be empty' });
  if (typeof title === 'string' && title.trim().length > 500) return res.status(400).json({ error: 'title cannot exceed 500 characters' });
  if (scheduled_date !== undefined && !isIsoDate(scheduled_date)) return res.status(400).json({ error: 'scheduled_date must be YYYY-MM-DD' });
  let customerCheck = { id: customer_id };
  if (customer_id !== undefined) {
    customerCheck = customer_id === null || customer_id === ''
      ? { id: null }
      : await validateCustomerId(customer_id);
    if (customerCheck.error) return res.status(400).json({ error: customerCheck.error });
  }
  const engineerCheck = await validateEngineerIds(engineer_ids);
  if (engineerCheck.error) return res.status(400).json({ error: engineerCheck.error });
  let oldIds = [];
  const effectiveCustomer=customerCheck.id || mv.customer_id;
  const retainedAssets=asset_ids===undefined && customer_id!==undefined ? (await db.prepare('SELECT asset_id FROM maintenance_visit_assets WHERE visit_id=?').all(mv.id)).map(row => row.asset_id) : asset_ids;
  const assetCheck=await validateAssetIds(retainedAssets,effectiveCustomer);
  if (assetCheck.error) return res.status(400).json({ error:assetCheck.error });
  const retainedContracts=contract_ids===undefined && customer_id!==undefined ? (await db.prepare('SELECT contract_id FROM maintenance_visit_contracts WHERE visit_id=?').all(mv.id)).map(row => row.contract_id) : contract_ids;
  const contractCheck = await validateContractIds(retainedContracts,effectiveCustomer);
  if (contractCheck.error) return res.status(400).json({ error: contractCheck.error });
  const existingSupervisorId = (await db.prepare('SELECT user_id FROM maintenance_visit_engineers WHERE visit_id = ? AND is_supervisor = 1').get(mv.id))?.user_id ?? null;
  const effectiveEngineerIds = engineerCheck.ids !== undefined ? engineerCheck.ids
    : (await db.prepare('SELECT user_id FROM maintenance_visit_engineers WHERE visit_id = ?').all(mv.id)).map(r => Number(r.user_id));
  // supervisor_id unset: keep the current supervisor, if they are still assigned.
  const supervisorInput = supervisor_id !== undefined ? supervisor_id
    : (existingSupervisorId != null && effectiveEngineerIds.includes(Number(existingSupervisorId)) ? existingSupervisorId : null);
  const supervisorCheck = validateSupervisorId(supervisorInput, effectiveEngineerIds);
  if (supervisorCheck.error) return res.status(400).json({ error: supervisorCheck.error });
  // A change of day, time or engineers is checked again; a hard problem needs confirm_warnings.
  const rescheduled = ['scheduled_date', 'start_time', 'duration_minutes', 'engineer_ids'].some(key => req.body[key] !== undefined);
  const schedule = await scheduleProblems({ ...req.body, customer_id: effectiveCustomer, engineer_ids: engineerCheck.ids, asset_ids: assetCheck.ids }, mv);
  if (schedule.error) return res.status(400).json({ error: schedule.error });
  if (rescheduled && status !== 'cancelled' && needsConfirmation(schedule.warnings, req.body))
    return res.status(409).json({ error: 'This visit needs a second look before it is saved', code: 'VISIT_CHECK', warnings: schedule.warnings });
  const saved = await db.transaction(async tx => {
    await tx.prepare('SELECT id FROM maintenance_visits WHERE id = ? FOR UPDATE').get(mv.id);
    const result = await tx.prepare(`UPDATE maintenance_visits SET
      customer_id=COALESCE(?,customer_id), title=COALESCE(?,title),
      description=COALESCE(?,description), scheduled_date=COALESCE(?,scheduled_date),
      start_time=?, duration_minutes=?,
      status=COALESCE(?,status), notes=COALESCE(?,notes), edit_version=edit_version+1, updated_at=app_now() WHERE id=? AND edit_version=?`)
      .run(customerCheck.id, title?.trim() || null, description, scheduled_date, schedule.times.start_time, schedule.times.duration_minutes, status, notes, mv.id, mv.edit_version);
    if (!result.changes) return false;
    if (engineerCheck.ids !== undefined) {
      oldIds = (await tx.prepare('SELECT user_id FROM maintenance_visit_engineers WHERE visit_id = ?').all(mv.id)).map(r => r.user_id);
      await replaceEngineers(mv.id, engineerCheck.ids, supervisorCheck.value, tx);
    } else if (supervisor_id !== undefined && supervisorCheck.value !== existingSupervisorId) {
      // Supervisor changed without touching the engineer list: flip the flag on the two rows that matter.
      await tx.prepare('UPDATE maintenance_visit_engineers SET is_supervisor = 0 WHERE visit_id = ?').run(mv.id);
      if (supervisorCheck.value != null) await tx.prepare('UPDATE maintenance_visit_engineers SET is_supervisor = 1 WHERE visit_id = ? AND user_id = ?').run(mv.id, supervisorCheck.value);
    }
    if (contractCheck.ids !== undefined) await replaceContracts(mv.id, effectiveCustomer, contractCheck.ids, tx);
    if (assetCheck.ids!==undefined) await replaceAssets(mv.id,effectiveCustomer,assetCheck.ids,tx);
    return true;
  });
  if (saved === false) return conflict(res, 'This visit', await db.prepare('SELECT * FROM maintenance_visits WHERE id = ?').get(mv.id));
  if (engineerCheck.ids !== undefined) {
    // Notify newly added engineers
    const newIds = engineerCheck.ids.filter(id => !oldIds.includes(id));
    if (newIds.length) {
      const customer = customerCheck.customer || (await db.prepare('SELECT name FROM customers WHERE id = ?').get(mv.customer_id));
      newIds.forEach(uid => {
        const eng = engineerCheck.engineers[uid];
        if (eng && customer) {
          notify('visit.assigned', {
            engineer_id: uid, engineer_name: eng.name, engineer_email: eng.email,
            visit_title: title || mv.title,
            customer_name: decrypt(customer.name),
            scheduled_date: scheduled_date || mv.scheduled_date,
          });
        }
      });
    }
  }

  res.json({ ok: true });
});

// ── Report sent / unsent ─────────────────────────────────────────────────────
router.post('/:id/report-sent', requireAuth, async (req, res) => {
  const mv = (await db.prepare('SELECT * FROM maintenance_visits WHERE id = ?').get(req.params.id));
  if (!mv) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'engineer' && !await isAssignedEngineer(mv.id, req.user.id))
    return res.status(403).json({ error: 'Forbidden' });
  if (!['manager', 'planner', 'engineer'].includes(req.user.role))
    return res.status(403).json({ error: 'Forbidden' });
  if (mv.status === 'cancelled') return res.status(400).json({ error: 'Cannot submit a report for a cancelled visit' });
  const changed = (await db.prepare(`UPDATE maintenance_visits SET report_sent=1, report_sent_at=app_now(), report_sent_by=?, updated_at=app_now()
    WHERE id=? AND report_sent=0 AND status <> 'cancelled'`)
    .run(req.user.id, mv.id));
  if (!changed.changes) return res.json({ ok: true });
  // Notify all managers that a report was submitted
  const customer = (await db.prepare('SELECT name FROM customers WHERE id = ?').get(mv.customer_id));
  notify('report.submitted', {
    engineer_name: req.user.name,
    visit_title:   mv.title,
    customer_name: customer ? decrypt(customer.name) : '—',
  });
  res.json({ ok: true });
});

router.post('/:id/report-unsent', requireManager, async (req, res) => {
  const mv = (await db.prepare('SELECT id FROM maintenance_visits WHERE id = ?').get(req.params.id));
  if (!mv) return res.status(404).json({ error: 'Not found' });
  (await db.prepare(`UPDATE maintenance_visits SET
    status=CASE WHEN report_sent_to_customer=1 AND status='completed' THEN 'in_progress' ELSE status END,
    report_sent=0, report_sent_at=NULL, report_sent_by=NULL,
    report_sent_to_customer=0, report_sent_to_customer_at=NULL, report_sent_to_customer_by=NULL,
    updated_at=app_now() WHERE id=?`).run(mv.id));
  res.json({ ok: true });
});

// ── Report sent to customer / undo (manager or planner) ──────────────────────
router.post('/:id/report-customer-sent', requireManagerOrPlanner, async (req, res) => {
  const mv = (await db.prepare('SELECT * FROM maintenance_visits WHERE id = ?').get(req.params.id));
  if (!mv) return res.status(404).json({ error: 'Not found' });
  if (!mv.report_sent) return res.status(400).json({ error: 'Report must be marked sent by engineer first' });
  if (mv.status === 'cancelled') return res.status(400).json({ error: 'Cannot forward a report for a cancelled visit' });
  if (mv.report_sent_to_customer) return res.json({ ok: true });
  const changed = (await db.prepare(`UPDATE maintenance_visits SET
      report_sent_to_customer=1,
      report_sent_to_customer_at=app_now(),
      report_sent_to_customer_by=?,
      status='completed',
      updated_at=app_now()
    WHERE id=? AND report_sent=1 AND report_sent_to_customer=0 AND status <> 'cancelled'`)
    .run(req.user.id, mv.id));
  if (!changed.changes) return res.status(409).json({ error: 'Visit report changed. Refresh before forwarding.' });
  const visitCustomer = await db.prepare('SELECT name FROM customers WHERE id = ?').get(mv.customer_id);
  notifyShared('visit_report_approved', { title: '📄 Visit report approved', body: `The report for **${mv.title}** was approved and sent on by ${req.user.name}.`,
    facts: [{ name: 'Visit', value: mv.title }, { name: 'Customer', value: decrypt(visitCustomer?.name) || '—' }, { name: 'Date', value: mv.scheduled_date }] });
  const engineers = await db.prepare('SELECT user_id FROM maintenance_visit_engineers WHERE visit_id = ? AND user_id <> ?').all(mv.id, req.user.id);
  for (const { user_id } of engineers) notifyUser(user_id, 'visit_report_approved', { title: '📄 Your visit report was approved', body: `The report for **${mv.title}** was approved and sent on by ${req.user.name}.`,
    facts: [{ name: 'Customer', value: decrypt(visitCustomer?.name) || '—' }, { name: 'Date', value: mv.scheduled_date }] },
  { title: 'Visit report approved', body: mv.title, link: '/maintenance-visits' }).catch(error => console.error('[visit report alert]', error.message));
  res.json({ ok: true });
});

router.post('/:id/report-customer-unsent', requireManagerOrPlanner, async (req, res) => {
  // Revert customer-sent flag; restore status to in_progress so it can be actioned again
  const mv = (await db.prepare('SELECT status FROM maintenance_visits WHERE id = ?').get(req.params.id));
  if (!mv) return res.status(404).json({ error: 'Not found' });
  (await db.prepare(`UPDATE maintenance_visits SET
      report_sent_to_customer=0,
      report_sent_to_customer_at=NULL,
      report_sent_to_customer_by=NULL,
      status=CASE WHEN report_sent_to_customer=1 AND status='completed' THEN 'in_progress' ELSE status END,
      updated_at=app_now()
    WHERE id=?`).run(req.params.id));
  res.json({ ok: true });
});

// ── Mark as completed (PM, manager, or planner) ─────────────────────────────
// The engineers on the visit (and managers and planners) record the checklist (E03).
router.put('/:id/checklist', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid visit ID' });
  const mv = await db.prepare('SELECT id, status, title FROM maintenance_visits WHERE id = ?').get(id);
  if (!mv) return res.status(404).json({ error: 'Not found' });
  const allowed = ['manager', 'planner'].includes(req.user.role) || (req.user.role === 'engineer' && await isAssignedEngineer(id, req.user.id));
  if (!allowed) return res.status(403).json({ error: 'Only the engineers on this visit can fill in its checklist' });
  if (mv.status === 'cancelled') return res.status(400).json({ error: 'This visit was cancelled' });
  const checked = checklistInput(req.body);
  if (checked.error) return res.status(400).json({ error: checked.error });
  const value = checked.value && { ...checked.value, updated_at: new Date().toISOString(), updated_by: req.user.name };
  await db.prepare('UPDATE maintenance_visits SET checklist = ?, updated_at = app_now() WHERE id = ?').run(value ? JSON.stringify(value) : null, id);
  res.json({ checklist: value });
});

router.post('/:id/complete', requireAuth, async (req, res) => {
  const { role } = req.user;
  if (!['manager', 'planner', 'pm'].includes(role))
    return res.status(403).json({ error: 'Forbidden' });
  const mv = (await db.prepare('SELECT * FROM maintenance_visits WHERE id = ?').get(req.params.id));
  if (!mv) return res.status(404).json({ error: 'Not found' });
  if (mv.status === 'cancelled') return res.status(400).json({ error: 'Cannot complete a cancelled visit' });
  if (mv.status === 'completed') return res.json({ ok: true }); // idempotent
  const changed = (await db.prepare(`UPDATE maintenance_visits SET status='completed', updated_at=app_now()
    WHERE id=? AND status <> 'cancelled'`).run(mv.id));
  if (!changed.changes) return res.status(409).json({ error: 'Visit was cancelled before completion' });
  res.json({ ok: true });
});

// ── Delete ───────────────────────────────────────────────────────────────────
// For good, with its engineers, assets and report; recommendations raised on it are kept.
router.delete('/:id', requireManagerOrPlanner, async (req, res) => {
  if (!/^[1-9]\d*$/.test(String(req.params.id))) return res.status(400).json({ error: 'Invalid visit ID' });
  const visit = await db.prepare('SELECT id, title FROM maintenance_visits WHERE id = ?').get(Number(req.params.id));
  if (!visit) return res.json({ ok: true });
  await db.transaction(async tx => {
    await require('../auditLog').logAudit(tx, req, 'maintenance_visit', visit.id, visit.title, 'visit_deleted', null);
    await require('../permanentDelete').deleteVisits(tx, [visit.id]);
  });
  res.json({ ok: true });
});

router.use((error, req, res, next) => {
  if (error.code === '23503') return res.status(409).json({ error: 'A linked recommendation, customer asset or related record prevents this change. Reload and preserve the existing customer relationship.' });
  next(error);
});

module.exports = router;
