const router = require('express').Router();
const db = require('../db');
const ExcelJS = require('exceljs');
const fs = require('node:fs');
const path = require('node:path');
const { requirePermission } = require('../middleware/auth');
const { metadata,compileReport } = require('../customReports');
const { logAudit } = require('../auditLog');
const { reportTemplates } = require('../reportTemplates');
const { run,csv } = require('../reportExecution');
const { validateSchedule,nextRun,eligibleRecipients } = require('../reportSchedule');
const { ACCESS_SQL,validateShares,replaceShares,reportShares } = require('../reportAccess');
const backgroundJobs = require('../backgroundJobs');
const fileCipher = require('../cipher');
const { exportRoot } = require('../customReportExport');
router.use(requirePermission('reports.access'));
router.get('/sources',async (req,res) => {
  const row = await db.prepare("SELECT value FROM settings WHERE key='status_config'").get();
  let config = {};
  try { config = JSON.parse(row?.value || '{}'); } catch { /* use default states */ }
  const [shareUsers,shareTeams] = await Promise.all([
    db.prepare("SELECT id,name FROM users WHERE role='manager' AND active=1 AND must_change_password=0 ORDER BY name,id LIMIT 501").all(),
    db.prepare('SELECT id,name FROM teams ORDER BY name,id LIMIT 501').all(),
  ]);
  if (shareUsers.length>500 || shareTeams.length>500) return res.status(413).json({ error: 'Report sharing directory exceeds 500 entries' });
  res.json({ sources: metadata(),templates: reportTemplates(new Date(),config || {}),share_users: shareUsers,share_teams: shareTeams,preview_limit: 100,export_limit: 5000 });
});
const id = value => typeof value==='string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
const conflict = res => res.status(409).json({ error: 'Saved report changed. Reload before modifying it.',code: 'REPORT_CONFLICT' });
function savedInput(body) {
  if (!body || typeof body.name!=='string' || !body.name.trim() || body.name.trim().length>200 || !['private','shared','management'].includes(body.visibility)) throw Object.assign(new Error('A report name (1–200 characters), visibility and valid definition are required'),{ status: 400 });
  compileReport(body.definition,100);
}
async function visible(req,res) {
  if (!id(req.params.reportId)) { res.status(400).json({ error: 'Invalid saved report ID' }); return null; }
  const row = await db.prepare(`SELECT r.* FROM saved_custom_reports r WHERE r.id=? AND ${ACCESS_SQL}`).get(Number(req.params.reportId),req.user.id,req.user.id,req.user.id);
  if (!row) { res.status(404).json({ error: 'Saved report not found' }); return null; }
  return row;
}
router.get('/saved',async (req,res) => {
  const page = req.query.page ?? '1';
  if (!id(page) || !Number.isSafeInteger((Number(page)-1)*25)) return res.status(400).json({ error: 'Invalid page' });
  const [rows,total] = await Promise.all([
    db.prepare(`SELECT r.id,r.owner_id,r.name,r.visibility,r.version,r.updated_at,u.name AS owner_name FROM saved_custom_reports r JOIN users u ON u.id=r.owner_id WHERE ${ACCESS_SQL} ORDER BY r.updated_at DESC,r.id DESC LIMIT ? OFFSET ?`).all(req.user.id,req.user.id,req.user.id,25,(Number(page)-1)*25),
    db.prepare(`SELECT COUNT(*) AS total FROM saved_custom_reports r WHERE ${ACCESS_SQL}`).get(req.user.id,req.user.id,req.user.id),
  ]);
  res.json({ rows,total: Number(total.total),page: Number(page),page_size: 25 });
});
router.post('/saved',async (req,res) => {
  savedInput(req.body);
  const created = await db.transaction(async tx => {
    const shares=await validateShares(tx,req.body.visibility,req.body.shared_user_ids,req.body.shared_team_ids);
    const result=await tx.prepare('INSERT INTO saved_custom_reports (owner_id,name,visibility,definition) VALUES (?,?,?,?)').run(req.user.id,req.body.name.trim(),req.body.visibility,JSON.stringify(req.body.definition));
    await replaceShares(tx,result.lastInsertRowid,shares);
    return result.lastInsertRowid;
  });
  await logAudit(db,req,'custom_report',created,req.body.name.trim(),'created',req.body.visibility);
  res.status(201).json({ id: created,version: 1 });
});
router.get('/saved/:reportId',async (req,res) => {
  const row = await visible(req,res);
  if (row) {
    const canEdit=row.owner_id===req.user.id;
    res.json({ ...row,...(canEdit ? await reportShares(db,row.id) : { shared_user_ids: [],shared_team_ids: [] }),definition: JSON.parse(row.definition),can_edit: canEdit });
  }
});
router.put('/saved/:reportId',async (req,res) => {
  const row = await visible(req,res);
  if (!row) return;
  if (row.owner_id!==req.user.id) return res.status(403).json({ error: 'Only the report owner can modify it' });
  savedInput(req.body);
  if (!Number.isSafeInteger(req.body.version) || req.body.version<1) return res.status(400).json({ error: 'Expected version is required' });
  const changed = await db.transaction(async tx => {
    const shares=await validateShares(tx,req.body.visibility,req.body.shared_user_ids,req.body.shared_team_ids);
    const result=await tx.prepare(`UPDATE saved_custom_reports SET name=?,visibility=?,definition=?,version=version+1,updated_at=app_now() WHERE id=? AND owner_id=? AND version=?`).run(req.body.name.trim(),req.body.visibility,JSON.stringify(req.body.definition),row.id,req.user.id,req.body.version);
    if (result.changes) await replaceShares(tx,row.id,shares);
    return result;
  });
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
router.get('/saved/:reportId/schedule',async (req,res) => {
  const report = await visible(req,res);
  if (!report) return;
  if (report.owner_id!==req.user.id) return res.status(403).json({ error: 'Only the report owner can manage delivery' });
  const recipientWhere = report.visibility==='management' ? '' : report.visibility==='private'
    ? ' AND u.id=?'
    : ' AND (u.id=? OR u.id IN (SELECT user_id FROM saved_custom_report_users WHERE report_id=?) OR u.id IN (SELECT tm.user_id FROM saved_custom_report_teams srt JOIN team_members tm ON tm.team_id=srt.team_id WHERE srt.report_id=?))';
  const recipientParams = report.visibility==='management' ? [] : report.visibility==='private' ? [report.owner_id] : [report.owner_id,report.id,report.id];
  const [schedule,recipients] = await Promise.all([
    db.prepare('SELECT * FROM custom_report_schedules WHERE report_id=?').get(report.id),
    db.prepare(`SELECT u.id,u.name FROM users u WHERE u.role='manager' AND u.active=1 AND u.must_change_password=0 AND u.email IS NOT NULL AND u.email<>''${recipientWhere} ORDER BY u.name,u.id LIMIT 501`).all(...recipientParams),
  ]);
  if (recipients.length>500) return res.status(413).json({ error: 'Recipient directory exceeds 500 managers' });
  res.json({ schedule: schedule ? { ...schedule,enabled: !!schedule.enabled,recipient_ids: JSON.parse(schedule.recipient_ids) } : null,recipients,visibility: report.visibility });
});
router.put('/saved/:reportId/schedule',async (req,res) => {
  const report = await visible(req,res);
  if (!report) return;
  if (report.owner_id!==req.user.id) return res.status(403).json({ error: 'Only the report owner can manage delivery' });
  validateSchedule(req.body);
  if (req.body.enabled) await eligibleRecipients(db,report,req.body.recipient_ids);
  const { frequency,day,hour,minute,recipient_ids,enabled,version } = req.body;
  const next = enabled ? nextRun(req.body) : null;
  const values = [frequency,day,hour,minute,JSON.stringify(recipient_ids),enabled ? 1 : 0,next];
  const changed = version===0
    ? await db.prepare('INSERT INTO custom_report_schedules (report_id,frequency,day,hour,minute,recipient_ids,enabled,next_run) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (report_id) DO NOTHING RETURNING version').get(report.id,...values)
    : await db.prepare('UPDATE custom_report_schedules SET frequency=?,day=?,hour=?,minute=?,recipient_ids=?,enabled=?,next_run=?,version=version+1 WHERE report_id=? AND version=? RETURNING version').get(...values,report.id,version);
  if (!changed) return res.status(409).json({ error: 'Schedule changed. Reload before saving.',code: 'REPORT_SCHEDULE_CONFLICT' });
  await logAudit(db,req,'custom_report',report.id,report.name,'schedule_updated',enabled ? frequency : 'disabled');
  res.json({ version: changed.version,next_run: next });
});

router.post('/preview',async (req,res) => res.json(await run(req.body,100)));
router.post('/exports',async (req,res) => {
  if (!req.body || !['csv','xlsx'].includes(req.body.format)) return res.status(400).json({ error:'Export format must be csv or xlsx' });
  compileReport(req.body.definition,5000);
  if (!fileCipher.isConfigured()) return res.status(503).json({ error:'Encrypted export storage is unavailable' });
  const job=await backgroundJobs.enqueue('custom_report_export',{ definition:req.body.definition,format:req.body.format },{ createdBy:req.user.id,maxAttempts:2,priority:80 });
  res.status(202).json({ id:job.id,status:job.status });
});
router.get('/exports/:jobId',async (req,res) => {
  if (!id(req.params.jobId)) return res.status(400).json({ error:'Invalid export job ID' });
  const job=await db.prepare("SELECT id,status,result,error,artifact_name,artifact_expires_at,created_at,completed_at FROM background_jobs WHERE id=? AND type='custom_report_export' AND created_by=?").get(Number(req.params.jobId),req.user.id);
  if (!job) return res.status(404).json({ error:'Export job not found' });
  let result=null;try { result=job.result ? JSON.parse(job.result) : null; } catch { /* malformed result remains unavailable */ }
  res.json({ ...job,result,error:job.status==='failed' ? job.error : null,ready:job.status==='completed' && !!job.artifact_name && (!job.artifact_expires_at || job.artifact_expires_at>backgroundJobs.dbTimestamp()) });
});
router.get('/exports/:jobId/download',async (req,res) => {
  if (!id(req.params.jobId)) return res.status(400).json({ error:'Invalid export job ID' });
  const job=await db.prepare("SELECT * FROM background_jobs WHERE id=? AND type='custom_report_export' AND created_by=? AND status='completed'").get(Number(req.params.jobId),req.user.id);
  if (!job) return res.status(404).json({ error:'Completed export not found' });
  if (!job.artifact_path || job.artifact_expires_at<=backgroundJobs.dbTimestamp()) return res.status(410).json({ error:'This export has expired. Generate it again.' });
  const target=path.resolve(exportRoot,path.basename(job.artifact_path));
  if (!target.startsWith(`${exportRoot}${path.sep}`)) return res.status(404).json({ error:'Export artifact not found' });
  try {
    const buffer=fileCipher.decrypt(await fs.promises.readFile(target),job.artifact_iv,job.artifact_tag);
    await db.prepare('UPDATE background_jobs SET artifact_downloaded_at=app_now() WHERE id=?').run(job.id);
    res.setHeader('Content-Type',job.artifact_type || 'application/octet-stream');
    res.setHeader('Content-Disposition',`attachment; filename="${job.artifact_name === 'custom-report.csv' ? 'custom-report.csv' : 'custom-report.xlsx'}"`);
    res.send(buffer);
  } catch(error) {
    if (error.code==='ENOENT') return res.status(410).json({ error:'This export is no longer available. Generate it again.' });
    throw error;
  }
});
router.post('/export-csv',async (req,res) => {
  const result = await run(req.body,5000);
  if (result.truncated) return res.status(413).json({ error: 'Report exceeds 5000 rows. Narrow the filters before exporting.' });
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename="custom-report.csv"');
  res.send(csv(result));
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
