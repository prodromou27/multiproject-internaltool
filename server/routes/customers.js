const { contractsFor, currentContract } = require('../customerContracts');
const { COLUMNS: IMPORT_COLUMNS, parseCsv, importCustomers, planCustomerImport, previewOf } = require('../customerImport');
const router  = require('express').Router();
const multer  = require('multer');
const ExcelJS = require('exceljs');
const db = require('../db');
const { logAudit } = require('../auditLog');
const { requireAuth, requireManager, requireManagerOrPlanner, requirePermission } = require('../middleware/auth');
const { encryptCustomer, decryptCustomer } = require('../fieldCipher');
const { canAccessCustomer,positiveId }=require('../customerAccess');
const { sentVersion, conflict }=require('../editVersion');
const { parseCustomerListQuery,customerListPage }=require('../customerDirectory');
const { candidateCustomerIds,candidateCustomerNameIds,replaceCustomerSearchDocument }=require('../customerSearchIndex');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
router.use('/:id/overview', require('./customer-overview'));
router.use('/:id/recommendations', require('./customer-recommendations'));
router.use('/:id/assets', require('./customer-assets'));
router.use('/:id/contracts', require('./customer-contracts'));
router.use('/:id/licences', require('./customer-licences'));
router.use('/:id/vendor-cases', require('./customer-vendor-cases'));
router.use('/:id/managed-services', require('./managedCustomerConfiguration'));
router.use('/:id/operations',require('./customer-operations'));
router.use('/:id/recurring-tasks', require('./customer-recurring-tasks'));

function cellToString(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object' && v.richText) return v.richText.map(rt => rt.text || '').join('');
  if (typeof v === 'object' && v.formula !== undefined) return cellToString(v.result);
  return String(v);
}

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

router.get('/', requireAuth, async (req, res) => {
  const listQuery=parseCustomerListQuery(req.query);
  if (listQuery.error) return res.status(400).json({ error:listQuery.error });
  const candidates=listQuery.paged && listQuery.search ? await candidateCustomerIds(db,listQuery.search) : null;
  // Engineers see the customers they work with: their visits, projects, direct
  // assignments and their teams' customers (the same as canAccessCustomer), with
  // the same details as managers (managed, contract, status) for those customers.
  let allowed = null;
  if (req.user.role === 'engineer') {
    allowed = new Set((await db.prepare(`
      SELECT mv.customer_id FROM maintenance_visits mv
      JOIN maintenance_visit_engineers mve ON mve.visit_id = mv.id
      WHERE mve.user_id = ?
      UNION
      SELECT p.customer_id FROM projects p
      JOIN project_assignments pa ON pa.project_id = p.id
      WHERE pa.user_id = ? AND p.customer_id IS NOT NULL
      UNION
      SELECT ce.customer_id FROM customer_engineers ce WHERE ce.user_id = ?
      UNION
      SELECT ct.customer_id FROM customer_teams ct JOIN team_members tm ON tm.team_id = ct.team_id WHERE tm.user_id = ?
    `).all(req.user.id, req.user.id, req.user.id, req.user.id)).map(row => Number(row.customer_id)));
  }
  const managed = new Set((await db.prepare('SELECT customer_id FROM managed_customer_configurations WHERE managed_services_enabled = 1').all()).map(row => Number(row.customer_id)));
  const visits = new Map((await db.prepare('SELECT customer_id, COUNT(*) AS n FROM maintenance_visits GROUP BY customer_id').all()).map(row => [Number(row.customer_id), Number(row.n)]));
  const rows = (await db.prepare(`SELECT c.*, u.name as created_by_name
    FROM customers c LEFT JOIN users u ON c.created_by = u.id ORDER BY c.name`).all()).filter(row => !allowed || allowed.has(Number(row.id)))
    .map(row => ({ ...row, visit_count: visits.get(Number(row.id)) || 0, is_managed: managed.has(Number(row.id)) }));
  // Each customer's current contract (the one in force, else the next or the last).
  const contracts = await contractsFor();
  for (const row of rows) {
    const own = contracts.filter(c => c.customer_id === Number(row.id));
    const current = currentContract(own);
    row.current_contract = current && { id: current.id, reference: current.reference, description: current.description, service_level: current.service_level,
      start_date: current.start_date, end_date: current.end_date, status: current.status, days_left: current.days_left };
    // The customer's other contracts in force, shown as "+N more" beside the current one.
    row.other_active_contracts = own.filter(c => c.id !== current?.id && ['active', 'ending_soon'].includes(c.status))
      .sort((a, b) => a.end_date.localeCompare(b.end_date))
      .map(c => ({ id: c.id, reference: c.reference || c.description || `Contract #${c.id}`, end_date: c.end_date }));
  }
  // In-house infrastructure first, then by name.
  const visible=(candidates ? rows.filter(row => candidates.has(Number(row.id))) : rows).map(decryptCustomer)
    .sort((a, b) => (Number(!!b.is_internal) - Number(!!a.is_internal)) || a.name.localeCompare(b.name));
  return res.json(listQuery.paged ? customerListPage(visible,listQuery) : visible);
});

