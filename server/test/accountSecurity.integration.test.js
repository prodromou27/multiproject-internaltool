// Account security (review F06, F07, F08, F12, F13, F17) and manager-edited Customer Responses.
// A field key, so seeds are stored encrypted as in production.
process.env.CUSTOMER_FIELD_KEY = process.env.CUSTOMER_FIELD_KEY || 'b'.repeat(64);
const speakeasy = require('speakeasy');
const { test, assert, api, db, bcrypt, signJwt } = require('./lib/activityFixture');
const email = require('../email');
const sent = [];
let smtpOn = false;
// routes/auth.js reads these when the fixture mounts it (in its before hook), so they are replaced now.
email.sendEmail = async message => { sent.push(message); };
email.getSmtpSettings = async () => (smtpOn ? { host: 'smtp.test.local' } : null);
const { isConfigured, isEncrypted, decrypt } = require('../fieldCipher');

async function person(name) {
  const id = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
    .run(name, `${name.toLowerCase().replace(/\s+/g, '.')}@test.local`, bcrypt.hashSync('Current#pass1', 4), 'pm')).lastInsertRowid;
  return { id, token: signJwt({ id, token_version: 0 }) };
}
const tokenOf = async id => signJwt({ id, token_version: (await db.prepare('SELECT token_version FROM users WHERE id = ?').get(id)).token_version });
const audit = async (id, action) => (await db.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE user_id = ? AND action = ?').get(id, action)).n;

test('changing the email needs the current password; without email set up it changes at once', async () => {
  smtpOn = false;
  const me = await person('Email Direct');
  const noPassword = await api('/api/auth/profile', { method: 'PUT', token: me.token, body: { name: 'Email Direct', email: 'new.direct@test.local' } });
  assert.equal(noPassword.status, 400);
  assert.match(noPassword.data.error, /current password/);
  const wrong = await api('/api/auth/profile', { method: 'PUT', token: me.token, body: { name: 'Email Direct', email: 'new.direct@test.local', current_password: 'nope' } });
  assert.equal(wrong.status, 400);
  assert.equal((await db.prepare('SELECT email FROM users WHERE id = ?').get(me.id)).email, 'email.direct@test.local');

  const renamed = await api('/api/auth/profile', { method: 'PUT', token: me.token, body: { name: 'Email Renamed', email: 'EMAIL.DIRECT@test.local' } });
  assert.equal(renamed.status, 200, 'a name change (same email) needs no password');

  const changed = await api('/api/auth/profile', { method: 'PUT', token: renamed.data.token, body: { name: 'Email Renamed', email: 'new.direct@test.local', current_password: 'Current#pass1' } });
  assert.equal(changed.status, 200);
  assert.equal(changed.data.user.email, 'new.direct@test.local');
  assert.equal(changed.data.pending_email, null);
  assert.equal(Number(await audit(me.id, 'email_changed')), 1);
});

test('with email set up, a new address only takes effect from the link sent to it, and the old address is told', async () => {
  smtpOn = true; sent.length = 0;
  const me = await person('Email Confirm');
  const asked = await api('/api/auth/profile', { method: 'PUT', token: me.token, body: { name: 'Email Confirm', email: 'confirmed.new@test.local', current_password: 'Current#pass1' } });
  assert.equal(asked.status, 200);
  assert.equal(asked.data.pending_email, 'confirmed.new@test.local');
  assert.equal(asked.data.user.email, 'email.confirm@test.local', 'unchanged until confirmed');
  await new Promise(resolve => setTimeout(resolve, 50)); // the notice to the old address is sent in the background
  const link = sent.find(m => m.to === 'confirmed.new@test.local');
  assert.ok(link, 'a confirmation link goes to the new address');
  assert.ok(sent.some(m => m.to === 'email.confirm@test.local'), 'the current address is told');
  const me2 = await api('/api/auth/me', { token: asked.data.token });
  assert.equal(me2.data.pending_email, 'confirmed.new@test.local');

  const token = link.html.match(/confirm-email\?token=([a-f0-9]{64})/)[1];
  assert.equal((await api('/api/auth/confirm-email', { method: 'POST', body: { token: 'f'.repeat(64) } })).status, 400);
  const confirmed = await api('/api/auth/confirm-email', { method: 'POST', body: { token } });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.data.email, 'confirmed.new@test.local');
  assert.equal((await db.prepare('SELECT email, pending_email FROM users WHERE id = ?').get(me.id)).email, 'confirmed.new@test.local');
  assert.equal((await api('/api/auth/confirm-email', { method: 'POST', body: { token } })).status, 400, 'the link works once');
  smtpOn = false;
});

