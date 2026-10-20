/**
 * Outbound HTTPS for the chat channels (Webex, Microsoft). Hosts are fixed or
 * checked by the callers; tests replace the transport with _setTransport().
 */
const https = require('https');

function defaultTransport({ method, url, headers = {}, body, maxBytes = 1_000_000 }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (target.protocol !== 'https:') return reject(new Error('Only HTTPS is allowed'));
    const request = https.request(target, { method, headers: { ...headers, ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) }, timeout: 10000 }, response => {
      let text = '', size = 0;
      response.setEncoding('utf8');
      response.on('data', chunk => { size += Buffer.byteLength(chunk); if (text.length < maxBytes) text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, text, size, contentType: response.headers['content-type'] || '', truncated: size > maxBytes }));
    });
    request.on('timeout', () => request.destroy(new Error(`${target.hostname} did not answer in time`)));
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

let transport = defaultTransport;
function _setTransport(fn) { transport = fn || defaultTransport; }

/** `raw: true` also returns how the answer looked ({ data, status, contentType, size, truncated }); `maxBytes` raises the 1 MB read limit. */
async function request(method, url, { headers = {}, json, form, raw = false, maxBytes } = {}) {
  const body = json !== undefined ? JSON.stringify(json) : form ? new URLSearchParams(form).toString() : undefined;
  const contentType = json !== undefined ? { 'Content-Type': 'application/json' } : form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {};
  const response = await transport({ method, url, headers: { Accept: 'application/json', ...contentType, ...headers }, body, ...(maxBytes ? { maxBytes } : {}) });
  let data = null; try { data = response.text ? JSON.parse(response.text) : null; } catch { data = null; }
  if (response.status < 200 || response.status >= 300) {
    const detail = data?.message || data?.error_description || data?.error?.message || data?.error || String(response.text || '').slice(0, 160);
    throw Object.assign(new Error(`${new URL(url).hostname} answered ${response.status}${detail ? `: ${detail}` : ''}`), { status: response.status });
  }
  if (raw) return { data, status: response.status, contentType: response.contentType || '', size: response.size ?? String(response.text || '').length, truncated: !!response.truncated };
  return data;
}

module.exports = { request, _setTransport };
