const dns = require('dns').promises;
const net = require('net');

function isPrivateIp(ip) {
  if (!ip) return true;

  if (net.isIPv4(ip)) {
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

  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    return (
      v === '::1' ||
      v === '::' ||
      v.startsWith('fc') ||
      v.startsWith('fd') ||
      v.startsWith('fe80:') ||
      v.startsWith('::ffff:127.') ||
      v.startsWith('::ffff:10.') ||
      v.startsWith('::ffff:192.168.') ||
      v.startsWith('::ffff:169.254.')
    );
  }

  return true;
}

function isLocalHostname(hostname) {
  const h = String(hostname || '').toLowerCase();
  return h === 'localhost' || h.endsWith('.localhost') || h === 'metadata.google.internal';
}

async function assertPublicHttpUrl(rawUrl, options = {}) {
  const { allowHttp = false, label = 'URL' } = options;
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
  if (addresses.some(a => isPrivateIp(a.address))) {
    throw new Error(`${label} resolves to a private/internal address`);
  }

  return url;
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

module.exports = { assertPublicHttpUrl, isPrivateIp, isInAppUpdateEnabled, requireInAppUpdateEnabled };
