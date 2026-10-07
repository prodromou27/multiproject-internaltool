const router = require('express').Router();
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const db = require('../../db');
const { requireManager } = require('../../middleware/auth');
const { logAudit } = require('../../auditLog');
const backups = require('../../databaseBackups');

/* Settings → System → Backups. Managers only. Downloading, uploading and
   restoring a backup expose or replace the whole database, so they also ask
   for the manager's password. */

const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 1 } }).single('file');
const send = (res, error, fallback) => res.status(error.status || 500).json({ error: error.status ? error.message : fallback });

async function confirmPassword(req) {
  const row = await db.prepare('SELECT password FROM users WHERE id=?').get(req.user.id);
  const password = req.body?.password;
  if (typeof password !== 'string' || !password || !row?.password || !await bcrypt.compare(password, row.password))
    throw Object.assign(new Error('Your password was not correct'), { status: 403 });
}

let toolCheck = null;
function toolsAvailable() {
  toolCheck ||= new Promise(resolve => {
    const { spawn } = require('child_process');
    const bin = process.env.PG_BIN_DIR ? require('path').join(process.env.PG_BIN_DIR, 'pg_dump') : 'pg_dump';
    let out = '';
    const child = spawn(bin, ['--version'], { windowsHide: true });
    child.stdout.on('data', chunk => { out += chunk; });
    child.on('error', () => resolve(null));
    child.on('close', code => resolve(code === 0 ? out.trim() : null));
  });
  return toolCheck;
}

router.get('/backups', requireManager, async (req, res) => {
  res.json({ rows: backups.list(), schedule: await backups.schedule(), ...backups.status(), tools: await toolsAvailable() });
});

router.put('/backups/schedule', requireManager, async (req, res) => {
  try {
    const value = backups.validateSchedule(req.body);
    await db.prepare("INSERT INTO settings (key, value) VALUES ('backup_schedule', ?) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value").run(JSON.stringify(value));
    await logAudit(db, req, 'settings', 'backup_schedule', 'Database backups', 'backup_schedule_updated', `enabled=${value.enabled}; time=${value.time}; retention_days=${value.retention_days}; keep_min=${value.keep_min}`);
    res.json(value);
  } catch (error) { send(res, error, 'Could not save the backup schedule'); }
});

router.post('/backups', requireManager, async (req, res) => {
  try {
    const row = await backups.exclusive('backup', () => backups.backupNow({ kind: 'manual', userName: req.user.name }));
    await logAudit(db, req, 'settings', 'database_backup', row.file, 'database_backup_created', `size=${row.size_bytes}`);
    res.status(201).json(row);
  } catch (error) { send(res, error, 'Could not back up the database'); }
});

router.post('/backups/upload', requireManager, (req, res, next) => upload(req, res, error => {
  if (error) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'The backup must be 2 GB or smaller' : 'Upload one .sql.gz backup file' });
  next();
}), async (req, res) => {
  try {
    if (!req.file) throw Object.assign(new Error('Choose a backup file'), { status: 400 });
    await confirmPassword(req);
    const row = await backups.importUpload(req.file.path, { userName: req.user.name });
    await logAudit(db, req, 'settings', 'database_backup', row.file, 'database_backup_uploaded', `original=${String(req.file.originalname).slice(0, 120)}; size=${row.size_bytes}`);
    res.status(201).json(row);
  } catch (error) { send(res, error, 'Could not save the uploaded backup'); }
  finally { if (req.file?.path) fs.rm(req.file.path, { force: true }, () => {}); }
});

router.post('/backups/:file/verify', requireManager, async (req, res) => {
  try {
    const result = await backups.exclusive('check', () => backups.verify(req.params.file));
    await logAudit(db, req, 'settings', 'database_backup', req.params.file, 'database_backup_verified', `tables=${result.tables}; users=${result.users}`);
    res.json(result);
  } catch (error) { send(res, error, 'Could not check the backup'); }
});

router.post('/backups/:file/download', requireManager, async (req, res) => {
  try {
    const target = backups.list().find(row => row.file === req.params.file);
    if (!target) throw Object.assign(new Error('Backup not found'), { status: 404 });
    await confirmPassword(req);
    await logAudit(db, req, 'settings', 'database_backup', target.file, 'database_backup_downloaded', `size=${target.size_bytes}`);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${target.file}"`);
    fs.createReadStream(require('path').join(backups.BACKUP_DIR, target.file)).pipe(res);
  } catch (error) { send(res, error, 'Could not download the backup'); }
});

router.post('/backups/:file/restore', requireManager, async (req, res) => {
  try {
    if (req.body?.confirm !== 'RESTORE') throw Object.assign(new Error('Type RESTORE to confirm'), { status: 400 });
    await confirmPassword(req);
    await logAudit(db, req, 'settings', 'database_backup', req.params.file, 'database_restore_started', '');
    const result = await backups.exclusive('restore', () => backups.restore(req.params.file, { userName: req.user.name }));
    // The audit log was replaced with the backup's; record the restore in the restored one.
    await logAudit(db, req, 'settings', 'database_backup', req.params.file, 'database_restored', `safety_backup=${result.safety_backup}`).catch(() => {});
    res.json(result);
  } catch (error) { send(res, error, 'Could not restore the backup'); }
});

router.delete('/backups/:file', requireManager, async (req, res) => {
  try {
    backups.remove(req.params.file);
    await logAudit(db, req, 'settings', 'database_backup', req.params.file, 'database_backup_deleted', '');
    res.json({ ok: true });
  } catch (error) { send(res, error, 'Could not delete the backup'); }
});

module.exports = router;
