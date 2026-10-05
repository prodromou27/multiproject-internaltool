/**
 * The bot acts as the engineer through the app's own API, so it gets exactly
 * their permissions and the same validation, audit trail and live updates as
 * the Log activity form — nothing is duplicated or bypassed. Each call carries
 * a two-minute token for that user.
 */
const http = require('http');
const https = require('https');
const { signJwt } = require('../middleware/auth');

let base = null; // e.g. http://127.0.0.1:3001 — set once the server is listening

function setBase(url) { base = url; }

function call(user, method, path, body) {
  if (!base) return Promise.reject(Object.assign(new Error('The app is still starting'), { status: 503 }));
  const token = signJwt({ id: user.id, token_version: user.token_version ?? 0 }, { expiresIn: '2m' });
  const url = new URL(`/api${path}`, base);
  const data = body === undefined ? null : JSON.stringify(body);
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.request(url, {
      method,
      // Loopback only: the server's own certificate may be self-signed.
      ...(url.protocol === 'https:' ? { rejectUnauthorized: false } : {}),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) },
      timeout: 15000,
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => {
        let parsed = null; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
        if (response.statusCode >= 400) return reject(Object.assign(new Error(parsed?.error || `Request failed (${response.statusCode})`), { status: response.statusCode }));
        resolve(parsed);
      });
    });
    request.on('timeout', () => request.destroy(new Error('The app did not answer in time')));
    request.on('error', reject);
    if (data) request.write(data);
    request.end();
  });
}

module.exports = {
  setBase,
  meta: user => call(user, 'GET', '/service-activities/meta'),
  assets: (user, customerId) => call(user, 'GET', `/service-activities/assets?customer_id=${encodeURIComponent(customerId)}`),
  createActivity: (user, body) => call(user, 'POST', '/service-activities', body),
};
