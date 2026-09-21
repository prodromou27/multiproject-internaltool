const router  = require('express').Router();
const multer  = require('multer');
const ExcelJS = require('exceljs');
const db = require('../db');
const { requireAuth, requireManager, requireManagerOrPlanner } = require('../middleware/auth');
const { encryptCustomer, decryptCustomer } = require('../fieldCipher');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
router.use('/:id/overview', require('./customer-overview'));
router.use('/:id/recommendations', require('./customer-recommendations'));
router.use('/:id/assets', require('./customer-assets'));

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
  // Engineers only see customers from their own visits/projects
  if (req.user.role === 'engineer') {
    const rows = (await db.prepare(`
      SELECT DISTINCT c.id, c.name, c.contact_name, c.contact_email, c.contact_phone, c.address,
        (SELECT COUNT(*) FROM maintenance_visits WHERE customer_id = c.id) as visit_count
      FROM customers c
      WHERE c.id IN (
        SELECT DISTINCT mv.customer_id FROM maintenance_visits mv
        JOIN maintenance_visit_engineers mve ON mve.visit_id = mv.id
        WHERE mve.user_id = ?
        UNION
        SELECT DISTINCT p.customer_id FROM projects p
        JOIN project_assignments pa ON pa.project_id = p.id
        WHERE pa.user_id = ? AND p.customer_id IS NOT NULL
      )
      ORDER BY c.name
    `).all(req.user.id, req.user.id));
    return res.json(rows.map(decryptCustomer).sort((a, b) => a.name.localeCompare(b.name)));
  }
  const rows = (await db.prepare(`SELECT c.*, u.name as created_by_name,
    (SELECT COUNT(*) FROM maintenance_visits WHERE customer_id = c.id) as visit_count
    FROM customers c LEFT JOIN users u ON c.created_by = u.id ORDER BY c.name`).all());
  res.json(rows.map(decryptCustomer).sort((a, b) => a.name.localeCompare(b.name)));
});

// ── Template download — MUST be before /:id ─────────────────────────────────
router.get('/template/download', requireManagerOrPlanner, async (req, res) => {
  const workbook  = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Customers');
  [
    ['name*', 'contact_name', 'contact_email', 'contact_phone', 'address', 'notes'],
    ['Acme Corp', 'Jane Smith', 'jane@acme.com', '+1-555-0100', '123 Main St', 'VIP customer'],
    ['Beta Ltd',  'Bob Jones',  'bob@beta.com',  '+1-555-0200', '456 Oak Ave', ''],
  ].forEach(row => worksheet.addRow(row));
  [24, 20, 26, 18, 30, 30].forEach((w, i) => { worksheet.getColumn(i + 1).width = w; });
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
  if (req.user.role === 'engineer') {
    const allowed = (await db.prepare(`
      SELECT 1 FROM (
        SELECT mv.customer_id FROM maintenance_visits mv
        JOIN maintenance_visit_engineers mve ON mve.visit_id = mv.id
        WHERE mve.user_id = ? AND mv.customer_id = ?
        UNION
        SELECT p.customer_id FROM projects p
        JOIN project_assignments pa ON pa.project_id = p.id
        WHERE pa.user_id = ? AND p.customer_id = ?
      )
    `).get(req.user.id, c.id, req.user.id, c.id));
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(decryptCustomer(c));
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
    require_category, require_notes, require_billable_classification,
  } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  if (contract_hour_period && !VALID_CONTRACT_HOUR_PERIODS.has(contract_hour_period))
    return res.status(400).json({ error: 'Invalid contract_hour_period' });
  const existing = (await db.prepare('SELECT id, name FROM customers').all()).map(decryptCustomer);
  if (existing.some(c => c.name?.toLowerCase() === name.trim().toLowerCase())) {
    return res.status(409).json({ error: 'Customer already exists' });
  }
  const enc = encryptCustomer({ name: name.trim(), contact_name, contact_email, contact_phone, address, notes, primary_contact, location, service_notes });
  const result = (await db.prepare(`INSERT INTO customers
    (name, contact_name, contact_email, contact_phone, address, notes, created_by,
     customer_code, active, service_activity_enabled, primary_contact, location,
     contract_type, contract_start_date, contract_end_date, reporting_frequency,
     included_hours, contract_hour_period, service_notes,
     require_duration, require_ticket_reference, require_technology,
     require_category, require_notes, require_billable_classification)
    VALUES (?,?,?,?,?,?,?, ?,?,?,?,?, ?,?,?,?, ?,?,?, ?,?,?,?,?,?)`)
    .run(enc.name, enc.contact_name, enc.contact_email, enc.contact_phone, enc.address, enc.notes, req.user.id,
      customer_code || null, active === false ? 0 : 1, service_activity_enabled ? 1 : 0, enc.primary_contact, enc.location,
      contract_type || null, contract_start_date || null, contract_end_date || null, reporting_frequency || null,
      included_hours != null && included_hours !== '' ? Number(included_hours) : null, contract_hour_period || null, enc.service_notes,
      require_duration ? 1 : 0, require_ticket_reference ? 1 : 0, require_technology ? 1 : 0,
      require_category ? 1 : 0, require_notes ? 1 : 0, require_billable_classification ? 1 : 0));
  res.json({ id: result.lastInsertRowid });
});