test('two-factor set-up is a POST that keeps the new seed apart (encrypted) until a code confirms it', async () => {
  const me = await person('Totp Setup');
  assert.equal((await api('/api/auth/2fa/setup', { token: me.token })).status, 404, 'no GET');
  const setup = await api('/api/auth/2fa/setup', { method: 'POST', token: me.token });
  assert.equal(setup.status, 200);
  assert.equal(setup.headers.get('cache-control'), 'no-store');
  assert.ok(setup.data.qr_data_url.startsWith('data:image/png'));
  const row = await db.prepare('SELECT totp_secret, totp_pending_secret, totp_enabled FROM users WHERE id = ?').get(me.id);
  assert.equal(row.totp_secret, null, 'the active seed is untouched');
  if (isConfigured()) assert.ok(isEncrypted(row.totp_pending_secret), 'stored encrypted');
  const seed = decrypt(row.totp_pending_secret);

  assert.equal((await api('/api/auth/2fa/enable', { method: 'POST', token: me.token, body: { code: '000000' } })).status, 400);
  const on = await api('/api/auth/2fa/enable', { method: 'POST', token: me.token, body: { code: speakeasy.totp({ secret: seed, encoding: 'base32' }) } });
  assert.equal(on.status, 200);
  const enabled = await db.prepare('SELECT totp_secret, totp_pending_secret, totp_enabled FROM users WHERE id = ?').get(me.id);
  assert.deepEqual([Number(enabled.totp_enabled), enabled.totp_pending_secret, decrypt(enabled.totp_secret)], [1, null, seed]);
  assert.equal(Number(await audit(me.id, 'totp_enabled')), 1);
  assert.equal((await api('/api/auth/2fa/setup', { method: 'POST', token: me.token })).status, 400, 'set-up does not replace an active seed');
});

test('codes are limited per account, and turning two-factor off signs out other sessions', async () => {
  const me = await person('Totp Limits');
  const seed = speakeasy.generateSecret({ length: 20 }).base32;
  const { seal } = require('../totpSeeds');
  await db.prepare('UPDATE users SET totp_secret = ?, totp_enabled = 1 WHERE id = ?').run(seal(seed), me.id);
  const partial = signJwt({ id: me.id, token_version: 0, partial: true }, { expiresIn: '5m' });
  for (let i = 0; i < 5; i += 1) assert.equal((await api('/api/auth/2fa/verify', { method: 'POST', body: { partial_token: partial, code: '000000' } })).status, 401);
  const blocked = await api('/api/auth/2fa/verify', { method: 'POST', body: { partial_token: partial, code: speakeasy.totp({ secret: seed, encoding: 'base32' }) } });
  assert.equal(blocked.status, 429, 'even the right code waits after 5 wrong ones');

  const other = await tokenOf(me.id);
  assert.equal((await api('/api/auth/2fa', { method: 'DELETE', token: me.token, body: { password: 'wrong' } })).status, 400);
  const off = await api('/api/auth/2fa', { method: 'DELETE', token: me.token, body: { password: 'Current#pass1' } });
  assert.equal(off.status, 200);
  assert.ok(off.data.token, 'this session gets a new token');
  assert.equal((await api('/api/auth/me', { token: other })).status, 401, 'other sessions end');
  assert.equal((await api('/api/auth/me', { token: off.data.token })).status, 200);
  assert.equal(Number(await audit(me.id, 'totp_disabled')), 1);
  assert.equal(Number(await audit(me.id, 'totp_disable_failed')), 1);
});

