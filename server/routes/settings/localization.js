const router = require('express').Router();
const db = require('../../db');
const { requireManager, requireAuth } = require('../../middleware/auth');
const { isPlainObject, logSettingsChange } = require('./shared');

const DEFAULT_LOCALIZATION = {
  default_language: 'en',
  supported_languages: ['en', 'el'],
  date_format: 'DD/MM/YYYY',
  time_format: '24h',
  number_format: '1,000.00',
  timezone: 'Asia/Nicosia',
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
    timezone: typeof body.timezone === 'string' && body.timezone.length <= 80 ? body.timezone : DEFAULT_LOCALIZATION.timezone,
  };
  if (!cfg.supported_languages.length) cfg.supported_languages = DEFAULT_LOCALIZATION.supported_languages;
  (await db.prepare("INSERT INTO settings (key,value) VALUES ('localization_config',?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").run(JSON.stringify(cfg)));
  await logSettingsChange(req, 'localization_updated', `language=${cfg.default_language}; timezone=${cfg.timezone}`);
  res.json({ ok: true });
});

module.exports = router;
