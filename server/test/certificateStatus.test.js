// The HTTPS certificate production serves, read from the proxy (certificateStatus.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { certificateStatus, detailOf, remind } = require('../certificateStatus');

const now = new Date('2026-10-19T09:00:00Z');
const cert = (validTo, extra = {}) => ({ subject: { CN: 'teamhub.company.local' }, issuer: { O: 'Company CA', CN: 'Company Issuing CA' },
  subjectaltname: 'DNS:teamhub.company.local', valid_from: 'Oct 19 00:00:00 2025 GMT', valid_to: validTo, fingerprint256: `AA:${validTo}`, ...extra });
// A stand-in for tls.connect: answers with a certificate, or fails with an error code.
const connectWith = ({ peer, error }) => options => {
  const socket = new EventEmitter();
  socket.options = options; socket.destroy = () => {}; socket.getPeerCertificate = () => peer;
  setImmediate(() => (error ? socket.emit('error', Object.assign(new Error(error), { code: error })) : socket.emit('secureConnect')));
  return socket;
};
const check = (connect, appUrl = 'https://teamhub.company.local') => certificateStatus({ address: 'proxy:443', appUrl, connect, now, fresh: true });

test('a valid certificate: its name, issuer and expiry, read for the address in APP_URL', async () => {
  let asked;
  const s = await check(options => { asked = options; return connectWith({ peer: cert('Nov 20 12:00:00 2027 GMT') })(options); });
  assert.deepEqual([asked.host, asked.port, asked.servername, asked.rejectUnauthorized], ['proxy', 443, 'teamhub.company.local', false]);
  assert.equal(s.state, 'https'); assert.equal(s.status, 'ok');
  assert.deepEqual([s.name, s.issuer, s.covers_app_host, s.self_signed], ['teamhub.company.local', 'Company CA', true, false]);
  assert.equal(s.days_left, 397);
  assert.equal(detailOf(s), 'teamhub.company.local, issued by Company CA; expires 20/11/2027 (in 397 days).');
});

test('expiring soon warns; expired, or not covering the app address, is an error; self-signed warns', async () => {
  assert.equal((await check(connectWith({ peer: cert('Nov 10 12:00:00 2026 GMT') }))).status, 'warning');
  const expired = await check(connectWith({ peer: cert('Oct 01 12:00:00 2026 GMT') }));
  assert.deepEqual([expired.state, expired.status], ['expired', 'error']);
  assert.match(detailOf(expired), /expired on 01\/10\/2026/);
  const wrong = await check(connectWith({ peer: cert('Nov 20 12:00:00 2027 GMT') }), 'https://other.company.local');
  assert.deepEqual([wrong.covers_app_host, wrong.status], [false, 'error']);
  assert.match(detailOf(wrong), /does not cover other\.company\.local/);
  const self = await check(connectWith({ peer: cert('Nov 20 12:00:00 2027 GMT', { issuer: { CN: 'teamhub.company.local' } }) }));
  assert.deepEqual([self.self_signed, self.status], [true, 'warning']);
});

test('no certificate (plain HTTP on port 80) and no proxy (development) are told apart', async () => {
  const http = await check(connectWith({ error: 'ECONNREFUSED' }), 'http://teamhub.company.local');
  assert.deepEqual([http.state, http.status], ['http', 'warning']);
  assert.match(detailOf(http), /plain HTTP on port 80/);
  const dev = await certificateStatus({ address: '', fresh: true });
  assert.equal(dev.state, 'not_checked');
});

test('managers are reminded once per step before it expires, and once when it has', async () => {
  const sent = [], shared = [], delivered = new Set();
  const helpers = {
    store: { prepare: () => ({ all: async () => [{ id: 1 }, { id: 2 }] }) },
    wants: async id => id === 1, // manager 2 switched this reminder off
    firstDelivery: async (store, id, kind, ref, occasion) => { const key = `${id}:${ref}:${occasion}`; if (delivered.has(key)) return false; delivered.add(key); return true; },
    notifyUser: async (id, kind, msg, bell) => sent.push([id, kind, bell.title]),
    notifyShared: kind => shared.push(kind),
  };
  const status = async validTo => check(connectWith({ peer: cert(validTo) }));
  assert.equal(await remind({ ...helpers, status: await status('Nov 20 12:00:00 2027 GMT') }), 0, 'far off: nothing');
  assert.equal(await remind({ ...helpers, status: await status('Oct 31 12:00:00 2026 GMT') }), 1, '12 days left: the 14-day reminder');
  assert.equal(await remind({ ...helpers, status: await status('Oct 31 12:00:00 2026 GMT') }), 0, 'not twice');
  assert.deepEqual(sent, [[1, 'certificate_expiring', 'HTTPS certificate expires in 12 days']]);
  assert.equal(await remind({ ...helpers, status: await status('Oct 01 12:00:00 2026 GMT') }), 1, 'expired');
  assert.equal(await remind({ ...helpers, status: await status('Oct 31 12:00:00 2026 GMT').then(s => ({ ...s, state: 'http', fingerprint: null })) }), 0, 'plain HTTP: no certificate to remind about');
  assert.deepEqual(shared, ['certificate_expiring', 'certificate_expiring', 'certificate_expiring']);
});
