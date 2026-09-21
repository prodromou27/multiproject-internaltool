/**
 * Static authorization audit: every route on every router must sit behind an
 * authentication middleware, except a short, reviewed allow-list of public
 * endpoints. Adding a new unauthenticated route makes this test fail until the
 * route is either protected or deliberately added to PUBLIC below.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET = 'x'.repeat(32);
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://fake:fake@localhost/fake';

const AUTH_NAMES = new Set([
  'requireAuth', 'requireDownloadAuth', 'requireManager', 'requireManagerOrPlanner',
  'requireDownloadManager', 'requireDownloadManagerOrPlanner',
]);

// "<file> <METHOD> <path>" — endpoints that are public by design.
const PUBLIC = new Set([
  'auth POST /logout',
  'auth POST /login',
  'auth POST /2fa/verify',          // completes login with a short-lived challenge token
  'auth POST /forgot-password',
  'auth POST /reset-password',      // authorised by a single-use reset token
  'ical GET /',                     // authorised by a scoped, hashed feed token in ?token=
]);

function unprotectedRoutes(file, router) {
  const found = [];
  let blanket = false;
  for (const layer of router.stack) {
    if (!layer.route) {
      if (AUTH_NAMES.has(layer.handle?.name)) blanket = true;
      continue;
    }
    const guarded = blanket || layer.route.stack.some(l => AUTH_NAMES.has(l.handle?.name) || AUTH_NAMES.has(l.name));
    if (guarded) continue;
    for (const method of Object.keys(layer.route.methods)) {
      found.push(`${file} ${method.toUpperCase()} ${layer.route.path}`);
    }
  }
  return found;
}

test('every route requires authentication unless explicitly public', () => {
  const dir = path.join(__dirname, '..', 'routes');
  const problems = [];
  let inspected = 0;
  for (const name of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const router = require(path.join(dir, name));
    if (!router?.stack) continue;
    inspected += router.stack.filter(l => l.route).length;
    const file = name.replace(/\.js$/, '');
    problems.push(...unprotectedRoutes(file, router).filter(r => !PUBLIC.has(r)));
  }
  assert.ok(inspected > 100, `expected to inspect the whole API, saw ${inspected} routes`);
  assert.deepEqual(problems, [], `Unauthenticated routes:\n${problems.join('\n')}`);
});
