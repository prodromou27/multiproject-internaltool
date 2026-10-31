/**
 * /api/bots — where Webex and Microsoft Teams deliver chat messages for the
 * activity bot. These are public by necessity; each request is authenticated
 * by the platform instead (Webex: HMAC signature with the webhook secret;
 * Teams: Microsoft-signed token for our app id). Messages are acknowledged at
 * once and answered in the background.
 */
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const botSettings = require('../activityBot/settings');
const channels = require('../activityBot/channels');

router.use(rateLimit({ windowMs: 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));

const inBackground = (label, work) => setImmediate(() => work().catch(error => console.error(`[activity bot] ${label}:`, error.message)));

router.post('/webex/events', async (req, res) => {
  const settings = await botSettings.load();
  if (!settings.webex.enabled || !settings.webex.webhook_secret) return res.status(404).json({ error: 'Not enabled' });
  if (!channels.verifyWebexSignature(req.rawBody, req.get('x-spark-signature'), settings.webex.webhook_secret)) return res.status(401).json({ error: 'Invalid signature' });
  res.status(200).json({ ok: true });
  inBackground('webex', () => channels.handleWebexEvent(req.body));
});

router.post('/teams/messages', async (req, res) => {
  const settings = await botSettings.load();
  if (!settings.teams.enabled || !settings.teams.app_id || !settings.teams.app_password) return res.status(404).json({ error: 'Not enabled' });
  let verified = false;
  try { verified = await channels.verifyTeamsRequest(req.get('authorization'), req.body, settings.teams.app_id); }
  catch (error) { console.error('[activity bot] teams verification:', error.message); }
  if (!verified) return res.status(401).json({ error: 'Unauthorized' });
  res.status(200).json({});
  inBackground('teams', () => channels.handleTeamsActivity(req.body, settings.teams));
});

module.exports = router;
