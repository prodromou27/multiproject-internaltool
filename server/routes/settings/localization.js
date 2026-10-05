const router = require('express').Router();
const db = require('../../db');
const { requireManager, requireAuth } = require('../../middleware/auth');
const { isPlainObject, logSettingsChange } = require('./shared');
const appTime = require('../../appTime');
const clock = require('../../ntpCheck');

const DEFAULT_LOCALIZATION = {
  default_language: 'en',
  supported_languages: ['en', 'el'],
  date_format: 'DD/MM/YYYY',
  time_format: '24h',
  number_format: '1,000.00',
  timezone: 'Asia/Nicosia',
  ntp_server: clock.DEFAULT_NTP_SERVER,
  ntp_check_enabled: true,
};

// Every authenticated role reads this — it drives date/time/number formatting
// across the whole app, not just admin screens. Only managers may change it (below).
router.get('/localization', requireAuth, async (req, res) => {
  const row = (await db.prepare("SELECT value FROM settings WHERE key='localization_config'").get());
  if (!row) return res.json(DEFAULT_LOCALIZATION);
  try { res.json({ ...DEFAULT_LOCALIZATION, ...JSON.parse(row.value) }); }
  catch { res.json(DEFAULT_LOCALIZATION); }
});

router.put('/localization', requireManager, async (req, res) => {
  const body = isPlainObject(req.body) ? req.body : {};
  // A wrong zone or NTP host is refused rather than silently replaced with a default.
  if (body.timezone !== undefined && !appTime.validTimeZone(body.timezone)) return res.status(400).json({ error: 'Choose a valid time zone, such as Europe/Athens' });
  if (body.ntp_server !== undefined && body.ntp_server !== '' && !clock.validServer(body.ntp_server)) return res.status(400).json({ error: 'Enter a valid NTP server host name or IPv4 address' });
  if (body.ntp_check_enabled !== undefined && typeof body.ntp_check_enabled !== 'boolean') return res.status(400).json({ error: 'ntp_check_enabled must be true or false' });
  const cfg = {
    default_language: ['en', 'el'].includes(body.default_language) ? body.default_language : DEFAULT_LOCALIZATION.default_language,
    supported_languages: Array.isArray(body.supported_languages)
      ? body.supported_languages.filter(v => ['en', 'el'].includes(v)).slice(0, 2)
      : DEFAULT_LOCALIZATION.supported_languages,
    // Must match client/src/pages/admin/LocalizationTab.jsx's DATE_FORMATS/NUMBER_FORMATS —
    // previously out of sync (missing 'D MMM YYYY', 'MMM D, YYYY' and '1 000.00'), so
    // picking any of those in the UI silently saved the default instead.
    date_format: ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'D MMM YYYY', 'MMM D, YYYY'].includes(body.date_format) ? body.date_format : DEFAULT_LOCALIZATION.date_format,
    time_format: ['24h', '12h'].includes(body.time_format) ? body.time_format : DEFAULT_LOCALIZATION.time_format,
    number_format: ['1,000.00', '1.000,00', '1 000.00', '1000.00'].includes(body.number_format) ? body.number_format : DEFAULT_LOCALIZATION.number_format,
    timezone: appTime.validTimeZone(body.timezone) ? body.timezone : DEFAULT_LOCALIZATION.timezone,
    ntp_server: body.ntp_server ? body.ntp_server : DEFAULT_LOCALIZATION.ntp_server,
    ntp_check_enabled: body.ntp_check_enabled !== false,
  };
  if (!cfg.supported_languages.length) cfg.supported_languages = DEFAULT_LOCALIZATION.supported_languages;
  (await db.prepare("INSERT INTO settings (key,value) VALUES ('localization_config',?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").run(JSON.stringify(cfg)));
  await logSettingsChange(req, 'localization_updated', `language=${cfg.default_language}; timezone=${cfg.timezone}; ntp_server=${cfg.ntp_server}`);
  await appTime.refreshTimeZone();
  res.json({ ok: true });
});

// The server's clock as the organisation sees it, and the last NTP drift check.
const clockView = () => {
  const now = new Date();
  return { now_utc: now.toISOString(), timezone: appTime.timeZone(), today: appTime.today(now),
    local_time: new Intl.DateTimeFormat('en-GB', { timeZone: appTime.timeZone(), dateStyle: 'medium', timeStyle: 'medium' }).format(now),
    warn_offset_ms: clock.WARN_OFFSET_MS, ntp: clock.lastCheck() };
};
router.get('/clock', requireManager, (req, res) => res.json(clockView()));
let lastManualCheck = 0;
router.post('/clock/check', requireManager, async (req, res) => {
  if (Date.now() - lastManualCheck < 5000) return res.status(429).json({ error: 'Wait a few seconds before checking again' });
  lastManualCheck = Date.now();
  const server = req.body?.server;
  if (server !== undefined && !clock.validServer(server)) return res.status(400).json({ error: 'Enter a valid NTP server host name or IPv4 address' });
  await clock.checkClock({ server });
  res.json(clockView());
});

module.exports = router;
