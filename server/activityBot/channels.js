/**
 * Webex and Microsoft Teams adapters for the activity bot.
 *
 * Both check that a message really comes from the platform before acting on
 * it — Webex by the webhook's HMAC signature, Teams by verifying Microsoft's
 * signed token — and answer only one-to-one chats. The chat account is matched
 * to an active TeamHub user by email address; the conversation itself
 * (conversation.js) then runs as that user.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../db');
const http = require('./http');
const botSettings = require('./settings');
const { handleMessage } = require('./conversation');

const WEBEX_API = 'https://webexapis.com/v1';
const UNKNOWN_SENDER = 'I couldn\'t match your chat account to a TeamHub user. Your Webex or Teams email address must be the same as your TeamHub account email.';

async function userByEmail(email) {
  if (typeof email !== 'string' || !email.includes('@')) return null;
  return db.prepare('SELECT id, name, email, role, token_version FROM users WHERE LOWER(email) = LOWER(?) AND active = 1').get(email.trim());
}

/** Remember a message id; false if it was already handled (platforms redeliver). */
async function firstTime(channel, messageId) {
  if (!messageId) return true;
  const result = await db.prepare('INSERT INTO bot_processed_messages (channel, message_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(channel, String(messageId).slice(0, 300));
  return result.changes === 1;
}
async function pruneProcessed() {
  await db.prepare('DELETE FROM bot_processed_messages WHERE received_at < ?').run(new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 19).replace('T', ' '));
}

// ── Webex ────────────────────────────────────────────────────────────────────
async function webexToken() {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'integrations'").get();
  try { return JSON.parse(row?.value || '{}').webex?.bot_token || ''; } catch { return ''; }
}

/** Webex signs each delivery: HMAC-SHA1 of the raw body with the webhook secret (X-Spark-Signature). */
function verifyWebexSignature(rawBody, signature, secret) {
  if (!rawBody || !secret || typeof signature !== 'string' || !/^[0-9a-f]{40}$/i.test(signature)) return false;
  const expected = crypto.createHmac('sha1', secret).update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature.toLowerCase(), 'hex'));
}

async function handleWebexEvent(event) {
  if (event?.resource !== 'messages' || event?.event !== 'created' || !event.data?.id) return 'ignored';
  // Bots' own messages (including this one's replies) come back as events too.
  if (/@webex\.bot$/i.test(event.data.personEmail || '')) return 'ignored';
  if (!await firstTime('webex', event.data.id)) return 'duplicate';
  const token = await webexToken();
  if (!token) return 'no-token';
  const headers = { Authorization: `Bearer ${token}` };
  const message = await http.request('GET', `${WEBEX_API}/messages/${encodeURIComponent(event.data.id)}`, { headers });
  if (message.roomType !== 'direct') return 'ignored'; // one-to-one chats only
  const user = await userByEmail(message.personEmail);
  const reply = user ? await handleMessage({ user, channel: 'webex', text: message.text }) : UNKNOWN_SENDER;
  await http.request('POST', `${WEBEX_API}/messages`, { headers, json: { roomId: message.roomId, markdown: reply } });
  return 'answered';
}

