const router = require('express').Router();
const db = require('../db');
const ExcelJS = require('exceljs');
const { requireManager } = require('../middleware/auth');
const { metadata,compileReport,csvCell } = require('../customReports');
const { logAudit } = require('../auditLog');
const { reportTemplates } = require('../reportTemplates');
router.use(requireManager);
router.get('/sources',async (req,res) => {
  const row = await db.prepare("SELECT value FROM settings WHERE key='status_config'").get();
  let config = {};
  try { config = JSON.parse(row?.value || '{}'); } catch { /* use default states */ }
  res.json({ sources: metadata(),templates: reportTemplates(new Date(),config || {}),preview_limit: 100,export_limit: 5000 });
});
const id = value => typeof value==='string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
const conflict = res => res.status(409).json({ error: 'Saved report changed. Reload before modifying it.',code: 'REPORT_CONFLICT' });
function savedInput(body) {
  if (!body || typeof body.name!=='string' || !body.name.trim() || body.name.trim().length>200 || !['private','management'].includes(body.visibility)) throw Object.assign(new Error('A report name (1–200 characters), visibility and valid definition are required'),{ status: 400 });
  compileReport(body.definition,100);
}
async function visible(req,res) {
  if (!id(req.params.reportId)) { res.status(400).json({ error: 'Invalid saved report ID' }); return null; }
  const row = await db.prepare("SELECT * FROM saved_custom_reports WHERE id=? AND (owner_id=? OR visibility='management')").get(Number(req.params.reportId),req.user.id);
  if (!row) { res.status(404).json({ error: 'Saved report not found' }); return null; }
  return row;
}
router.get('/saved',async (req,res) => {
  const page = req.query.page ?? '1';
  if (!id(page) || !Number.isSafeInteger((Number(page)-1)*25)) return res.status(400).json({ error: 'Invalid page' });
  const [rows,total] = await Promise.all([
    db.prepare("SELECT r.id,r.owner_id,r.name,r.visibility,r.version,r.updated_at,u.name AS owner_name FROM saved_custom_reports r JOIN users u ON u.id=r.owner_id WHERE r.owner_id=? OR r.visibility='management' ORDER BY r.updated_at DESC,r.id DESC LIMIT ? OFFSET ?").all(req.user.id,25,(Number(page)-1)*25),
    db.prepare("SELECT COUNT(*) AS total FROM saved_custom_reports WHERE owner_id=? OR visibility='management'").get(req.user.id),
  ]);
  res.json({ rows,total: Number(total.total),page: Number(page),page_size: 25 });
});
router.post('/saved',async (req,res) => {
  savedInput(req.body);
  const result = await db.prepare('INSERT INTO saved_custom_reports (owner_id,name,visibility,definition) VALUES (?,?,?,?)').run(req.user.id,req.body.name.trim(),req.body.visibility,JSON.stringify(req.body.definition));
  await logAudit(db,req,'custom_report',result.lastInsertRowid,req.body.name.trim(),'created',req.body.visibility);
  res.status(201).json({ id: result.lastInsertRowid,version: 1 });
});
router.get('/saved/:reportId',async (req,res) => {
  const row = await visible(req,res);
  if (row) res.json({ ...row,definition: JSON.parse(row.definition),can_edit: row.owner_id===req.user.id });
});
router.put('/saved/:reportId',async (req,res) => {
  const row = await visible(req,res);
  if (!row) return;
  if (row.owner_id!==req.user.id) return res.status(403).json({ error: 'Only the report owner can modify it' });
  savedInput(req.body);
  if (!Number.isSafeInteger(req.body.version) || req.body.version<1) return res.status(400).json({ error: 'Expected version is required' });
  const changed = await db.prepare(`UPDATE saved_custom_reports SET name=?,visibility=?,definition=?,version=version+1,updated_at=datetime('now') WHERE id=? AND owner_id=? AND version=?`).run(req.body.name.trim(),req.body.visibility,JSON.stringify(req.body.definition),row.id,req.user.id,req.body.version);
  if (!changed.changes) return conflict(res);
  await logAudit(db,req,'custom_report',row.id,req.body.name.trim(),'updated',req.body.visibility);
  res.json({ id: row.id,version: req.body.version+1 });
});
router.delete('/saved/:reportId',async (req,res) => {
  const row = await visible(req,res);
  if (!row) return;
  if (row.owner_id!==req.user.id) return res.status(403).json({ error: 'Only the report owner can delete it' });
  if (!Number.isSafeInteger(req.body?.version) || req.body.version<1) return res.status(400).json({ error: 'Expected version is required' });
  const changed = await db.prepare('DELETE FROM saved_custom_reports WHERE id=? AND owner_id=? AND version=?').run(row.id,req.user.id,req.body.version);
  if (!changed.changes) return conflict(res);
  await logAudit(db,req,'custom_report',row.id,row.name,'deleted',null);
  res.json({ ok: true });
});
router.post('/saved/:reportId/preview',async (req,res) => {
  const row = await visible(req,res);
  if (row) res.json(await run(JSON.parse(row.definition),100));
});

async function run(definition,limit) {
  const compiled = compileReport(definition,limit);
  const rows = await db.transaction(async tx => {
    await tx.exec("SET LOCAL statement_timeout = '5s'; SET LOCAL TRANSACTION READ ONLY;");
    return tx.prepare(compiled.sql).all(...compiled.params);
  });
  return { columns: compiled.columns,rows: rows.slice(0,limit),truncated: rows.length>limit,limit };
}
router.post('/preview',async (req,res) => res.json(await run(req.body,100)));
router.post('/export-csv',async (req,res) => {
  const result = await run(req.body,5000);
  if (result.truncated) return res.status(413).json({ error: 'Report exceeds 5000 rows. Narrow the filters before exporting.' });
  const lines = [result.columns.map(column => csvCell(column.label)).join(','),...result.rows.map(row => result.columns.map(column => csvCell(row[column.key])).join(','))];
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename="custom-report.csv"');
  res.send('\uFEFF'+lines.join('\r\n'));
});
router.post('/export',async (req,res) => {
  const result = await run(req.body,5000);
  if (result.truncated) return res.status(413).json({ error: 'Report exceeds 5000 rows. Narrow the filters before exporting.' });
  const workbook = new ExcelJS.Workbook(),sheet = workbook.addWorksheet('Report');
  sheet.addRow(result.columns.map(column => column.label));
  for (const row of result.rows) sheet.addRow(result.columns.map(column => row[column.key] ?? ''));
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition','attachment; filename="custom-report.xlsx"');
  res.send(await workbook.xlsx.writeBuffer());
});
router.use((error,req,res,next) => {
  if (error.status===400) return res.status(400).json({ error: error.message });
  if (error.code==='57014') return res.status(408).json({ error: 'Report exceeded its execution time budget. Narrow the filters.' });
  next(error);
});
module.exports = router;
module.exports.run = run;
