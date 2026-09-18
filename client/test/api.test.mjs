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

test('core page reads propagate cancellation without logging out the user', async t => {
  const controller = new AbortController();
  const paths = [];
  setup(t, (path, options) => {
    paths.push(path);
    assert.equal(options.signal, controller.signal);
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }));
  });
  const options = { signal: controller.signal };
  const requests = [api.tasks({ project_id: 12 }, options), api.projects(options), api.project(12, options), api.users(options), api.customers(options), api.projectActivity(12, options), api.milestones(12, options), api.maintenanceVisits({ month: '2026-09' }, options)];
  const results = Promise.allSettled(requests);
  controller.abort();
  assert.ok((await results).every(result => result.status === 'rejected' && result.reason.name === 'AbortError'));
  assert.deepEqual(paths, ['/api/tasks?project_id=12', '/api/projects', '/api/projects/12', '/api/auth/users', '/api/customers', '/api/projects/12/activity', '/api/milestones?project_id=12', '/api/maintenance-visits?month=2026-09']);
  assert.equal(window.location.href, '/current-page');
});

test('customer profile reads support cancellation across overview and recommendation sections', async t => {
  const controller = new AbortController();
  const options = { signal: controller.signal };
  const paths = [];
  setup(t, (path, request) => {
    paths.push(path);
    assert.equal(request.signal, controller.signal);
    return new Promise((resolve, reject) => request.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }));
  });
  const pending = Promise.allSettled([
    api.customer(12,options), api.customerOverview(12,{ page: 2 },options),
    api.customerRecommendations(12,{ status: 'open' },options),
    api.customerServiceActivities(12,{},options), api.customerServiceSummary(12,{},options),
    api.customerContractHours(12,options), api.activityCategories(options),
  ]);
  controller.abort();
  assert.ok((await pending).every(result => result.status === 'rejected' && result.reason.name === 'AbortError'));
  assert.equal(paths.length, 7);
  assert.equal(window.location.href, '/current-page');
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
