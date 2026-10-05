/** Settings → Integrations → Activity bot (managers). */
const router = require('express').Router();
const { requireManager } = require('../../middleware/auth');
const { logSettingsChange } = require('./shared');
const botSettings = require('../../activityBot/settings');
const channels = require('../../activityBot/channels');
const { handleMessage } = require('../../activityBot/conversation');
const db = require('../../db');

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const send = (res, error, fallback) => res.status(error.status && error.status < 500 ? error.status : 502).json({ error: error.status && error.status < 500 ? error.message : `${fallback}: ${error.message}` });

router.get('/activity-bot', requireManager, async (req, res) => res.json(await botSettings.view()));

router.put('/activity-bot', requireManager, async (req, res) => {
  try {
    const body = req.body || {};
    const change = {};
    if (body.webex !== undefined) {
      if (typeof body.webex !== 'object' || Object.keys(body.webex).some(key => key !== 'enabled')) fail('Invalid Webex bot settings');
      if (typeof body.webex.enabled !== 'boolean') fail('webex.enabled must be true or false');
      change.webex = { enabled: body.webex.enabled };
    }
    if (body.teams !== undefined) {
      const teams = body.teams;
      if (typeof teams !== 'object' || Object.keys(teams).some(key => !['enabled', 'app_id', 'app_password', 'tenant_id'].includes(key))) fail('Invalid Teams bot settings');
      if (teams.enabled !== undefined && typeof teams.enabled !== 'boolean') fail('teams.enabled must be true or false');
      if (teams.app_id !== undefined && teams.app_id !== '' && !/^[0-9a-f-]{36}$/i.test(teams.app_id)) fail('The Microsoft App ID is a GUID like 00000000-0000-0000-0000-000000000000');
      if (teams.tenant_id !== undefined && teams.tenant_id !== '' && !/^[0-9a-f-]{36}$/i.test(teams.tenant_id)) fail('The tenant ID is a GUID like 00000000-0000-0000-0000-000000000000');
      if (teams.app_password !== undefined && (typeof teams.app_password !== 'string' || teams.app_password.length > 500)) fail('Invalid app password');
      change.teams = Object.fromEntries(Object.entries(teams).filter(([key, value]) => key !== 'app_password' || value !== ''));
      const current = await botSettings.load();
      const next = { ...current.teams, ...change.teams };
      if (next.enabled && (!next.app_id || !next.app_password)) fail('Enter the Microsoft App ID and password before turning the Teams bot on');
    }
    await botSettings.save(change);
    await logSettingsChange(req, 'activity_bot_updated', `webex=${change.webex?.enabled ?? '-'}; teams=${change.teams?.enabled ?? '-'}`);
    res.json(await botSettings.view());
  } catch (error) { send(res, error, 'Could not save the bot settings'); }
});

router.post('/activity-bot/webex/register', requireManager, async (req, res) => {
  try {
    const result = await channels.registerWebexWebhook();
    await logSettingsChange(req, 'activity_bot_webex_registered', `target=${result.target_url}`);
    res.json({ ...(await botSettings.view()), message: `Webex will now deliver messages to ${result.target_url}` });
  } catch (error) { send(res, error, 'Webex refused the webhook'); }
});

// Try the conversation from the settings page, as yourself.
router.post('/activity-bot/try', requireManager, async (req, res) => {
  const text = req.body?.text;
  if (typeof text !== 'string' || !text.trim() || text.length > 4000) return res.status(400).json({ error: 'Type a message to try' });
  const user = await db.prepare('SELECT id, name, email, role, token_version FROM users WHERE id = ?').get(req.user.id);
  try { res.json({ reply: await handleMessage({ user, channel: 'settings-try', text }) }); }
  catch (error) { send(res, error, 'The bot could not answer'); }
});

module.exports = router;