test('wrong passwords inside a session stop after 5 per account', async () => {
  const me = await person('Password Limit');
  for (let i = 0; i < 5; i += 1) assert.equal((await api('/api/auth/2fa', { method: 'DELETE', token: me.token, body: { password: `wrong-${i}` } })).status, 400);
  assert.equal((await api('/api/auth/2fa', { method: 'DELETE', token: me.token, body: { password: 'Current#pass1' } })).status, 429);
  assert.equal((await api('/api/auth/profile', { method: 'PUT', token: me.token, body: { name: 'Password Limit', email: 'other.limit@test.local', current_password: 'Current#pass1' } })).status, 429);
});

test('2FA seeds saved before encryption are encrypted at start-up', { skip: !isConfigured() && 'no field key in this run' }, async () => {
  const me = await person('Totp Legacy');
  await db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run('JBSWY3DPEHPK3PXP', me.id);
  assert.ok(await require('../totpSeeds').encryptStoredSeeds(db) >= 1);
  const stored = (await db.prepare('SELECT totp_secret FROM users WHERE id = ?').get(me.id)).totp_secret;
  assert.ok(isEncrypted(stored));
  assert.equal(decrypt(stored), 'JBSWY3DPEHPK3PXP');
});

test('a rejected avatar upload keeps the current picture; a new picture gets a new address', async () => {
  const fs = require('fs'), path = require('path');
  const fixture = require('./lib/activityFixture');
  const me = await person('Avatar Keeper');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const upload = async (bytes, token) => {
    const form = new FormData();
    form.append('avatar', new Blob([bytes], { type: 'image/png' }), 'me.png');
    const res = await fetch(`${fixture.baseUrl}/api/auth/avatar`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'X-SolutionsHub-Request': '1' }, body: form });
    return { status: res.status, data: await res.json() };
  };
  const fileOf = url => path.join(__dirname, '..', url);
  const first = await upload(png, me.token);
  assert.equal(first.status, 200);
  assert.ok(fs.existsSync(fileOf(first.data.avatar_url)));

  const rejected = await upload(Buffer.from('<html>not an image</html>'), first.data.token);
  assert.equal(rejected.status, 400);
  assert.ok(fs.existsSync(fileOf(first.data.avatar_url)), 'the current picture is still there');
  assert.equal((await db.prepare('SELECT avatar_url FROM users WHERE id = ?').get(me.id)).avatar_url, first.data.avatar_url);

  const second = await upload(png, first.data.token);
  assert.equal(second.status, 200);
  assert.notEqual(second.data.avatar_url, first.data.avatar_url, 'a new address, so no stale cached picture');
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(fs.existsSync(fileOf(first.data.avatar_url)), false, 'the old picture is removed once the new one is saved');
  fs.rmSync(fileOf(second.data.avatar_url), { force: true });
});