// ── Template download — MUST be before /:id ─────────────────────────────────
router.get('/template/download', requireManagerOrPlanner, async (req, res) => {
  const workbook  = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Customers');
  [
    IMPORT_COLUMNS,
    ['Acme Corp', 'Project Atlas', 'ACME', 'Jane Smith', 'jane@acme.com', '+357 22 000000', 'Jane Smith', 'Nicosia', '1 Main St', 'VIP customer', 'yes', 'Security Team', 'MSP-2026-014', '24x7', '2026-01-01', '2026-12-31'],
    ['Beta Ltd', '', '', 'Bob Jones', 'bob@beta.com', '', '', 'Limassol', '', '', 'no', '', '', '', '', ''],
  ].forEach(row => worksheet.addRow(row));
  IMPORT_COLUMNS.forEach((_, i) => { worksheet.getColumn(i + 1).width = i === 0 ? 26 : 18; });
  const buf = await workbook.xlsx.writeBuffer();
  res.setHeader('Content-Disposition', 'attachment; filename="customers_template.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

router.get('/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid ID' });
  const c = (await db.prepare('SELECT * FROM customers WHERE id = ?').get(id));
  if (!c) return res.status(404).json({ error: 'Not found' });
  // Engineers may only view customers from their own assigned visits/projects
  if (!await canAccessCustomer(req.user,c.id)) return res.status(403).json({ error:'Forbidden' });
  const logo = await db.prepare('SELECT updated_at FROM customer_logos WHERE customer_id = ?').get(c.id);
  res.json({ ...decryptCustomer(c), logo_updated_at: logo?.updated_at || null });
});

/* ── Customer logo ───────────────────────────────────────────
   Managers upload a PNG, JPEG or WebP (at most 512 KB; no SVG, which can carry
   script). The bytes must be the image type they claim. Anyone who can open the
   customer sees it. */
const LOGO_TYPES = { 'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'image/jpeg': [0xff, 0xd8, 0xff], 'image/webp': null };
const LOGO_MAX_BYTES = 512 * 1024;
const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LOGO_MAX_BYTES, files: 1 } });
function logoTypeOf(buffer, claimed) {
  if (!Object.prototype.hasOwnProperty.call(LOGO_TYPES, claimed)) return null;
  if (claimed === 'image/webp') return buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP' ? claimed : null;
  return LOGO_TYPES[claimed].every((byte, i) => buffer[i] === byte) ? claimed : null;
}

router.get('/:id/logo', requireAuth, async (req, res) => {
  if (!positiveId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });
  const id = Number(req.params.id);
  if (!await canAccessCustomer(req.user, id)) return res.status(403).json({ error: 'Forbidden' });
  const logo = await db.prepare('SELECT content_type, data, updated_at FROM customer_logos WHERE customer_id = ?').get(id);
  if (!logo) return res.status(404).json({ error: 'No logo' });
  res.setHeader('Content-Type', logo.content_type);
  // The address carries ?v=<updated_at>, so a new logo is a new address.
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('Content-Disposition', 'inline');
  res.send(Buffer.from(logo.data, 'base64'));
});

router.post('/:id/logo', requireManager, (req, res, next) => logoUpload.single('logo')(req, res, error => {
  if (error) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'The logo must be at most 512 KB' : 'Upload one image as "logo"' });
  next();
}), async (req, res) => {
  if (!positiveId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });
  const id = Number(req.params.id);
  const customer = await db.prepare('SELECT id, name FROM customers WHERE id = ?').get(id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  if (!req.file) return res.status(400).json({ error: 'Choose an image' });
  const type = logoTypeOf(req.file.buffer, req.file.mimetype);
  if (!type) return res.status(400).json({ error: 'Use a PNG, JPEG or WebP image' });
  const updated = new Date().toISOString();
  await db.prepare(`INSERT INTO customer_logos (customer_id, content_type, data, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (customer_id) DO UPDATE SET content_type = EXCLUDED.content_type, data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`)
    .run(id, type, req.file.buffer.toString('base64'), updated);
  await logAudit(db, req, 'customer', id, null, 'customer_logo_updated', `${type}; ${req.file.size} bytes`);
  res.json({ logo_updated_at: updated });
});

