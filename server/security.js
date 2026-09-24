const dns = require('dns').promises;
const net = require('net');

function isPrivateIpv4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIp(ip) {
  if (!ip) return true;

  if (net.isIPv4(ip)) return isPrivateIpv4(ip);

  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80:')) {
      return true;
    }
    // IPv4-mapped (::ffff:a.b.c.d) or IPv4-compatible (::a.b.c.d) addresses embed a
    // literal IPv4 target — delegate to the same IPv4 range check rather than
    // maintaining a second, easily-incomplete prefix allowlist here.
    const mapped = v.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped && net.isIPv4(mapped[1])) return isPrivateIpv4(mapped[1]);
    return false;
  }

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

module.exports = { assertPublicHttpUrl, pinnedLookup, isPrivateIp, isInAppUpdateEnabled, requireInAppUpdateEnabled };