/** Register (or replace) the Webex webhook that delivers direct messages to this app. */
async function registerWebexWebhook() {
  const token = await webexToken();
  if (!token) throw Object.assign(new Error('Add the Webex bot token under Webex notifications first'), { status: 400 });
  const base = botSettings.publicUrl();
  if (!/^https:\/\//i.test(base)) throw Object.assign(new Error('Set APP_URL to the app\'s public https:// address first, so Webex can reach it'), { status: 400 });
  const targetUrl = `${base}/api/bots/webex/events`;
  const headers = { Authorization: `Bearer ${token}` };
  const existing = await http.request('GET', `${WEBEX_API}/webhooks?max=100`, { headers });
  for (const hook of existing?.items || []) {
    if (hook.targetUrl === targetUrl) await http.request('DELETE', `${WEBEX_API}/webhooks/${encodeURIComponent(hook.id)}`, { headers }).catch(() => {});
  }
  const secret = crypto.randomBytes(32).toString('hex');
  const created = await http.request('POST', `${WEBEX_API}/webhooks`, { headers, json: { name: 'TeamHub activity bot', targetUrl, resource: 'messages', event: 'created', secret } });
  await botSettings.save({ webex: { webhook_secret: secret, webhook_id: created.id } });
  return { target_url: targetUrl };
}

// ── Microsoft Teams (Bot Framework) ─────────────────────────────────────────
const OPENID = 'https://login.botframework.com/v1/.well-known/openidconfiguration';
let keyCache = { at: 0, keys: [] };
async function signingKeys() {
  if (Date.now() - keyCache.at < 24 * 3600 * 1000 && keyCache.keys.length) return keyCache.keys;
  const config = await http.request('GET', OPENID);
  if (!/^https:\/\/login\.botframework\.com\//.test(config?.jwks_uri || '')) throw new Error('Unexpected Bot Framework key location');
  const jwks = await http.request('GET', config.jwks_uri);
  keyCache = { at: Date.now(), keys: jwks?.keys || [] };
  return keyCache.keys;
}

/** Microsoft's message service addresses only; replies (with our token) go nowhere else. */
function trustedServiceUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /(^|\.)(botframework\.com|botframework\.us|trafficmanager\.net|teams\.microsoft\.com)$/i.test(url.hostname);
  } catch { return false; }
}

/** Verify the Bearer token Microsoft attaches to each message. */
async function verifyTeamsRequest(authorization, activity, appId) {
  const token = /^Bearer (.+)$/.exec(authorization || '')?.[1];
  if (!token || !appId) return false;
  const header = jwt.decode(token, { complete: true })?.header;
  const key = (await signingKeys()).find(item => item.kid === header?.kid);
  if (!key) { keyCache.at = 0; return false; }
  try {
    const claims = jwt.verify(token, crypto.createPublicKey({ key, format: 'jwk' }), { algorithms: ['RS256'], audience: appId, issuer: 'https://api.botframework.com', clockTolerance: 300 });
    return claims.serviceurl === activity?.serviceUrl && trustedServiceUrl(activity.serviceUrl);
  } catch { return false; }
}

let tokenCache = { value: '', expires: 0, for: '' };
async function botToken(teams) {
  const cacheKey = `${teams.app_id}|${teams.tenant_id}`;
  if (tokenCache.value && tokenCache.for === cacheKey && Date.now() < tokenCache.expires - 60000) return tokenCache.value;
  const tenant = /^[0-9a-f-]{36}$/i.test(teams.tenant_id || '') ? teams.tenant_id : 'botframework.com';
  const result = await http.request('POST', `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    form: { grant_type: 'client_credentials', client_id: teams.app_id, client_secret: teams.app_password, scope: 'https://api.botframework.com/.default' },
  });
  tokenCache = { value: result.access_token, expires: Date.now() + Number(result.expires_in || 3600) * 1000, for: cacheKey };
  return tokenCache.value;
}

const plainText = text => String(text || '').replace(/<at>.*?<\/at>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

async function handleTeamsActivity(activity, teams) {
  if (activity?.type !== 'message' || activity.conversation?.conversationType !== 'personal') return 'ignored';
  if (!trustedServiceUrl(activity.serviceUrl)) return 'ignored';
  if (!await firstTime('teams', activity.id)) return 'duplicate';
  const base = activity.serviceUrl.replace(/\/+$/, '');
  const conversationId = encodeURIComponent(activity.conversation.id);
  const headers = { Authorization: `Bearer ${await botToken(teams)}` };
  const member = await http.request('GET', `${base}/v3/conversations/${conversationId}/members/${encodeURIComponent(activity.from.id)}`, { headers });
  const user = await userByEmail(member?.email || member?.userPrincipalName);
  const reply = user ? await handleMessage({ user, channel: 'teams', text: plainText(activity.text) }) : UNKNOWN_SENDER;
  await http.request('POST', `${base}/v3/conversations/${conversationId}/activities/${encodeURIComponent(activity.id)}`, {
    headers, json: { type: 'message', textFormat: 'markdown', text: reply, replyToId: activity.id },
  });
  return 'answered';
}

module.exports = { verifyWebexSignature, handleWebexEvent, registerWebexWebhook, verifyTeamsRequest, handleTeamsActivity, trustedServiceUrl, pruneProcessed, _resetCaches: () => { keyCache = { at: 0, keys: [] }; tokenCache = { value: '', expires: 0, for: '' }; } };