router.delete('/:id/logo', requireManager, async (req, res) => {
  if (!positiveId(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });
  await db.prepare('DELETE FROM customer_logos WHERE customer_id = ?').run(Number(req.params.id));
  await logAudit(db, req, 'customer', Number(req.params.id), null, 'customer_logo_removed', null);
  res.json({ logo_updated_at: null });
});

const VALID_CONTRACT_HOUR_PERIODS = new Set(['monthly', 'annual']);

function validateCustomerInput(body, existing = {}) {
  if (!existing.id || body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 300)
      return 'Name must contain 1 to 300 characters';
  }
  for (const field of ['contact_name', 'contact_email', 'contact_phone', 'address', 'notes',
    'customer_code', 'primary_contact', 'location', 'contract_type', 'reporting_frequency', 'service_notes']) {
    if (body[field] != null && (typeof body[field] !== 'string' || body[field].length > 10000))
      return `${field} must be text of at most 10000 characters`;
  }
  if (body.project_name != null && (typeof body.project_name !== 'string' || body.project_name.trim().length > 120))
    return 'Project name must be text of at most 120 characters';
  if (body.included_hours != null && body.included_hours !== ''
    && (!['number', 'string'].includes(typeof body.included_hours) || !Number.isFinite(Number(body.included_hours)) || Number(body.included_hours) < 0))
    return 'Included hours must be a finite non-negative number';
  const merged = { ...existing, ...body };
  for (const field of ['contract_start_date', 'contract_end_date']) {
    const value = merged[field];
    if (value != null && value !== '' && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
      || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value))
      return `${field} must be a valid YYYY-MM-DD date`;
  }
  if (merged.contract_start_date && merged.contract_end_date && merged.contract_end_date < merged.contract_start_date)
    return 'Contract end date cannot precede its start date';
  if (body.is_internal != null && ![true, false, 0, 1].includes(body.is_internal))
    return 'is_internal must be true or false';
  return null;
}


router.post('/', requireManagerOrPlanner, async (req, res) => {
  const inputError = validateCustomerInput(req.body);
  if (inputError) return res.status(400).json({ error: inputError });
  const {
    name, contact_name, contact_email, contact_phone, address, notes,
    customer_code, active, service_activity_enabled, primary_contact, location,
    contract_type, contract_start_date, contract_end_date, reporting_frequency,
    included_hours, contract_hour_period, service_notes,
    require_duration, require_ticket_reference, require_technology,
    require_category, require_notes, require_billable_classification, is_internal,
  } = req.body;
  const project_name = req.body.project_name?.trim() || null;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  if (contract_hour_period && !VALID_CONTRACT_HOUR_PERIODS.has(contract_hour_period))
    return res.status(400).json({ error: 'Invalid contract_hour_period' });
  const duplicateCandidates=await candidateCustomerNameIds(db,name);
  const existing = (await db.prepare('SELECT id, name FROM customers').all())
    .filter(row => !duplicateCandidates || duplicateCandidates.has(Number(row.id))).map(decryptCustomer);
  if (existing.some(c => c.name?.toLowerCase() === name.trim().toLowerCase())) {
    return res.status(409).json({ error: 'Customer already exists' });
  }
  const enc = encryptCustomer({ name: name.trim(), contact_name, contact_email, contact_phone, address, notes, primary_contact, location, service_notes, project_name });
  const result = await db.transaction(async tx => {
    const created=await tx.prepare(`INSERT INTO customers
      (name, contact_name, contact_email, contact_phone, address, notes, created_by,
       customer_code, active, service_activity_enabled, primary_contact, location,
       contract_type, contract_start_date, contract_end_date, reporting_frequency,
       included_hours, contract_hour_period, service_notes,
       require_duration, require_ticket_reference, require_technology,
       require_category, require_notes, require_billable_classification, is_internal, project_name)
      VALUES (?,?,?,?,?,?,?, ?,?,?,?,?, ?,?,?,?, ?,?,?, ?,?,?,?,?,?, ?,?)`)
      .run(enc.name, enc.contact_name, enc.contact_email, enc.contact_phone, enc.address, enc.notes, req.user.id,
        customer_code || null, active === false ? 0 : 1, service_activity_enabled ? 1 : 0, enc.primary_contact, enc.location,
        contract_type || null, contract_start_date || null, contract_end_date || null, reporting_frequency || null,
        included_hours != null && included_hours !== '' ? Number(included_hours) : null, contract_hour_period || null, enc.service_notes,
        require_duration ? 1 : 0, require_ticket_reference ? 1 : 0, require_technology ? 1 : 0,
        require_category ? 1 : 0, require_notes ? 1 : 0, require_billable_classification ? 1 : 0, is_internal ? 1 : 0, enc.project_name);
    await replaceCustomerSearchDocument(tx,{ id:created.lastInsertRowid,name:name.trim(),project_name,contact_name,contact_email,address,location,customer_code });
    return created;
  });
  res.json({ id: result.lastInsertRowid });
});

