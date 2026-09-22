const router = require('express').Router();
const db = require('../../db');
const { requireManager } = require('../../middleware/auth');
const { isPlainObject, bool, logSettingsChange } = require('./shared');

/* ── Logging config ─────────────────────────────────────────── */
const DEFAULT_LOGGING = {
  log_level: 'info',
  logging_provider: 'file',
  log_retention_days: 30,
  structured_logging: true,
  correlation_id_enabled: true,
  request_logging: true,
  exception_logging: true,
  sensitive_data_masking: false,
  log_download_enabled: true,
};

router.get('/logging', requireManager, async (req, res) => {
  const row = (await db.prepare("SELECT value FROM settings WHERE key = 'logging_config'").get());
  if (!row) return res.json(DEFAULT_LOGGING);
  try { res.json({ ...DEFAULT_LOGGING, ...JSON.parse(row.value) }); }
  catch { res.json(DEFAULT_LOGGING); }
});

router.put('/logging', requireManager, async (req, res) => {
  const body = isPlainObject(req.body) ? req.body : {};
  const cfg = {
    log_level: ['debug', 'info', 'warn', 'error'].includes(body.log_level) ? body.log_level : DEFAULT_LOGGING.log_level,
    logging_provider: ['file', 'console'].includes(body.logging_provider) ? body.logging_provider : DEFAULT_LOGGING.logging_provider,
    log_retention_days: Math.min(3650, Math.max(1, parseInt(body.log_retention_days, 10) || DEFAULT_LOGGING.log_retention_days)),
    structured_logging: bool(body.structured_logging, DEFAULT_LOGGING.structured_logging),
    correlation_id_enabled: bool(body.correlation_id_enabled, DEFAULT_LOGGING.correlation_id_enabled),
    request_logging: bool(body.request_logging, DEFAULT_LOGGING.request_logging),
    exception_logging: bool(body.exception_logging, DEFAULT_LOGGING.exception_logging),
    sensitive_data_masking: bool(body.sensitive_data_masking, DEFAULT_LOGGING.sensitive_data_masking),
    log_download_enabled: bool(body.log_download_enabled, DEFAULT_LOGGING.log_download_enabled),
  };
  const value = JSON.stringify(cfg);
  (await db.prepare("INSERT INTO settings (key, value) VALUES ('logging_config', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").run(value));
  await logSettingsChange(req, 'logging_updated', `level=${cfg.log_level}; download=${cfg.log_download_enabled}`);
  res.json({ ok: true });
});

// GET /api/settings/logging/download — export recent activity as a log file
router.get('/logging/download', requireManager, async (req, res) => {
  const config = await (async () => {
    const row = (await db.prepare("SELECT value FROM settings WHERE key = 'logging_config'").get());
    if (!row) return DEFAULT_LOGGING;
    try { return { ...DEFAULT_LOGGING, ...JSON.parse(row.value) }; } catch { return DEFAULT_LOGGING; }
  })();

  if (!config.log_download_enabled)
    return res.status(403).json({ error: 'Log download is disabled.' });

  // Pull recent activity rows
  const rows = (await db.prepare(`
    SELECT pa.created_at, u.name as user_name, u.email, pa.action, pa.detail,
           p.title as project_title
    FROM project_activity pa
    LEFT JOIN users u ON u.id = pa.user_id
    LEFT JOIN projects p ON p.id = pa.project_id
    ORDER BY pa.created_at DESC
    LIMIT 1000
  `).all());

  const mask = config.sensitive_data_masking;
  const lines = [
    `# Application Log Export — ${new Date().toISOString()}`,
    `# Level: ${config.log_level.toUpperCase()} | Provider: ${config.logging_provider} | Retention: ${config.log_retention_days} days`,
    '',
    'timestamp,user,email,action,project,detail',
    ...rows.map(r => [
      r.created_at,
      r.user_name || 'system',
      mask ? '***@***.***' : (r.email || ''),
      r.action,
      r.project_title || '',
      (r.detail || '').replace(/,/g, ';'),
    ].join(','))
  ];

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', `attachment; filename="app-log-${Date.now()}.csv"`);
  res.send(lines.join('\n'));
});

module.exports = router;
