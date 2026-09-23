const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const db = require('../../db');
const { requireManager } = require('../../middleware/auth');
const updateMgr = require('../../update-manager');
const { isInAppUpdateEnabled, requireInAppUpdateEnabled } = require('../../security');
const { getRuntimeConfigIssues } = require('../../config');
const { keyStatus } = require('../../fieldCipher');
const pkg = require('../../package.json');
const { bytes, directoryBytes, customerEncryptionReport, logSettingsChange } = require('./shared');

/* ── System Update ──────────────────────────────────────────── */

// GET /api/settings/system-update/status
router.get('/system-update/status', requireManager, async (req, res) => {
  res.json({ ...updateMgr.state, updates_enabled: isInAppUpdateEnabled() });
});

// GET /api/settings/deployment-health
router.get('/deployment-health', requireManager, async (req, res) => {
  const checks = [];
  const add = (key, label, status, detail) => checks.push({ key, label, status, detail });
  const isProd = process.env.NODE_ENV === 'production';
  const { errors, warnings } = getRuntimeConfigIssues(process.env);

  if (errors.length) add('runtime_config', 'Runtime configuration', 'error', errors.join('; '));
  else if (warnings.length) add('runtime_config', 'Runtime configuration', 'warning', warnings.join('; '));
  else add('runtime_config', 'Runtime configuration', 'ok', 'Required environment values are present.');

  try {
    await db.prepare('SELECT 1 AS ok').get();
    add('database', 'PostgreSQL connection', 'ok', 'Database query succeeded.');
  } catch {
    add('database', 'PostgreSQL connection', 'error', 'Database query failed.');
  }
  try {
    const migrations = await db.prepare('SELECT COUNT(*)::int AS count FROM schema_migrations').get();
    add('schema_migrations', 'Schema migrations', 'ok', `${migrations?.count ?? 0} compatibility migration(s) applied.`);
  } catch {
    add('schema_migrations', 'Schema migrations', 'warning', 'Could not inspect schema migration status.');
  }
  const database = db.queryMetrics();
  const elevatedFailureRate = database.count >= 100 && database.failed / database.count >= 0.05;
  add(
    'database_performance',
    'Database performance',
    database.pool.waiting > 0 || elevatedFailureRate || database.recent_slow.length >= 5 ? 'warning' : 'ok',
    `${database.count} observed queries; ${database.average_ms}ms average; ${database.slow} over ${database.threshold_ms}ms; ${database.failed} failed; pool ${database.pool.idle}/${database.pool.total} idle${database.pool.waiting ? `, ${database.pool.waiting} waiting` : ''}.`
  );

  async function operationalRecord(key) {
    const row = await db.prepare('SELECT value FROM settings WHERE key=?').get(key);
    if (!row) return null;
    try { return JSON.parse(row.value); } catch { return null; }
  }
  try {
    const backup = await operationalRecord('last_backup_status');
    const backupAge = backup?.completed_at ? Date.now() - Date.parse(backup.completed_at) : Infinity;
    add('database_backup', 'Database backup', backupAge <= 36 * 60 * 60 * 1000 ? 'ok' : 'warning',
      backup ? `${backup.file || 'Backup'} completed ${backup.completed_at}; archive ${bytes(Number(backup.size_bytes) || 0)}.` : 'No successful backup has been recorded.');
    const restore = await operationalRecord('last_restore_verification');
    const restoreAge = restore?.completed_at ? Date.now() - Date.parse(restore.completed_at) : Infinity;
    add('restore_verification', 'Backup restore verification', restoreAge <= 31 * 24 * 60 * 60 * 1000 ? 'ok' : 'warning',
      restore ? `${restore.file || 'Backup'} restored into a temporary database and passed checks at ${restore.completed_at}.` : 'No non-destructive restore verification has been recorded.');
  } catch {
    add('database_backup', 'Database backup', 'warning', 'Could not inspect backup status.');
  }

  add(
    'attachment_encryption',
    'Attachment encryption',
    process.env.ATTACHMENT_KEY ? 'ok' : (isProd ? 'error' : 'warning'),
    process.env.ATTACHMENT_KEY ? 'ATTACHMENT_KEY is configured.' : 'ATTACHMENT_KEY is not configured.'
  );
  add(
    'customer_field_encryption',
    'Customer field encryption',
    process.env.CUSTOMER_FIELD_KEY ? 'ok' : (isProd ? 'error' : 'warning'),
    process.env.CUSTOMER_FIELD_KEY ? 'CUSTOMER_FIELD_KEY is configured.' : 'CUSTOMER_FIELD_KEY is not configured.'
  );
  try {
    const key = keyStatus();
    add(
      'customer_key_management',
      'Customer encryption key',
      key.configured ? 'ok' : (isProd ? 'error' : 'warning'),
      key.configured
        ? `AES-256-GCM key active. Fingerprint: ${key.fingerprint}.`
        : 'No active customer encryption key.'
    );
    const coverage = await customerEncryptionReport();
    add(
      'customer_encryption_coverage',
      'Customer encryption coverage',
      coverage.plaintext_fields > 0 ? (isProd ? 'error' : 'warning') : 'ok',
      coverage.plaintext_fields > 0
        ? `${coverage.plaintext_fields} populated customer field(s) across ${coverage.affected_rows} row(s) are plaintext.`
        : `All populated customer fields are encrypted across ${coverage.rows} customer row(s).`
    );
  } catch {
    add('customer_encryption_coverage', 'Customer encryption coverage', 'warning', 'Could not inspect customer encryption coverage.');
  }
  add(
    'app_url',
    'Public app URL',
    process.env.APP_URL ? (isProd && process.env.APP_URL.startsWith('http://') ? 'warning' : 'ok') : (isProd ? 'error' : 'warning'),
    process.env.APP_URL || 'APP_URL is not configured.'
  );
  add(
    'in_app_updates',
    'In-app updates',
    isProd && isInAppUpdateEnabled() ? 'warning' : 'ok',
    isInAppUpdateEnabled() ? 'In-app package updates are enabled.' : 'In-app package updates are disabled; use Docker/branch deployment.'
  );
  add(
    'cors',
    'CORS policy',
    'ok',
    process.env.ALLOWED_ORIGIN ? `Restricted to ${process.env.ALLOWED_ORIGIN}.` : 'Cross-origin requests are disabled.'
  );
  add(
    'reverse_proxy',
    'Reverse proxy trust',
    process.env.TRUST_PROXY ? 'ok' : (isProd ? 'warning' : 'ok'),
    process.env.TRUST_PROXY ? `Trusting ${process.env.TRUST_PROXY} proxy hop(s).` : 'TRUST_PROXY is not set.'
  );
  add(
    'deployment_revision',
    'Deployment revision',
    process.env.APP_REVISION && process.env.APP_REVISION !== 'unknown' ? 'ok' : 'warning',
    `branch=${process.env.DEPLOY_BRANCH || 'unknown'}; revision=${process.env.APP_REVISION || 'unknown'}`
  );

  const uploadsDir = path.join(__dirname, '../../uploads');
  try {
    const uploadBytes = directoryBytes(uploadsDir);
    add('uploads_storage', 'Uploads storage', uploadBytes > 500 * 1024 * 1024 ? 'warning' : 'ok', `${bytes(uploadBytes)} in uploads.`);
  } catch {
    add('uploads_storage', 'Uploads storage', 'warning', 'Could not inspect uploads directory.');
  }
  try {
    fs.mkdirSync(uploadsDir, { recursive: true });
    const probe = path.join(uploadsDir, `.write-test-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    add('uploads_writable', 'Uploads volume writable', 'ok', 'App can write to the uploads volume.');
  } catch {
    add('uploads_writable', 'Uploads volume writable', 'error', 'App cannot write to the uploads volume.');
  }
  try {
    if (typeof fs.statfsSync === 'function') {
      const stats = fs.statfsSync(uploadsDir);
      const free = Number(stats.bavail) * Number(stats.bsize);
      const total = Number(stats.blocks) * Number(stats.bsize);
      const pctFree = total > 0 ? (free / total) * 100 : 0;
      add('disk_free', 'Disk free space', pctFree < 10 ? 'warning' : 'ok', `${bytes(free)} free of ${bytes(total)} (${pctFree.toFixed(1)}% free).`);
    } else {
      add('disk_free', 'Disk free space', 'warning', 'Disk free-space API is unavailable in this Node runtime.');
    }
  } catch {
    add('disk_free', 'Disk free space', 'warning', 'Could not inspect disk free space.');
  }

  const status = checks.some(c => c.status === 'error')
    ? 'error'
    : checks.some(c => c.status === 'warning') ? 'warning' : 'ok';

  res.json({
    status,
    checked_at: new Date().toISOString(),
    app: {
      name: pkg.name,
      version: pkg.version,
      node_env: process.env.NODE_ENV || 'development',
      deploy_branch: process.env.DEPLOY_BRANCH || null,
      revision: process.env.APP_REVISION || null,
      uptime_seconds: Math.round(process.uptime()),
      pid: process.pid,
    },
    database,
    checks,
  });
});

// POST /api/settings/system-update/check
router.post('/system-update/check', requireManager, requireInAppUpdateEnabled, async (req, res) => {
  if (updateMgr.state.running) return res.status(409).json({ error: 'Update in progress' });
  try {
    const outdated = await updateMgr.checkOutdated();
    updateMgr.state.outdated = outdated;
    await logSettingsChange(req, 'system_update_checked', null);
    res.json({ outdated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/settings/system-update/start  — install + build (async)
router.post('/system-update/start', requireManager, requireInAppUpdateEnabled, async (req, res) => {
  if (updateMgr.state.running) return res.status(409).json({ error: 'Update already in progress' });
  updateMgr.state.phase   = 'queued';
  updateMgr.state.log     = [];
  updateMgr.state.error   = null;
  updateMgr.state.done_at = null;
  updateMgr.state.needs_restart = false;
  updateMgr.state.started_at = new Date().toISOString();
  await logSettingsChange(req, 'system_update_started', null);
  res.json({ ok: true, message: 'Update started' });
  // Run asynchronously — client polls /status
  setImmediate(() => updateMgr.runUpdate());
});

// POST /api/settings/system-update/restart  — restart the server
router.post('/system-update/restart', requireManager, requireInAppUpdateEnabled, async (req, res) => {
  await logSettingsChange(req, 'system_restart_requested', null);
  res.json({ ok: true, message: 'Restarting…' });
  updateMgr.scheduleRestart();
});

module.exports = router;