// ── Import — MUST be before /:id (it's POST so no conflict, but kept here for clarity) ─
// The uploaded file's rows, or a 400 already sent (null).
async function importRows(req, res) {
  if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return null; }
  // Excel files are zip archives (start with PK); anything else is read as CSV.
  const isCsv = /\.csv$/i.test(req.file.originalname || '') || req.file.buffer.subarray(0, 2).toString('latin1') !== 'PK';
  let rows;
  try {
    if (isCsv) {
      if (req.file.buffer.includes(0)) { res.status(400).json({ error: 'Could not read the file. Use .xlsx or .csv' }); return null; }
      rows = parseCsv(req.file.buffer.toString('utf8'));
    } else {
      require('../uploadUtils').assertSafeSpreadsheet(req.file.buffer);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(req.file.buffer);
      rows = sheetToJson(workbook.worksheets[0]);
    }
  } catch (e) {
    res.status(400).json({ error: e.status === 400 ? e.message : 'Could not read the file. Use .xlsx or .csv' }); return null;
  }
  if (!rows.length) { res.status(400).json({ error: 'File is empty or has no data rows' }); return null; }
  if (rows.length > 5000) { res.status(400).json({ error: 'Maximum 5000 rows per import. Please split your file.' }); return null; }
  return rows;
}
const fileHash = file => require('node:crypto').createHash('sha256').update(file.buffer).digest('hex');

// What the import would do, row by row, before anything changes (review I07).
router.post('/import/preview', requireManagerOrPlanner, upload.single('file'), async (req, res) => {
  const rows = await importRows(req, res);
  if (!rows) return;
  res.json(previewOf(await planCustomerImport(rows, { user: req.user, fileHash: fileHash(req.file) })));
});

router.post('/import', requireManagerOrPlanner, upload.single('file'), async (req, res) => {
  const rows = await importRows(req, res);
  if (!rows) return;
  // From a preview: only the same file, against the same customers, is imported.
  const plan = await planCustomerImport(rows, { user: req.user, fileHash: fileHash(req.file) });
  if (req.body?.preview_token && req.body.preview_token !== plan.token)
    return res.status(409).json({ error: 'The file or the customers it matches changed since the preview. Review the import again.', code: 'IMPORT_CHANGED', preview: previewOf(plan) });
  const result = await importCustomers(rows, { user: req.user, updateExisting: req.body?.update_existing === '1', plan });
  await logAudit(db, req, 'customer', null, 'Customer import', 'customers_imported',
    `file=${(req.file.originalname || '').slice(0, 100)}; previewed=${req.body?.preview_token ? 'yes' : 'no'}; imported=${result.imported}; updated=${result.updated}; unchanged=${result.unchanged}; managed=${result.managed}; contracts=${result.contracts}; skipped=${result.skipped}`);
  res.json(result);
});

