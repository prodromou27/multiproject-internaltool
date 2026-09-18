const router = require('express').Router();
const db = require('../db');
const ExcelJS = require('exceljs');
const { requireManager } = require('../middleware/auth');
const { metadata,compileReport } = require('../customReports');
router.use(requireManager);
router.get('/sources',(req,res) => res.json({ sources: metadata(),preview_limit: 100,export_limit: 5000 }));

async function run(definition,limit) {
  const compiled = compileReport(definition,limit);
  const rows = await db.transaction(async tx => {
    await tx.exec("SET LOCAL statement_timeout = '5s'; SET LOCAL TRANSACTION READ ONLY;");
    return tx.prepare(compiled.sql).all(...compiled.params);
  });
  return { columns: compiled.columns,rows: rows.slice(0,limit),truncated: rows.length>limit,limit };
}
router.post('/preview',async (req,res) => res.json(await run(req.body,100)));
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
