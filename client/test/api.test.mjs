import test from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../src/api.js';

function setup(t, responder) {
  const stored = new Map([['token', 'legacy-token'], ['user', '{}']]);
  const previousWindow = globalThis.window;
  const previousStorage = globalThis.localStorage;
  globalThis.window = { location: { href: '/current-page' } };
  globalThis.localStorage = { getItem: k => stored.get(k), removeItem: k => stored.delete(k) };
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = previousStorage;
  });
  t.mock.method(globalThis, 'fetch', responder);
  return stored;
}

test('requests use cookies and protection headers without exposing legacy stored tokens', async t => {
  setup(t, async (path, options) => {
    assert.equal(path, '/api/auth/login');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.headers['X-SolutionsHub-Request'], '1');
    assert.equal(options.headers.Authorization, undefined);
    return Response.json({ user: { id: 1 } });
  });
  assert.equal((await api.login('user@test.local', 'password')).user.id, 1);
});

test('incorrect login and 2FA codes reject visibly without redirecting the login page', async t => {
  const stored = setup(t, async () => Response.json({ error: 'Invalid credentials' }, { status: 401 }));
  await assert.rejects(api.login('wrong', 'wrong'), /Invalid credentials/);
  await assert.rejects(api.verify2fa('partial', '000000'), /Invalid credentials/);
  assert.equal(window.location.href, '/current-page');
  assert.equal(stored.get('token'), 'legacy-token');
});

test('expired sessions reject protected requests and clear stale browser credentials', async t => {
  const stored = setup(t, async () => Response.json({ error: 'Session expired' }, { status: 401 }));
  await assert.rejects(api.projects(), /Session expired/);
  assert.equal(window.location.href, '/login');
  assert.equal(stored.has('token'), false);
  assert.equal(stored.has('user'), false);
});

test('anonymous session bootstrap and server failures do not redirect', async t => {
  setup(t, async () => Response.json({ error: 'No session' }, { status: 401 }));
  await assert.rejects(api.me({ redirectOnUnauthorized: false }), error => error.status === 401);
  assert.equal(window.location.href, '/current-page');
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Server temporarily unavailable' }, { status: 500 }));
  await assert.rejects(api.projects(), error => error.status === 500);
  assert.equal(window.location.href, '/current-page');
});

test('required password changes redirect to the forced-change flow', async t => {
  setup(t, async () => Response.json({ error: 'Change your password', code: 'PASSWORD_CHANGE_REQUIRED' }, { status: 403 }));
  await assert.rejects(api.projects(), /Change your password/);
  assert.equal(window.location.href, '/login');
});