// ── Import — MUST be before /:id (it's POST so no conflict, but kept here for clarity) ─
router.post('/import', requireManagerOrPlanner, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(req.file.buffer);
  } catch (e) {
    return res.status(400).json({ error: 'Could not parse file. Use .xlsx format' });
  }

  const sheet = workbook.worksheets[0];
  const rows  = sheetToJson(sheet);

  if (!rows.length) return res.status(400).json({ error: 'File is empty or has no data rows' });
  if (rows.length > 5000) return res.status(400).json({ error: 'Maximum 5000 rows per import. Please split your file.' });

  const normalize = (obj) => {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k.replace(/\*/g, '').trim().toLowerCase().replace(/\s+/g, '_')] = typeof v === 'string' ? v.trim() : String(v ?? '').trim();
    }
    return out;
  };

  // Per-row autocommit (not one big transaction): this import is partial-success
  // by design — invalid rows are skipped and reported. A single Postgres
  // transaction would abort entirely on the first failing row.
  const insertStmt = db.prepare('INSERT INTO customers (name, contact_name, contact_email, contact_phone, address, notes, created_by) VALUES (?,?,?,?,?,?,?)');
  const existingNames = new Set((await db.prepare('SELECT name FROM customers').all())
    .map(decryptCustomer)
    .map(c => c.name?.toLowerCase())
    .filter(Boolean));

  let imported = 0;
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const row = normalize(rows[i]);
    const rowNum = i + 2;
    if (!row.name) {
      errors.push({ row: rowNum, error: 'Missing required field: name' });
      continue;
    }
    const normalizedName = row.name.toLowerCase();
    if (existingNames.has(normalizedName)) {
      errors.push({ row: rowNum, error: `Customer "${row.name}" already exists — skipped` });
      continue;
    }
    try {
      const enc = encryptCustomer({
        name:          row.name,
        contact_name:  row.contact_name  || null,
        contact_email: row.contact_email || null,
        contact_phone: row.contact_phone || null,
        address:       row.address       || null,
        notes:         row.notes         || null,
      });
      await insertStmt.run(
        enc.name, enc.contact_name, enc.contact_email, enc.contact_phone,
        enc.address, enc.notes, req.user.id
      );
      existingNames.add(normalizedName);
      imported++;
    } catch (e) {
      errors.push({ row: rowNum, error: e.message });
    }
  }

  res.json({ imported, skipped: errors.length, errors });
});

router.put('/:id', requireManagerOrPlanner, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid ID' });
  const existing = (await db.prepare('SELECT * FROM customers WHERE id = ?').get(id));
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const inputError = validateCustomerInput(req.body, existing);
  if (inputError) return res.status(400).json({ error: inputError });
  const {
    name, contact_name, contact_email, contact_phone, address, notes,
    customer_code, active, service_activity_enabled, primary_contact, location,
    contract_type, contract_start_date, contract_end_date, reporting_frequency,
    included_hours, contract_hour_period, service_notes,
    require_duration, require_ticket_reference, require_technology,
    require_category, require_notes, require_billable_classification,
  } = req.body;
  if (name !== undefined && !name?.trim()) return res.status(400).json({ error: 'Name cannot be empty' });
  if (contract_hour_period && !VALID_CONTRACT_HOUR_PERIODS.has(contract_hour_period))
    return res.status(400).json({ error: 'Invalid contract_hour_period' });
  if (name?.trim()) {
    const allCustomers = (await db.prepare('SELECT id, name FROM customers').all()).map(decryptCustomer);
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
  });
  (await db.prepare(`UPDATE customers SET
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
      require_notes=COALESCE(?,require_notes), require_billable_classification=COALESCE(?,require_billable_classification)
    WHERE id=?`)
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
      id));
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
router.get('/:id/service-activities', requireManagerOrPlanner, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid ID' });
  const { from, to, engineer_id, category_id, technology_id, status, page = 1, page_size = 25 } = req.query;
  const limit = Math.min(Math.max(parseInt(page_size, 10) || 25, 1), 200);
  const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limit;

  let where = 'WHERE sa.customer_id = ?';
  const params = [id];
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
  res.json({ rows, total, page: Number(page), page_size: limit });
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

router.get('/:id/service-summary', requireManagerOrPlanner, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid ID' });
  const { from, to } = req.query;
  let where = 'WHERE sa.customer_id = ?';
  const params = [id];
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

  res.json({ ...totals, byCategory, byEngineer, byTechnology, byBillable });
});

router.delete('/:id', requireManagerOrPlanner, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid ID' });
  try {
    await db.prepare('DELETE FROM customers WHERE id = ?').run(id);
    res.json({ ok: true });
  } catch (e) {
    // service_activities.customer_id is ON DELETE RESTRICT (Postgres error code 23503)
    // so a customer with logged service activity history cannot be silently deleted.
    if (e.code === '23503') {
      return res.status(409).json({ error: 'Cannot delete this customer: it has retained service activity, recommendation, or asset history. Deactivate it instead.' });
    }
    throw e;
  }
});

module.exports = router;