test('the activity log export is CSV that a spreadsheet cannot run or split', async () => {
  const fixture = require('./lib/activityFixture');
  const { ids } = fixture;
  const project = (await db.prepare('INSERT INTO projects (title, created_by) VALUES (?, ?)').run('=1+1', ids.manager)).lastInsertRowid;
  await db.prepare('INSERT INTO project_activity (project_id, user_id, action, detail) VALUES (?, ?, ?, ?)')
    .run(project, ids.manager, 'note', ' \t@SUM(1)\n2026-01-01,forged,row,"x"');
  const res = await fetch(`${fixture.baseUrl}/api/settings/logging/download`, { headers: { Authorization: `Bearer ${ids.tokenManager}` } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  const csv = await res.text();
  assert.ok(!csv.startsWith('#'), 'no comment lines');
  assert.ok(csv.includes(`"'=1+1"`), 'a formula is neutralised');
  assert.ok(csv.includes(`"' \t@SUM(1)\n2026-01-01,forged,row,""x"""`), 'line breaks and quotes stay inside one quoted cell');
});

test('customer responses: everyone reads them; managers add, change and remove them', async () => {
  const { ids } = require('./lib/activityFixture');
  const first = await api('/api/customer-responses', { token: ids.tokenEnabled });
  assert.equal(first.status, 200);
  assert.ok(first.data.rows.some(row => row.title === 'Closing Ticket'), 'the built-in texts to start with');
  assert.equal(first.data.can_edit, false);
  assert.equal((await api('/api/customer-responses', { method: 'POST', token: ids.tokenEnabled, body: { title: 'x', body: 'y' } })).status, 403);
  assert.equal((await api('/api/customer-responses', { method: 'POST', token: ids.tokenManager, body: { title: '', body: 'y' } })).status, 400);
  assert.equal((await api('/api/customer-responses', { method: 'POST', token: ids.tokenManager, body: { title: 'x', body: 'y', tone: 'pink' } })).status, 400);
  const added = await api('/api/customer-responses', { method: 'POST', token: ids.tokenManager, body: { title: 'Maintenance window', body: 'Dear customer,\nwe will…', tone: 'info' } });
  assert.equal(added.status, 201);
  const changed = await api(`/api/customer-responses/${added.data.id}`, { method: 'PUT', token: ids.tokenManager, body: { title: 'Maintenance window notice', body: 'Dear customer', tone: 'warning' } });
  assert.equal(changed.data.title, 'Maintenance window notice');
  assert.equal((await api('/api/customer-responses/closing', { method: 'DELETE', token: ids.tokenManager })).status, 200, 'a built-in one can go too');
  const titles = (await api('/api/customer-responses', { token: ids.tokenEnabled })).data.rows.map(row => row.title);
  assert.ok(titles.includes('Maintenance window notice') && !titles.includes('Closing Ticket'));
});

test('customer logo: managers upload a real image; people who can see the customer see it', async () => {
  const fixture = require('./lib/activityFixture');
  const { ids } = fixture;
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
  const put = (bytes, type, token = ids.tokenManager) => {
    const form = new FormData();
    form.append('logo', new Blob([bytes], { type }), 'logo');
    return fetch(`${fixture.baseUrl}/api/customers/${ids.customer}/logo`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'X-SolutionsHub-Request': '1' }, body: form });
  };
  const get = (customer, token) => fetch(`${fixture.baseUrl}/api/customers/${customer}/logo`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await put(png, 'image/png', ids.tokenEnabled)).status, 403, 'managers only');
  assert.equal((await put(Buffer.from('<svg onload="alert(1)"/>'), 'image/svg+xml')).status, 400, 'no SVG');
  assert.equal((await put(Buffer.from('<html>not a png</html>'), 'image/png')).status, 400, 'the bytes must match');
  assert.equal((await put(Buffer.alloc(600 * 1024, 1), 'image/png')).status, 400, 'at most 512 KB');
  const saved = await put(png, 'image/png');
  assert.equal(saved.status, 200);
  const { logo_updated_at: version } = await saved.json();
  assert.ok(version);
  assert.equal((await api(`/api/customers/${ids.customer}`, { token: ids.tokenManager })).data.logo_updated_at, version);

  const seen = await get(ids.customer, ids.tokenEnabled); // the engineer works with this customer
  assert.equal(seen.status, 200);
  assert.equal(seen.headers.get('content-type'), 'image/png');
  assert.ok(Buffer.from(await seen.arrayBuffer()).equals(png));
  assert.equal((await get(ids.customerUnassigned, ids.tokenEnabled)).status, 403, 'not for customers they cannot see');

  assert.equal((await api(`/api/customers/${ids.customer}/logo`, { method: 'DELETE', token: ids.tokenManager })).status, 200);
  assert.equal((await get(ids.customer, ids.tokenManager)).status, 404);
  assert.equal((await api(`/api/customers/${ids.customer}`, { token: ids.tokenManager })).data.logo_updated_at, null);
});
