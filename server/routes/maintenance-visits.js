const router  = require('express').Router();
const multer  = require('multer');
const ExcelJS = require('exceljs');
const db = require('../db');
const { requireAuth, requireManager, requireManagerOrPlanner, requireDownloadManagerOrPlanner } = require('../middleware/auth');
const { notify } = require('../notifications');
const { decrypt } = require('../fieldCipher');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── Helpers ──────────────────────────────────────────────────────────────────
const BASE_SELECT = `
  SELECT mv.*,
    c.name as customer_name, c.contact_name, c.contact_email, c.contact_phone,
    (SELECT GROUP_CONCAT(u2.name, ', ')
     FROM maintenance_visit_engineers mve2
     JOIN users u2 ON mve2.user_id = u2.id
     WHERE mve2.visit_id = mv.id) as engineer_names,
    (SELECT GROUP_CONCAT(CAST(mve3.user_id AS TEXT), ',')
     FROM maintenance_visit_engineers mve3
     WHERE mve3.visit_id = mv.id) as engineer_ids_csv,
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
    engineer_ids: row.engineer_ids_csv
      ? row.engineer_ids_csv.split(',').map(Number)
      : [],
  };
}

// Replace the full engineer set for a visit (within an existing transaction or standalone).
// Always coerces IDs to positive integers — rejects anything that doesn't parse cleanly.
async function replaceEngineers(visitId, engineerIds) {
  await db.transaction(async (tx) => {
    await tx.prepare('DELETE FROM maintenance_visit_engineers WHERE visit_id = ?').run(visitId);
    const ins = tx.prepare('INSERT OR IGNORE INTO maintenance_visit_engineers (visit_id, user_id) VALUES (?, ?)');
    for (const uid of (engineerIds || [])) {
      const intId = parseInt(uid, 10);
      if (Number.isFinite(intId) && intId > 0) await ins.run(visitId, intId);
    }
  });
}

async function isAssignedEngineer(visitId, userId) {
  return !!(await db.prepare('SELECT 1 FROM maintenance_visit_engineers WHERE visit_id = ? AND user_id = ?').get(visitId, userId));
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
  const { month, engineer_id, customer_id, review_pending, not_completed, overview, pending_report } = req.query;
  let q = BASE_SELECT + ' WHERE 1=1';
  const params = [];

  if (pending_report) {
    // Engineer's own visits where report has not been sent yet
    if (req.user.role === 'engineer') {
      q += ' AND EXISTS (SELECT 1 FROM maintenance_visit_engineers WHERE visit_id = mv.id AND user_id = ?)';
      params.push(req.user.id);
    }
    q += " AND mv.report_sent = 0 AND mv.status NOT IN ('cancelled', 'scheduled')";
  } else if (req.user.role === 'engineer') {
    // Engineers always see only their own assigned visits — no bypass
    q += ' AND EXISTS (SELECT 1 FROM maintenance_visit_engineers WHERE visit_id = mv.id AND user_id = ?)';
    params.push(req.user.id);
  } else if (engineer_id) {
    q += ' AND EXISTS (SELECT 1 FROM maintenance_visit_engineers WHERE visit_id = mv.id AND user_id = ?)';
    params.push(engineer_id);
  }
  if (customer_id) { q += ' AND mv.customer_id = ?'; params.push(customer_id); }
  if (month) { q += ` AND strftime('%Y-%m', mv.scheduled_date) = ?`; params.push(month); }
  if (review_pending) { q += ' AND mv.report_sent = 1 AND mv.report_sent_to_customer = 0'; }
  if (not_completed)  { q += " AND mv.status NOT IN ('completed', 'cancelled')"; }
  q += ' ORDER BY mv.scheduled_date ASC';
  res.json((await db.prepare(q).all(...params)).map(parseEngIds));
});

// ── Export to Excel (MUST be before /:id) ───────────────────────────────────
router.get('/export', requireDownloadManagerOrPlanner, async (req, res) => {
  const rows = (await db.prepare(`
    SELECT mv.title, mv.scheduled_date, mv.status,
      c.name as customer,
      GROUP_CONCAT(u.name, ', ') as engineers,
      mv.notes,
      CASE WHEN mv.report_sent_to_customer=1 THEN 'Sent to PM'
           WHEN mv.report_sent=1 THEN 'Report Complete'
           ELSE 'Pending' END as report_status
    FROM maintenance_visits mv
    LEFT JOIN customers c ON mv.customer_id = c.id
    LEFT JOIN maintenance_visit_engineers mve ON mve.visit_id = mv.id
    LEFT JOIN users u ON u.id = mve.user_id
    GROUP BY mv.id, c.name
    ORDER BY mv.scheduled_date DESC
  `).all());

  const wsData = [
    ['Title','Customer','Scheduled Date','Status','Engineers','Report Status','Notes'],
    ...rows.map(r => [r.title, decrypt(r.customer) || '', r.scheduled_date || '', r.status, r.engineers || '', r.report_status, r.notes || '']),
  ];
  const workbook  = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Visits');
  wsData.forEach(row => worksheet.addRow(row));
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
    ['customer_name*', 'title*', 'description', 'scheduled_date*', 'engineer_names', 'notes'],
    ['Acme Corp', 'Q1 Health Check', 'Annual review', '2026-03-15', 'Alice Engineer, Bob Smith', ''],
    ['Beta Ltd',  'Q2 Review',       '',              '2026-06-20', '',                           'Pending assignment'],
  ].forEach(row => worksheet.addRow(row));
  [22, 22, 26, 16, 34, 30].forEach((w, i) => { worksheet.getColumn(i + 1).width = w; });
  const buf = await workbook.xlsx.writeBuffer();
  res.setHeader('Content-Disposition', 'attachment; filename="maintenance_visits_template.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// ── Get single ───────────────────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  const mv = (await db.prepare(BASE_SELECT + ' WHERE mv.id = ?').get(req.params.id));
  if (!mv) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'engineer' && !await isAssignedEngineer(mv.id, req.user.id))
    return res.status(403).json({ error: 'Forbidden' });
  res.json(parseEngIds(mv));
});

// ── Create ───────────────────────────────────────────────────────────────────
router.post('/', requireManagerOrPlanner, async (req, res) => {
  const { customer_id, title, description, scheduled_date, engineer_ids, notes } = req.body;
  if (!customer_id || !title || !scheduled_date)
    return res.status(400).json({ error: 'customer_id, title and scheduled_date are required' });

  const result = (await db.prepare(
    'INSERT INTO maintenance_visits (customer_id, title, description, scheduled_date, notes, created_by) VALUES (?,?,?,?,?,?)'
  ).run(customer_id, title, description || null, scheduled_date, notes || null, req.user.id));

  const visitId = result.lastInsertRowid;

  if (Array.isArray(engineer_ids) && engineer_ids.length) {
    const safeIds = engineer_ids.map(id => parseInt(id, 10)).filter(id => Number.isFinite(id) && id > 0);
    await replaceEngineers(visitId, safeIds);
    if (safeIds.length) {
      const customer = (await db.prepare('SELECT name FROM customers WHERE id = ?').get(customer_id));
      const placeholders = safeIds.map(() => '?').join(',');
      const engineerMap = {};
      (await db.prepare(`SELECT id, name, email FROM users WHERE id IN (${placeholders})`).all(...safeIds))
        .forEach(e => { engineerMap[e.id] = e; });
      safeIds.forEach(uid => {
        const eng = engineerMap[uid];
        if (eng && customer) {
          notify('visit.assigned', {
            engineer_id: uid, engineer_name: eng.name, engineer_email: eng.email,
            visit_title: title, customer_name: decrypt(customer.name), scheduled_date,
          });
        }
      });
    }
  }

  res.json({ id: visitId });
});

// ── Import ───────────────────────────────────────────────────────────────────
router.post('/import', requireManagerOrPlanner, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(req.file.buffer); }
  catch (e) { return res.status(400).json({ error: 'Could not parse file. Use .xlsx format' }); }

  const sheet = workbook.worksheets[0];
  const rows  = sheetToJson(sheet);
  if (!rows.length) return res.status(400).json({ error: 'File is empty or has no data rows' });
  if (rows.length > 5000) return res.status(400).json({ error: 'Maximum 5000 rows per import. Please split your file.' });

  const normalize = (obj) => {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k.replace(/\*/g, '').trim().toLowerCase().replace(/\s+/g, '_')] =
        typeof v === 'string' ? v.trim() : String(v ?? '').trim();
    }
    return out;
  };

  const customers = (await db.prepare('SELECT id, name FROM customers').all())
    .map(c => ({ ...c, name: decrypt(c.name) }));
  const users     = (await db.prepare("SELECT id, name, email FROM users WHERE role='engineer'").all());
  const findCustomer = (name) => customers.find(c => c.name.toLowerCase() === name.toLowerCase())?.id || null;
  const findEngineer = (q) => {
    if (!q) return null;
    const lq = q.toLowerCase();
    return users.find(u => u.name.toLowerCase() === lq || u.email.toLowerCase() === lq)?.id || null;
  };

  const insertStmt = db.prepare(
    'INSERT INTO maintenance_visits (customer_id, title, description, scheduled_date, notes, created_by) VALUES (?,?,?,?,?,?)'
  );
  const insEng = db.prepare('INSERT OR IGNORE INTO maintenance_visit_engineers (visit_id, user_id) VALUES (?, ?)');

  let imported = 0;
  const errors = [];

  // Per-row autocommit — partial-success import (invalid rows skipped/reported).
  for (let i = 0; i < rows.length; i++) {
    const row = normalize(rows[i]);
    const rowNum = i + 2;
    if (!row.customer_name) { errors.push({ row: rowNum, error: 'Missing: customer_name' }); continue; }
    if (!row.title)          { errors.push({ row: rowNum, error: 'Missing: title' });         continue; }
    if (!row.scheduled_date) { errors.push({ row: rowNum, error: 'Missing: scheduled_date' }); continue; }

    const customerId = findCustomer(row.customer_name);
    if (!customerId) { errors.push({ row: rowNum, error: `Customer not found: "${row.customer_name}"` }); continue; }

    // engineer_names can be comma-separated
    const engNames = (row.engineer_names || row.engineer_name || '').split(',').map(s => s.trim()).filter(Boolean);
    const engIds = [];
    let missingEng = false;
    for (const name of engNames) {
      const id = findEngineer(name);
      if (!id) { errors.push({ row: rowNum, error: `Engineer not found: "${name}"` }); missingEng = true; break; }
      engIds.push(id);
    }
    if (missingEng) continue;

    try {
      const r = await insertStmt.run(customerId, row.title, row.description || null, row.scheduled_date, row.notes || null, req.user.id);
      for (const uid of engIds) await insEng.run(r.lastInsertRowid, uid);
      imported++;
    } catch (e) {
      errors.push({ row: rowNum, error: e.message });
    }
  }

  res.json({ imported, skipped: errors.length, errors });
});

// ── Update ───────────────────────────────────────────────────────────────────
router.put('/:id', requireAuth, async (req, res) => {
  const mv = (await db.prepare('SELECT * FROM maintenance_visits WHERE id = ?').get(req.params.id));
  if (!mv) return res.status(404).json({ error: 'Not found' });

  if (req.user.role === 'engineer') {
    if (!await isAssignedEngineer(mv.id, req.user.id)) return res.status(403).json({ error: 'Forbidden' });
    const { notes } = req.body;
    (await db.prepare(`UPDATE maintenance_visits SET notes=?, updated_at=datetime('now') WHERE id=?`).run(notes ?? mv.notes, mv.id));
    return res.json({ ok: true });
  }

  // Managers and planners can do full edits
  if (req.user.role !== 'manager' && req.user.role !== 'planner')
    return res.status(403).json({ error: 'Forbidden' });

  const { customer_id, title, description, scheduled_date, engineer_ids, status, notes } = req.body;
  const VALID_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'];
  if (status !== undefined && !VALID_STATUSES.includes(status))
    return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
  (await db.prepare(`UPDATE maintenance_visits SET
    customer_id=COALESCE(?,customer_id), title=COALESCE(?,title),
    description=COALESCE(?,description), scheduled_date=COALESCE(?,scheduled_date),
    status=COALESCE(?,status), notes=COALESCE(?,notes), updated_at=datetime('now') WHERE id=?`)
    .run(customer_id, title, description, scheduled_date, status, notes, mv.id));

  // Replace engineer set if provided
  if (Array.isArray(engineer_ids)) {
    const safeIds = engineer_ids.map(id => parseInt(id, 10)).filter(id => Number.isFinite(id) && id > 0);
    const oldIds  = (await db.prepare('SELECT user_id FROM maintenance_visit_engineers WHERE visit_id = ?').all(mv.id)).map(r => r.user_id);
    await replaceEngineers(mv.id, safeIds);
    // Notify newly added engineers
    const newIds = safeIds.filter(id => !oldIds.includes(id));
    if (newIds.length) {
      const customer = (await db.prepare('SELECT name FROM customers WHERE id = ?').get(customer_id || mv.customer_id));
      const placeholders = newIds.map(() => '?').join(',');
      const engineerMap = {};
      (await db.prepare(`SELECT id, name, email FROM users WHERE id IN (${placeholders})`).all(...newIds))
        .forEach(e => { engineerMap[e.id] = e; });
      newIds.forEach(uid => {
        const eng = engineerMap[uid];
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
  (await db.prepare(`UPDATE maintenance_visits SET report_sent=1, report_sent_at=datetime('now'), report_sent_by=?, updated_at=datetime('now') WHERE id=?`)
    .run(req.user.id, mv.id));
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
  (await db.prepare(`UPDATE maintenance_visits SET report_sent=0, report_sent_at=NULL, report_sent_by=NULL, updated_at=datetime('now') WHERE id=?`).run(mv.id));
  res.json({ ok: true });
});

// ── Report sent to customer / undo (manager or planner) ──────────────────────
router.post('/:id/report-customer-sent', requireManagerOrPlanner, async (req, res) => {
  const mv = (await db.prepare('SELECT * FROM maintenance_visits WHERE id = ?').get(req.params.id));
  if (!mv) return res.status(404).json({ error: 'Not found' });
  if (!mv.report_sent) return res.status(400).json({ error: 'Report must be marked sent by engineer first' });
  (await db.prepare(`UPDATE maintenance_visits SET
      report_sent_to_customer=1,
      report_sent_to_customer_at=datetime('now'),
      report_sent_to_customer_by=?,
      status='completed',
      updated_at=datetime('now')
    WHERE id=?`)
    .run(req.user.id, mv.id));
  res.json({ ok: true });
});

router.post('/:id/report-customer-unsent', requireManagerOrPlanner, async (req, res) => {
  // Revert customer-sent flag; restore status to in_progress so it can be actioned again
  const mv = (await db.prepare('SELECT status FROM maintenance_visits WHERE id = ?').get(req.params.id));
  const revertStatus = mv?.status === 'completed' ? 'in_progress' : (mv?.status ?? 'in_progress');
  (await db.prepare(`UPDATE maintenance_visits SET
      report_sent_to_customer=0,
      report_sent_to_customer_at=NULL,
      report_sent_to_customer_by=NULL,
      status=?,
      updated_at=datetime('now')
    WHERE id=?`).run(revertStatus, req.params.id));
  res.json({ ok: true });
});

// ── Mark as completed (PM, manager, or planner) ─────────────────────────────
router.post('/:id/complete', requireAuth, async (req, res) => {
  const { role } = req.user;
  if (!['manager', 'planner', 'pm'].includes(role))
    return res.status(403).json({ error: 'Forbidden' });
  const mv = (await db.prepare('SELECT * FROM maintenance_visits WHERE id = ?').get(req.params.id));
  if (!mv) return res.status(404).json({ error: 'Not found' });
  if (mv.status === 'cancelled') return res.status(400).json({ error: 'Cannot complete a cancelled visit' });
  if (mv.status === 'completed') return res.json({ ok: true }); // idempotent
  (await db.prepare(`UPDATE maintenance_visits SET status='completed', updated_at=datetime('now') WHERE id=?`).run(mv.id));
  res.json({ ok: true });
});

// ── Delete ───────────────────────────────────────────────────────────────────
router.delete('/:id', requireManagerOrPlanner, async (req, res) => {
  (await db.prepare('DELETE FROM maintenance_visits WHERE id = ?').run(req.params.id));
  res.json({ ok: true });
});

module.exports = router;
