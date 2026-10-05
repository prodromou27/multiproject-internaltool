const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { test, assert, db, ids } = require('./lib/activityFixture');
const suite = require('./lib/activityFixture');
const http = require('../activityBot/http');
const botSettings = require('../activityBot/settings');
const channels = require('../activityBot/channels');

const wait = async (check, label) => { for (let i = 0; i < 60; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 100)); } assert.fail(`timed out waiting for ${label}`); };
const engineerEmail = async () => (await db.prepare('SELECT email FROM users WHERE id = ?').get(ids.engineerEnabled)).email;
const setWebexToken = async token => db.prepare("INSERT INTO settings (key, value) VALUES ('integrations', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value")
  .run(JSON.stringify({ teams: { enabled: false }, webex: { enabled: true, bot_token: token, mode: 'direct' }, notify_on: {} }));

test('Webex: signed deliveries from a direct chat get a drafted activity, and "yes" saves it', async () => {
  require('../activityBot/appApi').setBase(suite.baseUrl);
  const secret = 'webex-secret-for-tests';
  await setWebexToken('bot-token');
  const email = await engineerEmail();
  const messages = { m1: { text: '45m support for Acme, ticket 9001', roomType: 'direct', roomId: 'room-1', personEmail: email },
    m2: { text: 'yes', roomType: 'direct', roomId: 'room-1', personEmail: email },
    group: { text: '1h support for Acme', roomType: 'group', roomId: 'room-2', personEmail: email },
    stranger: { text: 'hello', roomType: 'direct', roomId: 'room-3', personEmail: 'someone@elsewhere.example' } };
  const sent = [];
  http._setTransport(async ({ method, url, headers, body }) => {
    assert.equal(headers.Authorization, 'Bearer bot-token');
    const id = decodeURIComponent(url.split('/messages/')[1] || '');
    if (method === 'GET' && messages[id]) return { status: 200, text: JSON.stringify(messages[id]) };
    if (method === 'POST' && url.endsWith('/v1/messages')) { sent.push(JSON.parse(body)); return { status: 200, text: '{}' }; }
    return { status: 404, text: '{}' };
  });
  const deliver = async (id, { sign = secret, personEmail = email } = {}) => {
    const raw = JSON.stringify({ resource: 'messages', event: 'created', data: { id, personEmail } });
    return fetch(`${suite.baseUrl}/api/bots/webex/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Spark-Signature': crypto.createHmac('sha1', sign).update(raw).digest('hex') }, body: raw });
  };
  try {
    assert.equal((await deliver('m1')).status, 404, 'off until enabled');
    await botSettings.save({ webex: { enabled: true, webhook_secret: secret, webhook_id: 'wh-1' } });
    assert.equal((await deliver('m1', { sign: 'wrong-secret' })).status, 401);
    assert.equal(sent.length, 0);

    assert.equal((await deliver('m1')).status, 200);
    await wait(() => sent.length === 1, 'the draft');
    assert.equal(sent[0].roomId, 'room-1');
    assert.match(sent[0].markdown, /Customer: Acme Corp[\s\S]*Ticket: 9001[\s\S]*Reply \*\*yes\*\*/);
    await deliver('m1'); // Webex redelivers: answered once only
    await deliver('m2');
    await wait(() => sent.length === 2, 'the saved reply');
    assert.match(sent[1].markdown, /✅ Saved \*\*ACT-/);
    const saved = await db.prepare("SELECT engineer_id, ticket_reference FROM service_activities WHERE ticket_reference = '9001'").get();
    assert.deepEqual([saved.engineer_id, saved.ticket_reference], [ids.engineerEnabled, '9001']);

    await deliver('group'); await deliver('stranger');
    await wait(() => sent.length === 3, 'the stranger reply');
    assert.equal(sent[2].roomId, 'room-3', 'group spaces are not answered');
    assert.match(sent[2].markdown, /couldn't match your chat account/);
    // The bot's own messages are never answered.
    assert.equal((await deliver('m9', { personEmail: 'teamhub@webex.bot' })).status, 200);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(sent.length, 3);
  } finally { http._setTransport(); }
});

test('Webex: registering the webhook replaces an old one and stores a fresh secret', async () => {
  const before = process.env.APP_URL;
  const calls = [];
  http._setTransport(async ({ method, url, body }) => {
    calls.push(`${method} ${url.replace('https://webexapis.com/v1', '')}`);
    if (method === 'GET') return { status: 200, text: JSON.stringify({ items: [{ id: 'old', targetUrl: 'https://teamhub.example/api/bots/webex/events' }, { id: 'other', targetUrl: 'https://elsewhere/x' }] }) };
    if (method === 'POST') { const hook = JSON.parse(body); assert.equal(hook.targetUrl, 'https://teamhub.example/api/bots/webex/events'); assert.match(hook.secret, /^[0-9a-f]{64}$/); return { status: 200, text: JSON.stringify({ id: 'new-hook' }) }; }
    return { status: 204, text: '' };
  });
  try {
    process.env.APP_URL = 'http://teamhub.example';
    await assert.rejects(channels.registerWebexWebhook(), /public https/);
    process.env.APP_URL = 'https://teamhub.example';
    await channels.registerWebexWebhook();
    assert.deepEqual(calls, ['GET /webhooks?max=100', 'DELETE /webhooks/old', 'POST /webhooks']);
    const stored = await db.prepare("SELECT value FROM settings WHERE key = 'activity_bot'").get();
    // With an encryption key configured (as in production) the secret is stored encrypted.
    if (process.env.CUSTOMER_FIELD_KEY) assert.doesNotMatch(stored.value, /"webhook_secret":"[0-9a-f]{64}"/, 'the secret is encrypted at rest');
    assert.match((await botSettings.load()).webex.webhook_secret, /^[0-9a-f]{64}$/);
    assert.equal((await botSettings.load()).webex.webhook_id, 'new-hook');
  } finally { http._setTransport(); process.env.APP_URL = before; }
});

test('Teams: only Microsoft-signed messages for our app are answered, and replies go back to Microsoft', async () => {
  require('../activityBot/appApi').setBase(suite.baseUrl);
  channels._resetCaches();
  const appId = '11111111-2222-3333-4444-555555555555';
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig' };
  const serviceUrl = 'https://smba.trafficmanager.net/emea/';
  const email = await engineerEmail();
  const sent = [];
  http._setTransport(async ({ method, url, body }) => {
    if (url === 'https://login.botframework.com/v1/.well-known/openidconfiguration') return { status: 200, text: JSON.stringify({ jwks_uri: 'https://login.botframework.com/v1/.well-known/keys' }) };
    if (url === 'https://login.botframework.com/v1/.well-known/keys') return { status: 200, text: JSON.stringify({ keys: [jwk] }) };
    if (url.startsWith('https://login.microsoftonline.com/')) return { status: 200, text: JSON.stringify({ access_token: 'outbound-token', expires_in: 3600 }) };
    if (method === 'GET' && url.includes('/members/')) return { status: 200, text: JSON.stringify({ email }) };
    if (method === 'POST' && url.includes('/activities/')) { sent.push({ url, ...JSON.parse(body) }); return { status: 200, text: '{}' }; }
    return { status: 404, text: '{}' };
  });
  const token = (claims = {}, key = privateKey) => jwt.sign({ serviceurl: serviceUrl, ...claims }, key, { algorithm: 'RS256', keyid: 'test-key', audience: appId, issuer: 'https://api.botframework.com', expiresIn: '5m' });
  const activity = (id, text, extra = {}) => ({ type: 'message', id, text, serviceUrl, from: { id: 'user-1' }, conversation: { id: 'conv-1', conversationType: 'personal' }, ...extra });
  const post = (body, bearer) => fetch(`${suite.baseUrl}/api/bots/teams/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body) });
  try {
    assert.equal((await post(activity('a1', 'hi'), token())).status, 404, 'off until enabled');
    await botSettings.save({ teams: { enabled: true, app_id: appId, app_password: 'app-secret', tenant_id: '' } });
    assert.equal((await post(activity('a1', 'hi'))).status, 401, 'no token');
    assert.equal((await post(activity('a1', 'hi'), token({}, crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey))).status, 401, 'signed by someone else');
    assert.equal((await post(activity('a1', 'hi'), jwt.sign({ serviceurl: serviceUrl }, privateKey, { algorithm: 'RS256', keyid: 'test-key', audience: 'another-app', issuer: 'https://api.botframework.com' }))).status, 401, 'for another bot');
    assert.equal((await post(activity('a1', 'hi', { serviceUrl: 'https://evil.example/' }), token({ serviceurl: 'https://evil.example/' }))).status, 401, 'replies would go outside Microsoft');

    assert.equal((await post(activity('a2', '<at>TeamHub</at> 1h support for Acme yesterday'), token())).status, 200);
    await wait(() => sent.length === 1, 'the Teams draft');
    assert.equal(sent[0].url, 'https://smba.trafficmanager.net/emea/v3/conversations/conv-1/activities/a2');
    assert.match(sent[0].text, /Customer: Acme Corp[\s\S]*Time: 1h/);
    assert.equal((await post(activity('a3', 'yes'), token())).status, 200);
    await wait(() => sent.length === 2, 'the Teams save');
    assert.match(sent[1].text, /✅ Saved/);
    // Group chats and channels are not answered.
    await post(activity('a4', '1h support for Acme', { conversation: { id: 'conv-2', conversationType: 'channel' } }), token());
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(sent.length, 2);
  } finally { http._setTransport(); channels._resetCaches(); await botSettings.save({ teams: { enabled: false } }); }
});