router.put('/:id', requireManagerOrPlanner, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid ID' });
  const existing = (await db.prepare('SELECT * FROM customers WHERE id = ?').get(id));
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const version = sentVersion(req.body);
  if (version.error) return res.status(400).json({ error: version.error });
  if (version.value !== undefined && version.value !== Number(existing.edit_version)) return conflict(res, 'This customer', decryptCustomer(existing));
  const inputError = validateCustomerInput(req.body, existing);
  if (inputError) return res.status(400).json({ error: inputError });
  const {
    name, contact_name, contact_email, contact_phone, address, notes,
    customer_code, active, service_activity_enabled, primary_contact, location,
    contract_type, contract_start_date, contract_end_date, reporting_frequency,
    included_hours, contract_hour_period, service_notes,
    require_duration, require_ticket_reference, require_technology,
    require_category, require_notes, require_billable_classification, is_internal,
  } = req.body;
  if (name !== undefined && !name?.trim()) return res.status(400).json({ error: 'Name cannot be empty' });
  if (contract_hour_period && !VALID_CONTRACT_HOUR_PERIODS.has(contract_hour_period))
    return res.status(400).json({ error: 'Invalid contract_hour_period' });
  if (name?.trim()) {
    const duplicateCandidates=await candidateCustomerNameIds(db,name);
    const allCustomers = (await db.prepare('SELECT id, name FROM customers').all())
      .filter(row => !duplicateCandidates || duplicateCandidates.has(Number(row.id))).map(decryptCustomer);
    if (allCustomers.some(c => c.id !== id && c.name?.toLowerCase() === name.trim().toLowerCase())) {
      return res.status(409).json({ error: 'Customer already exists' });
    }
  }
  // Decrypt existing values so they can be used as fallback when a field isn't supplied
  const dec = decryptCustomer(existing);
  const enc = encryptCustomer({
    name:            name            !== undefined ? name.trim() : dec.name,
    contact_name:    contact_name    !== undefined ? (contact_name    || null) : dec.contact_name,
    contact_email:   contact_email   !== undefined ? (contact_email   || null) : dec.contact_email,
    contact_phone:   contact_phone   !== undefined ? (contact_phone   || null) : dec.contact_phone,
    address:         address         !== undefined ? (address         || null) : dec.address,
    notes:           notes           !== undefined ? (notes           || null) : dec.notes,
    primary_contact: primary_contact !== undefined ? (primary_contact || null) : dec.primary_contact,
    location:        location        !== undefined ? (location        || null) : dec.location,
    service_notes:   service_notes   !== undefined ? (service_notes   || null) : dec.service_notes,
    project_name:    req.body.project_name !== undefined ? (req.body.project_name?.trim() || null) : dec.project_name,
  });
  const projectName = req.body.project_name !== undefined ? (req.body.project_name?.trim() || null) : dec.project_name;
  const saved = await db.transaction(async tx => {
    const result = await tx.prepare(`UPDATE customers SET
      name=COALESCE(?,name), contact_name=?, contact_email=?, contact_phone=?, address=?, notes=?,
      customer_code=?, active=COALESCE(?,active),
      service_activity_enabled=COALESCE(?,service_activity_enabled),
      primary_contact=?, location=?,
      contract_type=?, contract_start_date=?,
      contract_end_date=?, reporting_frequency=?,
      included_hours=?, contract_hour_period=?,
      service_notes=?,
      require_duration=COALESCE(?,require_duration), require_ticket_reference=COALESCE(?,require_ticket_reference),
      require_technology=COALESCE(?,require_technology), require_category=COALESCE(?,require_category),
      require_notes=COALESCE(?,require_notes), require_billable_classification=COALESCE(?,require_billable_classification),
      is_internal=COALESCE(?,is_internal), project_name=?, edit_version=edit_version+1
    WHERE id=? AND edit_version=?`)
    .run(enc.name || null, enc.contact_name, enc.contact_email, enc.contact_phone, enc.address, enc.notes,
      customer_code !== undefined ? (customer_code || null) : existing.customer_code,
      active != null ? (active ? 1 : 0) : null,
      service_activity_enabled != null ? (service_activity_enabled ? 1 : 0) : null,
      enc.primary_contact, enc.location,
      contract_type !== undefined ? (contract_type || null) : existing.contract_type,
      contract_start_date !== undefined ? (contract_start_date || null) : existing.contract_start_date,
      contract_end_date !== undefined ? (contract_end_date || null) : existing.contract_end_date,
      reporting_frequency !== undefined ? (reporting_frequency || null) : existing.reporting_frequency,
      included_hours !== undefined ? (included_hours !== '' && included_hours != null ? Number(included_hours) : null) : existing.included_hours,
      contract_hour_period !== undefined ? (contract_hour_period || null) : existing.contract_hour_period,
      enc.service_notes,
      require_duration != null ? (require_duration ? 1 : 0) : null,
      require_ticket_reference != null ? (require_ticket_reference ? 1 : 0) : null,
      require_technology != null ? (require_technology ? 1 : 0) : null,
      require_category != null ? (require_category ? 1 : 0) : null,
      require_notes != null ? (require_notes ? 1 : 0) : null,
      require_billable_classification != null ? (require_billable_classification ? 1 : 0) : null,
      is_internal != null ? (is_internal ? 1 : 0) : null, enc.project_name, id, existing.edit_version);
    // Saved by someone else between the read above and this write.
    if (!result.changes) return false;
    await replaceCustomerSearchDocument(tx,{ id,
      name:name!==undefined ? name.trim() : dec.name,
      project_name:projectName,
      contact_name:contact_name!==undefined ? contact_name : dec.contact_name,
      contact_email:contact_email!==undefined ? contact_email : dec.contact_email,
      address:address!==undefined ? address : dec.address,
      location:location!==undefined ? location : dec.location,
      customer_code:customer_code!==undefined ? customer_code : existing.customer_code,
    });
  });
  if (saved === false) return conflict(res, 'This customer', decryptCustomer(await db.prepare('SELECT * FROM customers WHERE id = ?').get(id)));
  res.json({ ok: true });
});

