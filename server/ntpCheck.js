/**
 * Server clock check against an NTP server (Settings → Localization).
 *
 * The app cannot and should not set the machine's clock — the host or container
 * platform does that (chrony/systemd-timesyncd, or the host for Docker). What
 * it does is measure how far its clock is from the configured NTP server and
 * warn when the drift is large enough to break sign-in tokens, two-factor codes
 * and reminders.
 */
const dgram = require('dgram');
const dns = require('dns').promises;
const db = require('./db');

const DEFAULT_NTP_SERVER = 'pool.ntp.org';
const WARN_OFFSET_MS = 5000; // 2FA codes tolerate ±30 s; warn well before that
const NTP_EPOCH_OFFSET = 2208988800; // seconds from 1900 to 1970
let last = null; // { server, ok, offset_ms, delay_ms, checked_at, error }

const validServer = value => typeof value === 'string' && value.length <= 253
  && (/^(?=.{1,253}$)([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/.test(value) || /^\d{1,3}(\.\d{1,3}){3}$/.test(value));

const readTimestamp = (buffer, offset) => (buffer.readUInt32BE(offset) - NTP_EPOCH_OFFSET) * 1000 + (buffer.readUInt32BE(offset + 4) / 2 ** 32) * 1000;

/** One SNTP exchange (RFC 4330). Resolves { offset_ms, delay_ms }. */
async function queryNtp(server, { timeoutMs = 4000, port = 123 } = {}) {
  if (!validServer(server)) throw new Error('Enter a valid NTP server host name or IPv4 address');
  const { address, family } = await dns.lookup(server);
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket(family === 6 ? 'udp6' : 'udp4');
    const packet = Buffer.alloc(48);
    packet[0] = 0x23; // leap indicator 0, version 4, client mode
    const timer = setTimeout(() => { socket.close(); reject(new Error(`No answer from ${server} within ${timeoutMs / 1000} s (is UDP port 123 allowed out?)`)); }, timeoutMs);
    socket.on('error', error => { clearTimeout(timer); socket.close(); reject(error); });
    socket.on('message', message => {
      const t4 = Date.now();
      clearTimeout(timer); socket.close();
      if (message.length < 48 || (message[0] & 0x07) !== 4) return reject(new Error('Not a valid NTP server reply'));
      const t2 = readTimestamp(message, 32), t3 = readTimestamp(message, 40);
      resolve({ offset_ms: Math.round(((t2 - t1) + (t3 - t4)) / 2), delay_ms: Math.max(0, Math.round((t4 - t1) - (t3 - t2))) });
    });
    const t1 = Date.now();
    socket.send(packet, port, address);
  });
}

async function configuredServer(store = db) {
  try {
    const row = await store.prepare("SELECT value FROM settings WHERE key='localization_config'").get();
    const value = row ? JSON.parse(row.value) : {};
    return { server: value.ntp_server || DEFAULT_NTP_SERVER, enabled: value.ntp_check_enabled !== false };
  } catch { return { server: DEFAULT_NTP_SERVER, enabled: true }; }
}

/** Check the clock now and remember the result. */
async function checkClock({ server } = {}) {
  const configured = await configuredServer();
  const target = server || configured.server;
  try {
    const result = await queryNtp(target);
    last = { server: target, ok: Math.abs(result.offset_ms) <= WARN_OFFSET_MS, ...result, checked_at: new Date().toISOString(), error: null };
    if (!last.ok) console.error(`[clock] server clock is ${result.offset_ms} ms off ${target}`);
  } catch (error) {
    last = { server: target, ok: null, offset_ms: null, delay_ms: null, checked_at: new Date().toISOString(), error: error.message };
  }
  return last;
}

const lastCheck = () => last;

function startClockChecks() {
  const run = async () => { if ((await configuredServer()).enabled) await checkClock().catch(() => {}); };
  run();
  setInterval(run, 6 * 60 * 60 * 1000).unref?.();
}

module.exports = { DEFAULT_NTP_SERVER, WARN_OFFSET_MS, validServer, queryNtp, checkClock, lastCheck, startClockChecks, _readTimestamp: readTimestamp };
