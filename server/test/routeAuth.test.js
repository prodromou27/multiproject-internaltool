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
  'requirePermissionMiddleware', 'requireDownloadPermissionMiddleware',
  // assets.access, or (list/add only) an engineer on the customer's managed-services team
  'requireAssetAccessMiddleware',
]);

// "<file> <METHOD> <path>" — endpoints that are public by design.
const PUBLIC = new Set([
  'auth POST /logout',
  'auth POST /login',
  'auth POST /2fa/verify',          // completes login with a short-lived challenge token
  'auth POST /forgot-password',
  'auth POST /reset-password',      // authorised by a single-use reset token
  'auth GET /saml/status',          // whether to show "Sign in with Microsoft" on the login page
  'auth GET /saml/metadata',        // service-provider metadata for setting up Entra
  'auth GET /saml/login',           // starts a Microsoft sign-in
  'auth POST /saml/acs',            // authorised by Entra's signed SAML assertion
  'ical GET /',                     // authorised by a scoped, hashed feed token in ?token=
  'bots POST /webex/events',        // authorised by the webhook's HMAC signature (Webex)
  'bots POST /teams/messages',      // authorised by a Microsoft-signed token for our app id
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
  // Every router file, including sub-folders (settings/…), and routers that live outside routes/.
  const files = fs.readdirSync(dir, { recursive: true }).filter(f => f.endsWith('.js')).map(f => [f.split(path.sep).join('/').replace(/\.js$/, ''), path.join(dir, f)]);
  files.push(['live', path.join(__dirname, '..', 'liveUpdates.js')]);
  for (const [file, full] of files) {
    const exported = require(full);
    const router = exported?.stack ? exported : exported?.router;
    if (!router?.stack) continue;
    inspected += router.stack.filter(l => l.route).length;
    problems.push(...unprotectedRoutes(file, router).filter(r => !PUBLIC.has(r)));
  }
  assert.ok(inspected > 100, `expected to inspect the whole API, saw ${inspected} routes`);
  assert.deepEqual(problems, [], `Unauthenticated routes:\n${problems.join('\n')}`);
});
