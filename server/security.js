const dns = require('dns').promises;
const net = require('net');

function isPrivateIpv4(ip) {
  const [a, b, c] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

/** The 16 bytes of an IPv6 address in any spelling (compressed, expanded, with an
 *  embedded IPv4 tail or a zone), or null when it is not one. */
function ipv6Bytes(ip) {
  let v = String(ip).toLowerCase().replace(/%.*$/, '');
  if (!net.isIPv6(v)) return null;
  const tail = v.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const [a, b, c, d] = tail[1].split('.').map(Number);
    v = v.slice(0, -tail[1].length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest] = v.includes('::') ? v.split('::') : [v, null];
  const left = head ? head.split(':') : [], right = rest ? rest.split(':') : [];
  const groups = rest === null ? left : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  if (groups.length !== 8) return null;
  return groups.flatMap(g => { const n = parseInt(g, 16); return [n >> 8, n & 255]; });
}

const v4 = bytes => bytes.join('.');
const startsWith = (bytes, prefix) => prefix.every((value, i) => bytes[i] === value);

function isPrivateIpv6(ip) {
  const b = ipv6Bytes(ip);
  if (!b) return true;
  const zero = n => b.slice(0, n).every(x => x === 0);
  if (zero(10) && b[10] === 0xff && b[11] === 0xff) return isPrivateIpv4(v4(b.slice(12))); // ::ffff:a.b.c.d (mapped)
  if (zero(12)) return true; // ::, ::1 and the deprecated IPv4-compatible ::a.b.c.d
  if (startsWith(b, [0, 0x64, 0xff, 0x9b]) && b.slice(4, 12).every(x => x === 0)) return isPrivateIpv4(v4(b.slice(12))); // NAT64 64:ff9b::/96
  if (startsWith(b, [0, 0x64, 0xff, 0x9b, 0, 1])) return true; // local-use NAT64 64:ff9b:1::/48
  if (startsWith(b, [0x20, 0x02])) return isPrivateIpv4(v4(b.slice(2, 6))); // 6to4 2002::/16 embeds the IPv4 target
  if (startsWith(b, [0x20, 0x01, 0, 0])) return true; // Teredo 2001::/32 tunnels to an IPv4 address
  if (startsWith(b, [0x20, 0x01, 0x0d, 0xb8])) return true; // documentation 2001:db8::/32
  if (startsWith(b, [0x01, 0, 0, 0, 0, 0, 0, 0])) return true; // discard 100::/64
  return (b[0] & 0xfe) === 0xfc // unique local fc00::/7
    || (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) // link-local fe80::/10
    || (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0) // site-local fec0::/10
    || b[0] === 0xff; // multicast
}

function isPrivateIp(ip) {
  if (!ip) return true;
  if (net.isIPv4(ip)) return isPrivateIpv4(ip);
  if (net.isIPv6(String(ip).replace(/%.*$/, ''))) return isPrivateIpv6(ip);
  return true;
}

function isLocalHostname(hostname) {
  const h = String(hostname || '').toLowerCase();
  return h === 'localhost' || h.endsWith('.localhost') || h === 'metadata.google.internal';
}

async function assertPublicHttpUrl(rawUrl, options = {}) {
  const { allowHttp = false, allowPrivate = false, label = 'URL' } = options;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${label} is not a valid URL`);
  }

  if (url.username || url.password) throw new Error(`${label} must not include credentials`);
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    throw new Error(`${label} must use https`);
  }
  if (isLocalHostname(url.hostname)) throw new Error(`${label} must not point to a local/internal host`);

  const literalIp = net.isIP(url.hostname) ? url.hostname : null;
  const addresses = literalIp
    ? [{ address: literalIp }]
    : await dns.lookup(url.hostname, { all: true, verbatim: true });

  if (!addresses.length) throw new Error(`${label} could not be resolved`);
  if (!allowPrivate && addresses.some(a => isPrivateIp(a.address))) {
    throw new Error(`${label} resolves to a private/internal address`);
  }

  // The address(es) that passed the check. Callers that connect should pin to
  // these (see pinnedLookup) so a second DNS answer can't swap in an internal host.
  url.validatedAddresses = addresses.map(a => a.address);
  return url;
}

/* `lookup` option for http(s).request that only ever answers with the addresses
   assertPublicHttpUrl validated, closing the DNS-rebinding window between the
   check and the connection. Without validated addresses it resolves normally. */
function pinnedLookup(url) {
  const pinned = url.validatedAddresses;
  if (!pinned || !pinned.length) return undefined;
  return (hostname, options, callback) => {
    const cb = typeof options === 'function' ? options : callback;
    const wantsAll = typeof options === 'object' && options && options.all;
    const entries = pinned.map(address => ({ address, family: net.isIPv6(address) ? 6 : 4 }));
    if (wantsAll) cb(null, entries);
    else cb(null, entries[0].address, entries[0].family);
  };
}

/* A small fetch() for addresses people type, connecting only to the addresses
   assertPublicHttpUrl validated (pass them as `addresses`), so DNS cannot switch the
   host between the check and the request. Redirects are refused and the body is
   capped. Failures look like fetch()'s ("fetch failed" with the cause). */
function pinnedFetch(input, { method = 'GET', headers = {}, body, signal, addresses, maxBytes = 20 * 1024 * 1024 } = {}) {
  const url = new URL(String(input));
  if (addresses) url.validatedAddresses = addresses;
  const failed = cause => Object.assign(new TypeError('fetch failed'), { cause });
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const mod = url.protocol === 'https:' ? require('https') : require('http');
    const request = mod.request({ hostname: url.hostname.replace(/^\[|\]$/g, ''), port: url.port || undefined, path: url.pathname + url.search, method, headers, lookup: pinnedLookup(url), servername: net.isIP(url.hostname) ? undefined : url.hostname }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400) { response.resume(); return reject(failed(new Error('unexpected redirect'))); }
      const chunks = []; let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) { request.destroy(); reject(failed(new Error('The response is too large'))); return; }
        chunks.push(chunk);
      });
      response.on('error', error => reject(failed(error)));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode,
          headers: { get: name => { const value = response.headers[String(name).toLowerCase()]; return value == null ? null : String(value); } },
          text: async () => text, json: async () => JSON.parse(text),
        });
      });
    });
    const abort = () => { request.destroy(); reject(signal.reason); };
    signal?.addEventListener('abort', abort, { once: true });
    request.on('error', error => reject(failed(error)));
    request.on('close', () => signal?.removeEventListener('abort', abort));
    if (body != null) request.write(body);
    request.end();
  });
}

function isInAppUpdateEnabled() {
  return process.env.NODE_ENV !== 'production' || process.env.ALLOW_IN_APP_UPDATES === 'true';
}

function requireInAppUpdateEnabled(req, res, next) {
  if (!isInAppUpdateEnabled()) {
    return res.status(403).json({
      error: 'In-app updates are disabled in production. Deploy through the approved Docker/branch pipeline.',
    });
  }
  next();
}

module.exports = { assertPublicHttpUrl, pinnedLookup, pinnedFetch, isPrivateIp, isInAppUpdateEnabled, requireInAppUpdateEnabled };