/* ── Customer ↔ Team assignment (many-to-many) ────────────────────────── */
router.get('/:id/teams', requireManagerOrPlanner, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid ID' });
  const rows = await db.prepare(`
    SELECT t.id, t.name FROM customer_teams ct
    JOIN teams t ON t.id = ct.team_id WHERE ct.customer_id = ? ORDER BY t.name
  `).all(id);
  res.json(rows);
});

router.put('/:id/teams', requireManagerOrPlanner, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid ID' });
  const customer = await db.prepare('SELECT 1 FROM customers WHERE id = ?').get(id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  const { team_ids } = req.body;
  if (!Array.isArray(team_ids)) return res.status(400).json({ error: 'team_ids must be an array' });
  await db.transaction(async (tx) => {
    await tx.prepare('DELETE FROM customer_teams WHERE customer_id = ?').run(id);
    const ins = tx.prepare('INSERT INTO customer_teams (customer_id, team_id) VALUES (?, ?)');
    for (const tid of team_ids) {
      if (Number.isInteger(tid) && tid > 0) await ins.run(id, tid);
    }
  });
  res.json({ ok: true });
});

/* ── Customer ↔ Engineer restriction (optional, additive) ─────────────── */
router.get('/:id/engineers', requireManagerOrPlanner, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid ID' });
  const rows = await db.prepare(`
    SELECT u.id, u.name, u.email FROM customer_engineers ce
    JOIN users u ON u.id = ce.user_id WHERE ce.customer_id = ? ORDER BY u.name
  `).all(id);
  res.json(rows);
});

router.put('/:id/engineers', requireManagerOrPlanner, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid ID' });
  const customer = await db.prepare('SELECT 1 FROM customers WHERE id = ?').get(id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  const { user_ids } = req.body;
  if (!Array.isArray(user_ids)) return res.status(400).json({ error: 'user_ids must be an array' });
  await db.transaction(async (tx) => {
    await tx.prepare('DELETE FROM customer_engineers WHERE customer_id = ?').run(id);
    const ins = tx.prepare('INSERT INTO customer_engineers (customer_id, user_id) VALUES (?, ?)');
    for (const uid of user_ids) {
      if (Number.isInteger(uid) && uid > 0) await ins.run(id, uid);
    }
  });
  res.json({ ok: true });
});

