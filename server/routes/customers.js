const router  = require('express').Router();
const multer  = require('multer');
const ExcelJS = require('exceljs');
const db = require('../db');
const { requireAuth, requireManager, requireManagerOrPlanner } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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

router.get('/', requireAuth, (req, res) => {
  // Engineers only see customers from their own visits/projects
  if (req.user.role === 'engineer') {
    const rows = db.prepare(`
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
    `).all(req.user.id, req.user.id);
    return res.json(rows);
  }
  const rows = db.prepare(`SELECT c.*, u.name as created_by_name,
    (SELECT COUNT(*) FROM maintenance_visits WHERE customer_id = c.id) as visit_count
    FROM customers c LEFT JOIN users u ON c.created_by = u.id ORDER BY c.name`).all();
  res.json(rows);
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

router.get('/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid ID' });
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  // Engineers may only view customers from their own assigned visits/projects
  if (req.user.role === 'engineer') {
    const allowed = db.prepare(`
      SELECT 1 FROM (
        SELECT mv.customer_id FROM maintenance_visits mv
        JOIN maintenance_visit_engineers mve ON mve.visit_id = mv.id
        WHERE mve.user_id = ? AND mv.customer_id = ?
        UNION
        SELECT p.customer_id FROM projects p
        JOIN project_assignments pa ON pa.project_id = p.id
        WHERE pa.user_id = ? AND p.customer_id = ?
      )
    `).get(req.user.id, c.id, req.user.id, c.id);
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(c);
});

router.post('/', requireManagerOrPlanner, (req, res) => {
  const { name, contact_name, contact_email, contact_phone, address, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const result = db.prepare('INSERT INTO customers (name, contact_name, contact_email, contact_phone, address, notes, created_by) VALUES (?,?,?,?,?,?,?)')
    .run(name, contact_name || null, contact_email || null, contact_phone || null, address || null, notes || null, req.user.id);
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

  const insertStmt = db.prepare(
    'INSERT INTO customers (name, contact_name, contact_email, contact_phone, address, notes, created_by) VALUES (?,?,?,?,?,?,?)'
  );
  const dupCheckStmt = db.prepare('SELECT 1 FROM customers WHERE lower(name) = lower(?)');

  let imported = 0;
  const errors = [];

  const importMany = db.transaction(() => {
    rows.forEach((rawRow, i) => {
      const row = normalize(rawRow);
      const rowNum = i + 2;
      if (!row.name) {
        errors.push({ row: rowNum, error: 'Missing required field: name' });
        return;
      }
      if (dupCheckStmt.get(row.name)) {
        errors.push({ row: rowNum, error: `Customer "${row.name}" already exists — skipped` });
        return;
      }
      try {
        insertStmt.run(
          row.name,
          row.contact_name   || null,
          row.contact_email  || null,
          row.contact_phone  || null,
          row.address        || null,
          row.notes          || null,
          req.user.id
        );
        imported++;
      } catch (e) {
        errors.push({ row: rowNum, error: e.message });
      }
    });
  });

  importMany();
  res.json({ imported, skipped: errors.length, errors });
});

router.put('/:id', requireManagerOrPlanner, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid ID' });
  const existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { name, contact_name, contact_email, contact_phone, address, notes } = req.body;
  db.prepare('UPDATE customers SET name=COALESCE(?,name), contact_name=?, contact_email=?, contact_phone=?, address=?, notes=? WHERE id=?')
    .run(
      name || null,
      contact_name  !== undefined ? (contact_name  || null) : existing.contact_name,
      contact_email !== undefined ? (contact_email || null) : existing.contact_email,
      contact_phone !== undefined ? (contact_phone || null) : existing.contact_phone,
      address       !== undefined ? (address       || null) : existing.address,
      notes         !== undefined ? (notes         || null) : existing.notes,
      id
    );
  res.json({ ok: true });
});

router.delete('/:id', requireManagerOrPlanner, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid ID' });
  db.prepare('DELETE FROM customers WHERE id = ?').run(id);
  res.json({ ok: true });
});

module.exports = router;
