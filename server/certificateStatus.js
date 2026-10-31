/**
 * The HTTPS certificate production serves, read the way a browser sees it: the app
 * opens a TLS connection to its own proxy (TLS_STATUS_ADDRESS, "proxy:443" in
 * docker-compose.prod.yml) and reads the certificate presented. Read-only: the app
 * never sees the private key, and after a renewal it reports the new certificate as
 * soon as the proxy serves it. Shown in Settings → System health; managers are
 * reminded before it expires (reminders.js).
 */
const tls = require('tls');

const WARN_DAYS = 30;
const REMIND_AT = Object.freeze([30, 14, 7, 1]);
const CACHE_MS = 10 * 60 * 1000;
let cached = null;

const hostOf = url => { try { return new URL(url).hostname; } catch { return null; } };
const isIp = host => /^[\d.]+$/.test(host || '') || (host || '').includes(':');

function describe(cert, appHost, now) {
  const validTo = new Date(cert.valid_to), validFrom = new Date(cert.valid_from);
  const daysLeft = Math.floor((validTo.getTime() - now.getTime()) / 86400000);
  const names = String(cert.subjectaltname || '').split(',').map(part => part.trim().replace(/^DNS:|^IP Address:/, '')).filter(Boolean);
  const covers = appHost ? tls.checkServerIdentity(appHost, cert) === undefined : null;
  const selfSigned = !!cert.issuer && !!cert.subject && JSON.stringify(cert.issuer) === JSON.stringify(cert.subject);
  const status = daysLeft < 0 || covers === false ? 'error' : daysLeft <= WARN_DAYS || selfSigned ? 'warning' : 'ok';
  return {
    state: daysLeft < 0 ? 'expired' : 'https', status,
    name: cert.subject?.CN || names[0] || null, names,
    issuer: cert.issuer?.O || cert.issuer?.CN || null, self_signed: selfSigned,
    valid_from: Number.isNaN(validFrom.getTime()) ? null : validFrom.toISOString(),
    valid_to: Number.isNaN(validTo.getTime()) ? null : validTo.toISOString(),
    days_left: daysLeft, covers_app_host: covers, app_host: appHost,
    fingerprint: cert.fingerprint256 || cert.fingerprint || null,
  };
}

/** { state: https | expired | http | not_checked | unavailable, status: ok | warning | error, … } */
async function certificateStatus({ address = process.env.TLS_STATUS_ADDRESS, appUrl = process.env.APP_URL, connect = tls.connect, now = new Date(), fresh = false } = {}) {
  if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const appHost = hostOf(appUrl);
  let value;
  if (!address) value = { state: 'not_checked', status: 'ok', detail: 'Not behind the HTTPS proxy (development).' };
  else {
    const [host, port = '443'] = String(address).split(':');
    value = await new Promise(resolve => {
      const socket = connect({ host, port: Number(port), servername: appHost && !isIp(appHost) ? appHost : undefined, rejectUnauthorized: false, timeout: 5000 });
      const done = result => { socket.destroy?.(); resolve(result); };
      socket.once('secureConnect', () => {
        const cert = socket.getPeerCertificate();
        done(cert && cert.valid_to ? describe(cert, appHost, now) : { state: 'unavailable', status: 'warning', detail: 'The proxy presented no certificate.' });
      });
      socket.once('timeout', () => done({ state: 'unavailable', status: 'warning', detail: 'The HTTPS proxy did not answer.' }));
      socket.once('error', error => done(error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET' || /wrong version|EPROTO/i.test(`${error.code} ${error.message}`)
        ? { state: 'http', status: 'warning', detail: 'No certificate: production serves plain HTTP on port 80 (passwords are not encrypted).' }
        : { state: 'unavailable', status: 'warning', detail: `Could not read the certificate: ${error.message}` }));
    });
  }
  cached = { at: Date.now(), value };
  return value;
}

const fmt = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '?');
/** One line for System health. */
function detailOf(s) {
  if (s.detail) return s.detail;
  const parts = [`${s.name || 'Certificate'}${s.issuer ? `, issued by ${s.issuer}` : ''}${s.self_signed ? ' (self-signed: browsers warn)' : ''}`,
    s.days_left < 0 ? `expired on ${fmt(s.valid_to)}` : `expires ${fmt(s.valid_to)} (in ${s.days_left} day${s.days_left === 1 ? '' : 's'})`];
  if (s.covers_app_host === false) parts.push(`does not cover ${s.app_host} (the address in APP_URL)`);
  return `${parts.join('; ')}.`;
}

/** The daily reminders (reminders.js): 30, 14, 7 and 1 day before, and once expired. */
async function remind({ store, wants, firstDelivery, notifyUser, notifyShared, status = null }) {
  const s = status || await certificateStatus({ fresh: true });
  if (!['https', 'expired'].includes(s.state) || !s.fingerprint) return 0;
  const occasion = s.days_left < 0 ? 'expired' : (() => { const crossed = REMIND_AT.filter(d => s.days_left <= d); return crossed.length ? `${Math.min(...crossed)}_days` : null; })();
  if (!occasion) return 0;
  const expired = occasion === 'expired';
  const msg = {
    title: expired ? '⚠️ HTTPS certificate expired' : '🔒 HTTPS certificate expiring',
    body: expired ? `The certificate for **${s.name}** expired on ${fmt(s.valid_to)}: browsers now refuse the app. Replace certs/tls.crt and tls.key on the server and restart the proxy.`
      : `The certificate for **${s.name}** expires on ${fmt(s.valid_to)} (in ${s.days_left} day${s.days_left === 1 ? '' : 's'}). Ask IT for the renewed one.`,
    facts: [{ name: 'Certificate', value: s.name || '?' }, ...(s.issuer ? [{ name: 'Issued by', value: s.issuer }] : []), { name: 'Expires', value: fmt(s.valid_to) }],
  };
  notifyShared('certificate_expiring', msg, { dedupeKey: `${s.fingerprint}:${occasion}` });
  let sent = 0;
  for (const user of await store.prepare("SELECT id FROM users WHERE role = 'manager' AND active = 1").all()) {
    if (!await wants(user.id, 'certificate_expiring', store) || !await firstDelivery(store, user.id, 'certificate_expiring', s.fingerprint, occasion)) continue;
    await notifyUser(Number(user.id), 'certificate_expiring', msg, { title: `HTTPS certificate ${expired ? 'expired' : `expires in ${s.days_left} day${s.days_left === 1 ? '' : 's'}`}`, body: s.name, link: '/settings/system_health?part=deployment' });
    sent++;
  }
  return sent;
}

module.exports = { WARN_DAYS, REMIND_AT, certificateStatus, detailOf, remind };