/* ── Customer Service Profile: activity timeline + summary ────────────── */
router.get('/:id/service-activities', requirePermission('service_activities.access'), async (req, res) => {
  if (!positiveId(req.params.id)) return res.status(400).json({ error: 'Invalid customer ID' });
  const id=Number(req.params.id);
  if (!await db.prepare('SELECT id FROM customers WHERE id=?').get(id)) return res.status(404).json({ error:'Customer not found' });
  if (!await canAccessCustomer(req.user,id)) return res.status(403).json({ error:'Forbidden' });
  const { engineer_id, category_id, technology_id, status, page = 1, page_size = 25 } = req.query;
  const from = req.query.from === '' ? undefined : req.query.from, to = req.query.to === '' ? undefined : req.query.to;
  for (const [key,value] of Object.entries({ from,to,engineer_id,category_id,technology_id,status,page,page_size })) if (value!==undefined && typeof value!=='string' && typeof value!=='number') return res.status(400).json({ error:`${key} must be a single value` });
  const validDate=value => value===undefined || (typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0,4))>=1900 && Number(value.slice(0,4))<=9998 && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value);
  if (!validDate(from) || !validDate(to) || (from && to && from>to)) return res.status(400).json({ error:'Invalid date range' });
  for (const [key,value] of Object.entries({ engineer_id,category_id,technology_id })) if (value!==undefined && !positiveId(value)) return res.status(400).json({ error:`${key} must be a positive integer` });
  if (status!==undefined && (typeof status!=='string' || !/^[a-z0-9_-]{1,100}$/i.test(status))) return res.status(400).json({ error:'Invalid status' });
  if (!positiveId(page) || !positiveId(page_size) || Number(page_size)>200 || !Number.isSafeInteger((Number(page)-1)*Number(page_size))) return res.status(400).json({ error:'Invalid pagination' });
  const limit=Number(page_size),offset=(Number(page)-1)*limit;

  let where = 'WHERE sa.customer_id = ?';
  const params = [id];
  if (req.user.role==='engineer') { where += ' AND sa.engineer_id = ?';params.push(req.user.id); }
  if (from)   { where += ' AND sa.activity_date >= ?'; params.push(from); }
  if (to)     { where += ' AND sa.activity_date <= ?'; params.push(to); }
  if (engineer_id) { where += ' AND sa.engineer_id = ?'; params.push(engineer_id); }
  if (category_id) { where += ' AND sa.category_id = ?'; params.push(category_id); }
  if (status)       { where += ' AND sa.status = ?'; params.push(status); }
  if (technology_id) { where += ' AND EXISTS (SELECT 1 FROM service_activity_technologies sat WHERE sat.service_activity_id = sa.id AND sat.technology_id = ?)'; params.push(technology_id); }

  const rows = await db.prepare(`
    SELECT sa.id, sa.activity_reference, sa.activity_date, sa.title, sa.status, sa.duration_minutes,
      sa.billable_classification, cat.name AS category_name, u.name AS engineer_name
    FROM service_activities sa
    JOIN activity_categories cat ON cat.id = sa.category_id
    JOIN users u ON u.id = sa.engineer_id
    ${where}
    ORDER BY sa.activity_date DESC, sa.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const { total } = await db.prepare(`SELECT COUNT(*) AS total FROM service_activities sa ${where}`).get(...params);
  res.json({ rows, total:Number(total), page:Number(page), page_size:limit });
});

/* ── Contract hour tracking (optional — only meaningful when included_hours is set) ── */
router.get('/:id/contract-hours', requireManagerOrPlanner, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid ID' });
  const customer = await db.prepare('SELECT included_hours, contract_hour_period FROM customers WHERE id = ?').get(id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  if (!customer.included_hours || !customer.contract_hour_period) {
    return res.json({ enabled: false });
  }
  const now = new Date();
  const periodStart = customer.contract_hour_period === 'annual'
    ? `${now.getFullYear()}-01-01`
    : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const { minutes } = await db.prepare(`
    SELECT COALESCE(SUM(duration_minutes), 0) AS minutes FROM service_activities
    WHERE customer_id = ? AND billable_classification = 'included_in_contract' AND activity_date >= ?
  `).get(id, periodStart);
  const consumed = Math.round((minutes / 60) * 10) / 10;
  const remaining = Math.round((customer.included_hours - consumed) * 10) / 10;
  res.json({
    enabled: true, period: customer.contract_hour_period, period_start: periodStart,
    included_hours: customer.included_hours, consumed_hours: consumed, remaining_hours: remaining,
  });
});

router.get('/:id/service-summary', requireAuth, async (req, res) => {
  if (!positiveId(req.params.id)) return res.status(400).json({ error:'Invalid customer ID' });
  const id=Number(req.params.id);
  if (!await db.prepare('SELECT id FROM customers WHERE id=?').get(id)) return res.status(404).json({ error:'Customer not found' });
  if (!await canAccessCustomer(req.user,id)) return res.status(403).json({ error:'Forbidden' });
  // An empty date (a cleared date box) means "no limit", same as leaving it out.
  const from = req.query.from === '' ? undefined : req.query.from, to = req.query.to === '' ? undefined : req.query.to;
  if ((from!==undefined && typeof from!=='string') || (to!==undefined && typeof to!=='string')) return res.status(400).json({ error:'Dates must be single values' });
  const validDate=value => value===undefined || (/^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0,4))>=1900 && Number(value.slice(0,4))<=9998 && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value);
  if (!validDate(from) || !validDate(to) || (from && to && from>to)) return res.status(400).json({ error:'Invalid date range' });
  let where = 'WHERE sa.customer_id = ?';
  const params = [id];
  if (req.user.role==='engineer') { where += ' AND sa.engineer_id = ?';params.push(req.user.id); }
  if (from) { where += ' AND sa.activity_date >= ?'; params.push(from); }
  if (to)   { where += ' AND sa.activity_date <= ?'; params.push(to); }

  const [totals, byCategory, byEngineer, byTechnology, byBillable] = await Promise.all([
    db.prepare(`
      SELECT COUNT(*) AS total_activities,
        COALESCE(ROUND(SUM(duration_minutes) / 60.0, 1), 0) AS total_hours
      FROM service_activities sa ${where}
    `).get(...params),
    db.prepare(`
      SELECT cat.name, COUNT(*) AS count, COALESCE(ROUND(SUM(sa.duration_minutes) / 60.0, 1), 0) AS hours
      FROM service_activities sa JOIN activity_categories cat ON cat.id = sa.category_id
      ${where} GROUP BY cat.name ORDER BY hours DESC
    `).all(...params),
    db.prepare(`
      SELECT u.name, COUNT(*) AS count, COALESCE(ROUND(SUM(sa.duration_minutes) / 60.0, 1), 0) AS hours
      FROM service_activities sa JOIN users u ON u.id = sa.engineer_id
      ${where} GROUP BY u.name ORDER BY hours DESC
    `).all(...params),
    db.prepare(`
      SELECT tech.name, COUNT(*) AS count
      FROM service_activities sa
      JOIN service_activity_technologies sat ON sat.service_activity_id = sa.id
      JOIN technologies tech ON tech.id = sat.technology_id
      ${where} GROUP BY tech.name ORDER BY count DESC
    `).all(...params),
    db.prepare(`
      SELECT COALESCE(billable_classification, 'not_set') AS classification,
        COUNT(*) AS count, COALESCE(ROUND(SUM(duration_minutes) / 60.0, 1), 0) AS hours
      FROM service_activities sa ${where} GROUP BY billable_classification
    `).all(...params),
  ]);

  // Rolling 6-month trend, independent of any from/to filter above — a fixed
  // window so the Customer 360 Overview chart always shows recent history.
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCMonth(monthStart.getUTCMonth() - 5);
  const monthlyFrom = monthStart.toISOString().slice(0, 7) + '-01';
  let monthlyWhere = 'WHERE sa.customer_id = ? AND sa.activity_date >= ?';
  const monthlyParams = [id, monthlyFrom];
  if (req.user.role === 'engineer') { monthlyWhere += ' AND sa.engineer_id = ?'; monthlyParams.push(req.user.id); }
  const monthlyRows = await db.prepare(`
    SELECT substr(sa.activity_date, 1, 7) AS month, COUNT(*) AS count,
      COALESCE(ROUND(SUM(sa.duration_minutes) / 60.0, 1), 0) AS hours
    FROM service_activities sa ${monthlyWhere} GROUP BY month ORDER BY month
  `).all(...monthlyParams);
  const monthlyMap = new Map(monthlyRows.map(row => [row.month, row]));
  const monthly = Array.from({ length: 6 }, (_, index) => {
    const d = new Date(monthStart); d.setUTCMonth(d.getUTCMonth() + index);
    const key = d.toISOString().slice(0, 7);
    const row = monthlyMap.get(key);
    return { month: key, label: d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }), hours: Number(row?.hours || 0), count: Number(row?.count || 0) };
  });

  res.json({ ...totals, byCategory, byEngineer, byTechnology, byBillable, monthly });
});

// Archive instead of delete: an archived customer leaves lists and pickers, but its
// visits, activities, reports and assets stay. It can be restored at any time.
async function setActive(req, res, active) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid ID' });
  const customer = await db.prepare('SELECT id, name, active FROM customers WHERE id = ?').get(id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  await db.prepare('UPDATE customers SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  await logAudit(db, req, 'customer', id, decryptCustomer(customer).name, active ? 'customer_restored' : 'customer_archived', '');
  res.json({ ok: true, active });
}
router.post('/:id/archive', requireManagerOrPlanner, (req, res) => setActive(req, res, false));
router.post('/:id/restore', requireManagerOrPlanner, (req, res) => setActive(req, res, true));

// Deleting removes the customer and its maintenance visits for good, so only managers
// may, and only once the customer is archived.
router.delete('/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid ID' });
  const customer = await db.prepare('SELECT id, name, active FROM customers WHERE id = ?').get(id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  if (customer.active) return res.status(409).json({ error: 'Archive the customer first. Archiving keeps its history and can be undone; deleting cannot.' });
  try {
    await db.prepare('DELETE FROM customers WHERE id = ?').run(id);
  } catch (e) {
    // service_activities.customer_id is ON DELETE RESTRICT (Postgres error code 23503)
    // so a customer with logged service activity history cannot be silently deleted.
    if (e.code === '23503') {
      return res.status(409).json({ error: 'Cannot delete this customer: it has service activity, recommendation or asset history. Keep it archived instead.' });
    }
    throw e;
  }
  await logAudit(db, req, 'customer', id, decryptCustomer(customer).name, 'customer_deleted', '');
  res.json({ ok: true });
});

module.exports = router;
