/**
 * Integration tests for the Service Activity Tracking module's authorization
 * and business rules, run against an in-memory Postgres (pg-mem) rather than
 * pure-function unit tests, since the behavior under test (team gating,
 * customer authorization, IDOR resistance, reference uniqueness) only exists
 * at the route-handler level.
 *
 * This intentionally does NOT boot server/index.js (its TLS/rate-limit/
 * scheduler bootstrap isn't designed to be imported) — instead it mounts the
 * real route modules on a minimal Express app, against the real db.js module
 * with its Postgres Pool swapped for pg-mem's. That's the same technique
 * used to validate the schema DDL during development; see server/db.js's
 * `translate()` for why SQLite-shaped SQL works against a Postgres backend.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'x'.repeat(32);
// TEST_DATABASE_URL must point to a fresh, disposable database (CI supplies one).
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://fake:fake@localhost/fake';

const { newDb, DataType } = require('pg-mem');
const memDb = newDb();
memDb.public.registerFunction({ name: 'substr', args: [DataType.text, DataType.integer, DataType.integer],
  returns: DataType.text, implementation: (text, start, length) => text.substring(start - 1, start - 1 + length) });
const { Pool: RealPool } = memDb.adapters.createPg();

// pg-mem doesn't implement the round()-overload shim db.js defines for real
// Postgres compatibility, nor Postgres's to_char()/AT TIME ZONE at all — both
// are used throughout db.js purely for computing "now" as a formatted text
// timestamp (the app stores all timestamps as TEXT). Neither affects any
// business logic under test here, so both are rewritten before reaching
// pg-mem's parser rather than worked around per call site.
function pgMemCompatible(sql) {
  if (/CREATE OR REPLACE FUNCTION round/i.test(sql)) return null; // no-op
  const now = new Date().toISOString();
  let out = sql
    .replace(/to_char\(\(now\(\)\s*AT TIME ZONE 'UTC'\),\s*'YYYY-MM-DD HH24:MI:SS'\)/gi, `'${now.slice(0, 19).replace('T', ' ')}'`)
    .replace(/to_char\(\(now\(\)\s*AT TIME ZONE 'UTC'\),\s*'YYYY-MM-DD'\)/gi, `'${now.slice(0, 10)}'`);
  // pg-mem has a confirmed bug rejecting NULL against CHECK(col IN (...)) constraints
  // (real Postgres correctly treats NULL as passing a CHECK, per the SQL standard —
  // verified with a minimal repro during schema development). Strip these CHECK
  // clauses only for this in-memory test backend; the real schema keeps them.
  if (/^\s*CREATE TABLE/i.test(out)) {
    out = out.replace(/\s+CHECK\([a-z_]+\s+IN\s*\([^)]*\)\)/gi, '');
  }
  return out;
}

class Pool extends RealPool {
  query(text, ...rest) {
    if (typeof text === 'string') {
      const rewritten = pgMemCompatible(text);
      if (rewritten === null) return Promise.resolve({ rows: [] });
      return super.query(rewritten, ...rest);
    }
    return super.query(text, ...rest);
  }
}

const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === 'pg' && !process.env.TEST_DATABASE_URL) {
    const real = originalRequire.apply(this, arguments);
    return { ...real, Pool };
  }
  return originalRequire.apply(this, arguments);
};

require('express-async-errors');
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signJwt } = require('../middleware/auth');

let server, baseUrl;

async function api(path, { method = 'GET', token, body, cookie, origin, csrf = true } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(origin ? { Origin: origin } : {}),
      ...(csrf ? { 'X-SolutionsHub-Request': '1' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, headers: res.headers };
}

let ids = {};

test.before(async () => {
  await db.init();

  const app = express();
  app.use(express.json());
  app.use('/api', require('../middleware/session').protectCookieRequests);
  app.use('/api/auth', require('../routes/auth'));
  app.use('/api/teams', require('../routes/teams'));
  app.use('/api/customers', require('../routes/customers'));
  app.use('/api/service-activities', require('../routes/serviceActivities'));
  app.use('/api/projects/:projectId/custom-fields', require('../routes/customFields'));
  app.use(require('../middleware/errors').errorHandler);
  await new Promise(resolve => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  // ── Seed: two teams (one enabled, one disabled), a manager, two engineers,
  // one customer assigned only to the enabled team, and a category. ──
  const hash = bcrypt.hashSync('pw', 4);
  const mkUser = async (name, role) =>
    (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
      .run(name, `${name.toLowerCase()}@test.local`, hash, role)).lastInsertRowid;

  ids.manager = await mkUser('Manager One', 'manager');
  ids.engineerEnabled = await mkUser('Engineer Enabled', 'engineer');
  ids.engineerDisabled = await mkUser('Engineer Disabled', 'engineer');

  ids.teamEnabled = (await db.prepare('INSERT INTO teams (name, service_activity_enabled) VALUES (?, 1)').run('Security Team')).lastInsertRowid;
  ids.teamDisabled = (await db.prepare('INSERT INTO teams (name, service_activity_enabled) VALUES (?, 0)').run('Legacy Team')).lastInsertRowid;
  await db.prepare('INSERT INTO team_members (team_id, user_id) VALUES (?, ?)').run(ids.teamEnabled, ids.engineerEnabled);
  await db.prepare('INSERT INTO team_members (team_id, user_id) VALUES (?, ?)').run(ids.teamDisabled, ids.engineerDisabled);

  ids.customer = (await db.prepare('INSERT INTO customers (name, active, service_activity_enabled) VALUES (?, 1, 1)').run('Acme Corp')).lastInsertRowid;
  ids.customerUnassigned = (await db.prepare('INSERT INTO customers (name, active, service_activity_enabled) VALUES (?, 1, 1)').run('Other Corp')).lastInsertRowid;
  await db.prepare('INSERT INTO customer_teams (customer_id, team_id) VALUES (?, ?)').run(ids.customer, ids.teamEnabled);

  const cat = await db.prepare('SELECT id FROM activity_categories LIMIT 1').get();
  ids.category = cat.id;

  ids.tokenManager = signJwt({ id: ids.manager });
  ids.tokenEnabled = signJwt({ id: ids.engineerEnabled });
  ids.tokenDisabled = signJwt({ id: ids.engineerDisabled });
});

test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await db.pool.end();
  Module.prototype.require = originalRequire;
});

test('engineer from a disabled team cannot access the service-activities module', async () => {
  const { status, data } = await api('/api/service-activities', { token: ids.tokenDisabled });
  assert.equal(status, 403);
  assert.match(data.error, /not enabled/i);
});

test('engineer from an enabled team can list activities (empty at first)', async () => {
  const { status, data } = await api('/api/service-activities', { token: ids.tokenEnabled });
  assert.equal(status, 200);
  assert.deepEqual(data.rows, []);
});

test('meta endpoint only returns customers assigned to the engineer\'s enabled team', async () => {
  const { status, data } = await api('/api/service-activities/meta', { token: ids.tokenEnabled });
  assert.equal(status, 200);
  const names = data.customers.map(c => c.name);
  assert.ok(names.includes('Acme Corp'));
  assert.ok(!names.includes('Other Corp'), 'unassigned customer must not be selectable');
});

test('engineer can create an activity for an authorized customer, and server derives engineer_id/team_id itself', async () => {
  const { status, data } = await api('/api/service-activities', {
    method: 'POST',
    token: ids.tokenEnabled,
    body: {
      customer_id: ids.customer,
      activity_date: new Date().toISOString().slice(0, 10),
      category_id: ids.category,
      title: 'VPN troubleshooting',
      status: 'planned',
      // IDOR attempt: try to impersonate the manager and assign to a different team.
      engineer_id: ids.manager,
      team_id: ids.teamDisabled,
    },
  });
  assert.equal(status, 200);
  assert.match(data.activity_reference, /^ACT-\d{4}-\d{6}$/);

  const stored = await db.prepare('SELECT engineer_id, team_id FROM service_activities WHERE id = ?').get(data.id);
  assert.equal(stored.engineer_id, ids.engineerEnabled, 'engineer_id must be the authenticated user, not the spoofed value');
  assert.equal(stored.team_id, ids.teamEnabled, 'team_id must be derived from the engineer\'s real team, not the spoofed value');
});

test('engineer cannot log an activity against a customer not assigned to their team (IDOR)', async () => {
  const { status, data } = await api('/api/service-activities', {
    method: 'POST',
    token: ids.tokenEnabled,
    body: {
      customer_id: ids.customerUnassigned,
      activity_date: new Date().toISOString().slice(0, 10),
      category_id: ids.category,
      title: 'Should be rejected',
      status: 'planned',
    },
  });
  assert.equal(status, 403);
  assert.match(data.error, /not authorized/i);
});

test('engineer cannot edit another engineer\'s activity', async () => {
  const created = await api('/api/service-activities', {
    method: 'POST',
    token: ids.tokenEnabled,
    body: {
      customer_id: ids.customer,
      activity_date: new Date().toISOString().slice(0, 10),
      category_id: ids.category,
      title: 'Owned by engineerEnabled',
      status: 'planned',
    },
  });
  assert.equal(created.status, 200);

  // A second engineer on the same enabled team should still be forbidden from
  // editing an activity they don't own.
  const otherEngineerId = await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
    .run('Engineer Two', 'engineertwo@test.local', bcrypt.hashSync('pw', 4), 'engineer');
  await db.prepare('INSERT INTO team_members (team_id, user_id) VALUES (?, ?)').run(ids.teamEnabled, otherEngineerId.lastInsertRowid);
  const otherToken = signJwt({ id: otherEngineerId.lastInsertRowid });

  const { status, data } = await api(`/api/service-activities/${created.data.id}`, {
    method: 'PUT',
    token: otherToken,
    body: { title: 'Hijacked title' },
  });
  assert.equal(status, 403);
  assert.equal(data.error, 'Forbidden');
});

test('manager can view activities regardless of team membership', async () => {
  const { status, data } = await api('/api/service-activities', { token: ids.tokenManager });
  assert.equal(status, 200);
  assert.ok(data.total >= 2);
});

test('a historical activity can be created directly with a terminal Completed status', async () => {
  const { status, data } = await api('/api/service-activities', {
    method: 'POST',
    token: ids.tokenEnabled,
    body: {
      customer_id: ids.customer,
      activity_date: new Date().toISOString().slice(0, 10),
      category_id: ids.category,
      title: 'Historical completed work',
      status: 'completed',
      duration_minutes: 60,
    },
  });
  assert.equal(status, 200);
  const stored = await db.prepare('SELECT status, completed_at FROM service_activities WHERE id = ?').get(data.id);
  assert.equal(stored.status, 'completed');
  assert.ok(stored.completed_at, 'completed_at should be set for a directly-created completed activity');
});

test('activity references are unique and correctly formatted across multiple creates', async () => {
  const refs = new Set();
  for (let i = 0; i < 3; i++) {
    const { status, data } = await api('/api/service-activities', {
      method: 'POST',
      token: ids.tokenEnabled,
      body: {
        customer_id: ids.customer,
        activity_date: new Date().toISOString().slice(0, 10),
        category_id: ids.category,
        title: `Bulk activity ${i}`,
        status: 'planned',
      },
    });
    assert.equal(status, 200);
    assert.ok(!refs.has(data.activity_reference), 'reference must be unique');
    refs.add(data.activity_reference);
  }
});

test('direct URL access to a disabled team\'s data is rejected server-side regardless of client-side gating', async () => {
  // Simulates an engineer on a disabled team hitting the API URL directly
  // (bypassing the client nav/route guard entirely).
  const { status } = await api('/api/service-activities/meta', { token: ids.tokenDisabled });
  assert.equal(status, 403);
});

async function createActivity(overrides = {}) {
  return api('/api/service-activities', {
    method: 'POST', token: ids.tokenEnabled,
    body: { customer_id: ids.customer, activity_date: '2026-01-15',
      category_id: ids.category, title: 'Validation regression', status: 'planned', ...overrides },
  });
}

test('invalid dates, durations, text and technology IDs return 400 instead of reaching storage', async () => {
  for (const body of [
    { activity_date: '2026-02-30' }, { duration_minutes: 'abc' },
    { duration_minutes: 1.5 }, { duration_minutes: 1441 }, { title: 123 },
    { technology_ids: [999999] }, { technology_ids: [1, 1] },
  ]) {
    const result = await createActivity(body);
    assert.equal(result.status, 400, JSON.stringify(body));
  }
});

test('partial edits preserve required fields and reject attempts to clear them', async () => {
  await db.prepare('UPDATE customers SET require_duration=1, require_ticket_reference=1, require_notes=1 WHERE id=?').run(ids.customer);
  try {
    const created = await createActivity({ duration_minutes: 60, ticket_reference: 'CASE-1', description: 'Work notes' });
    assert.equal(created.status, 200);
    const update = body => api(`/api/service-activities/${created.data.id}`, {
      method: 'PUT', token: ids.tokenEnabled, body,
    });
    assert.equal((await update({ title: 'Updated title' })).status, 200);
    for (const body of [{ duration_minutes: null }, { ticket_reference: '' }, { description: '' }, { category_id: null }, { activity_date: null }]) {
      assert.equal((await update(body)).status, 400, JSON.stringify(body));
    }
    const stored = await db.prepare('SELECT duration_minutes, ticket_reference, description FROM service_activities WHERE id=?').get(created.data.id);
    assert.equal(stored.duration_minutes, 60);
    assert.equal(stored.ticket_reference, 'CASE-1');
    assert.equal(stored.description, 'Work notes');
  } finally {
    await db.prepare('UPDATE customers SET require_duration=0, require_ticket_reference=0, require_notes=0 WHERE id=?').run(ids.customer);
  }
});

test('changing customers revalidates retained related project links', async () => {
  const project = await db.prepare('INSERT INTO projects (title, customer_id, created_by) VALUES (?, ?, ?)').run('Customer-specific project', ids.customer, ids.manager);
  const created = await createActivity({ related_project_id: project.lastInsertRowid });
  assert.equal(created.status, 200);
  const result = await api(`/api/service-activities/${created.data.id}`, {
    method: 'PUT', token: ids.tokenManager, body: { customer_id: ids.customerUnassigned },
  });
  assert.equal(result.status, 400);
  assert.match(result.data.error, /project.*customer/i);
});

test('revoked customer access prevents editing an existing owned activity', async () => {
  const created = await createActivity();
  assert.equal(created.status, 200);
  await db.prepare('DELETE FROM customer_teams WHERE customer_id=? AND team_id=?').run(ids.customer, ids.teamEnabled);
  try {
    const result = await api(`/api/service-activities/${created.data.id}`, {
      method: 'PUT', token: ids.tokenEnabled, body: { title: 'After access revoked' },
    });
    assert.equal(result.status, 403);
    for (const action of ['complete', 'duplicate', 'follow-up-task', 'attachments']) {
      const denied = await api(`/api/service-activities/${created.data.id}/${action}`, { method: 'POST', token: ids.tokenEnabled, body: {} });
      assert.equal(denied.status, 403, action);
    }
  } finally {
    await db.prepare('INSERT INTO customer_teams (customer_id, team_id) VALUES (?, ?)').run(ids.customer, ids.teamEnabled);
  }
});

test('concurrent activity creation allocates unique references without reusing deleted numbers', async () => {
  const created = await Promise.all(Array.from({ length: 10 }, (_, i) => createActivity({ title: `Concurrent work ${i}` })));
  created.forEach(result => assert.equal(result.status, 200, result.data.error));
  const references = created.map(result => result.data.activity_reference);
  assert.equal(new Set(references).size, 10);
  const latest = created.reduce((a, b) => a.data.activity_reference > b.data.activity_reference ? a : b);
  await db.prepare('DELETE FROM service_activities WHERE id=?').run(latest.data.id);
  const next = await createActivity();
  assert.equal(next.status, 200);
  assert.ok(next.data.activity_reference > latest.data.activity_reference);
});

test('reference counters initialize from existing activity references on upgrade', async () => {
  const previous = await createActivity();
  assert.equal(previous.status, 200);
  await db.prepare('DELETE FROM service_activity_sequences WHERE year=?').run(new Date().getFullYear());
  const next = await createActivity();
  assert.equal(next.status, 200);
  assert.equal(Number(next.data.activity_reference.slice(-6)), Number(previous.data.activity_reference.slice(-6)) + 1);
});

test('follow-up creation is idempotent and ad-hoc follow-ups do not prevent later activity edits', async () => {
  const created = await createActivity();
  assert.equal(created.status, 200);
  const path = `/api/service-activities/${created.data.id}/follow-up-task`;
  const first = await api(path, { method: 'POST', token: ids.tokenEnabled, body: {} });
  const again = await api(path, { method: 'POST', token: ids.tokenEnabled, body: {} });
  assert.equal(first.status, 200);
  assert.equal(again.status, 200);
  assert.equal(first.data.created, true);
  assert.equal(again.data.created, false);
  assert.equal(first.data.id, again.data.id);
  const updated = await api(`/api/service-activities/${created.data.id}`, { method: 'PUT', token: ids.tokenEnabled, body: { title: 'Edited after follow-up creation' } });
  assert.equal(updated.status, 200, updated.data.error);
  const activity = await db.prepare('SELECT related_task_id, follow_up_task_id FROM service_activities WHERE id=?').get(created.data.id);
  assert.equal(activity.related_task_id, null);
  assert.equal(activity.follow_up_task_id, first.data.id);
});

test('PostgreSQL locks prevent concurrent duplicate follow-up tasks', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const created = await createActivity();
  const results = await Promise.all(Array.from({ length: 5 }, () => api(`/api/service-activities/${created.data.id}/follow-up-task`, { method: 'POST', token: ids.tokenEnabled, body: {} })));
  results.forEach(result => assert.equal(result.status, 200));
  assert.equal(new Set(results.map(result => result.data.id)).size, 1);
  assert.equal(results.filter(result => result.data.created).length, 1);
});

test('customer changes choose an eligible team for the new customer', async () => {
  await db.prepare('INSERT INTO customer_teams (customer_id, team_id) VALUES (?, ?)').run(ids.customerUnassigned, ids.teamDisabled);
  const created = await createActivity();
  assert.equal(created.status, 200);
  const updated = await api(`/api/service-activities/${created.data.id}`, { method: 'PUT', token: ids.tokenManager, body: { customer_id: ids.customerUnassigned } });
  assert.equal(updated.status, 200);
  const stored = await db.prepare('SELECT customer_id, team_id FROM service_activities WHERE id=?').get(created.data.id);
  assert.equal(stored.customer_id, ids.customerUnassigned);
  assert.equal(stored.team_id, ids.teamDisabled);
});

test('export reaches the workbook route and remains scoped to the owning engineer', async () => {
  const manager = await createActivity({ title: 'Engineer export scope marker' });
  assert.equal(manager.status, 200);
  const response = await fetch(`${baseUrl}/api/service-activities/export`, { headers: { Authorization: `Bearer ${ids.tokenEnabled}` } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /spreadsheetml/);
  const workbook = new (require('exceljs').Workbook)();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  const rows = workbook.getWorksheet('Service Activities').getSheetValues().slice(2);
  assert.ok(rows.length);
  assert.ok(rows.every(row => row[10] === 'Engineer Enabled'));
});

test('task custom fields enforce task ownership and project relationships', async () => {
  const project = (await db.prepare('INSERT INTO projects (title, created_by) VALUES (?, ?)').run('Custom fields project', ids.manager)).lastInsertRowid;
  const otherProject = (await db.prepare('INSERT INTO projects (title, created_by) VALUES (?, ?)').run('Other project', ids.manager)).lastInsertRowid;
  await db.prepare('INSERT INTO project_assignments (project_id, user_id) VALUES (?, ?)').run(project, ids.engineerEnabled);
  const mkTask = async assignedTo => (await db.prepare('INSERT INTO tasks (project_id, title, assigned_to, created_by) VALUES (?, ?, ?, ?)')
    .run(project, 'Scoped task', assignedTo, ids.manager)).lastInsertRowid;
  const ownTask = await mkTask(ids.engineerEnabled);
  const otherTask = await mkTask(ids.manager);
  const field = (await db.prepare('INSERT INTO project_custom_fields (project_id, name, field_type) VALUES (?, ?, ?)')
    .run(project, 'Number field', 'number')).lastInsertRowid;
  const otherField = (await db.prepare('INSERT INTO project_custom_fields (project_id, name, field_type) VALUES (?, ?, ?)')
    .run(otherProject, 'Private field', 'text')).lastInsertRowid;
  const endpoint = task => `/api/projects/${project}/custom-fields/values/${task}`;
  assert.equal((await api(endpoint(otherTask), { token: ids.tokenEnabled })).status, 403);
  assert.equal((await api(endpoint(otherTask), { method: 'PUT', token: ids.tokenEnabled, body: { values: { [field]: '42' } } })).status, 403);
  assert.equal((await api(endpoint(ownTask), { method: 'PUT', token: ids.tokenEnabled, body: { values: { [field]: '42' } } })).status, 200);
  assert.equal((await api(endpoint(ownTask), { token: ids.tokenEnabled })).data[field], '42');
  const invalid = [{ [otherField]: 'Cross-project write' }, { [field]: 'NaN' }, null, [], { [field]: {} }];
  for (const values of invalid) {
    const result = await api(endpoint(ownTask), { method: 'PUT', token: ids.tokenEnabled, body: { values } });
    assert.equal(result.status, 400, JSON.stringify(values));
  }
  const stored = await db.prepare('SELECT field_id, value FROM task_custom_values WHERE task_id=?').all(ownTask);
  assert.deepEqual(stored, [{ field_id: field, value: '42' }]);
  for (const role of ['planner', 'pm']) {
    const user = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
      .run(`Custom ${role}`, `${role}@custom.test`, bcrypt.hashSync('pw', 4), role)).lastInsertRowid;
    await db.prepare('INSERT INTO project_assignments (project_id, user_id) VALUES (?, ?)').run(project, user);
    assert.equal((await api(endpoint(ownTask), { token: signJwt({ id: user }) })).status, 403);
  }
});

test('custom field definitions and typed values reject invalid input', async () => {
  const project = (await db.prepare('INSERT INTO projects (title, created_by) VALUES (?, ?)').run('Typed fields project', ids.manager)).lastInsertRowid;
  const task = (await db.prepare('INSERT INTO tasks (project_id, title, created_by) VALUES (?, ?, ?)').run(project, 'Typed task', ids.manager)).lastInsertRowid;
  const base = `/api/projects/${project}/custom-fields`;
  for (const body of [{ name: 123 }, { name: 'Bad type', field_type: 'script' }, { name: 'Bad options', options: {} }]) {
    assert.equal((await api(base, { method: 'POST', token: ids.tokenManager, body })).status, 400);
  }
  const select = await api(base, { method: 'POST', token: ids.tokenManager, body: { name: 'Environment', field_type: 'select', options: ['Production', 'Test'], required: true } });
  assert.equal(select.status, 200);
  const date = await api(base, { method: 'POST', token: ids.tokenManager, body: { name: 'Renewal', field_type: 'date' } });
  assert.equal(date.status, 200);
  assert.equal((await api(`${base}/${date.data.id}`, { method: 'PUT', token: ids.tokenManager, body: { field_type: 'script' } })).status, 400);
  for (const values of [{ [select.data.id]: 'Unknown' }, { [select.data.id]: '' }, { [date.data.id]: '2026-02-30' }]) {
    assert.equal((await api(`${base}/values/${task}`, { method: 'PUT', token: ids.tokenManager, body: { values } })).status, 400);
  }
  assert.equal((await api(`${base}/values/${task}`, { method: 'PUT', token: ids.tokenManager, body: { values: { [select.data.id]: 'Production', [date.data.id]: '2026-02-28' } } })).status, 200);
});

test('browser cookies enforce CSRF, required password changes, renewal and logout revocation', async () => {
  const email = 'cookie-user@test.local';
  const initialPassword = 'initial-password-123';
  const userId = (await db.prepare('INSERT INTO users (name, email, password, role, must_change_password) VALUES (?, ?, ?, ?, 1)')
    .run('Cookie user', email, bcrypt.hashSync(initialPassword, 4), 'manager')).lastInsertRowid;
  const loggedIn = await api('/api/auth/login', { method: 'POST', body: { email, password: initialPassword } });
  assert.equal(loggedIn.status, 200);
  const setCookie = loggedIn.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Path=\/api/);
  assert.equal(loggedIn.headers.get('cache-control'), 'no-store');
  const cookie = setCookie.split(';')[0];
  const me = await api('/api/auth/me', { cookie });
  assert.equal(me.status, 200);
  assert.equal(me.data.id, userId);
  assert.equal(me.data.must_change_password, 1);
  const restricted = await api('/api/service-activities', { cookie });
  assert.equal(restricted.status, 403);
  assert.equal(restricted.data.code, 'PASSWORD_CHANGE_REQUIRED');
  const exportDenied = await fetch(`${baseUrl}/api/service-activities/export`, { headers: { Cookie: cookie } });
  assert.equal(exportDenied.status, 403);
  const body = { new_password: 'replacement-password-123' };
  assert.equal((await api('/api/auth/change-password-first', { method: 'POST', cookie, csrf: false, body })).status, 403);
  assert.equal((await api('/api/auth/change-password-first', { method: 'POST', cookie, origin: 'https://attacker.example', body })).status, 403);
  const changed = await api('/api/auth/change-password-first', { method: 'POST', cookie, body });
  assert.equal(changed.status, 200);
  const renewedCookie = changed.headers.get('set-cookie').split(';')[0];
  assert.equal((await api('/api/auth/me', { cookie })).status, 401);
  assert.equal((await api('/api/service-activities', { cookie: renewedCookie })).status, 200);
  const profile = await api('/api/auth/profile', { method: 'PUT', cookie: renewedCookie, body: { name: 'Cookie User', email: 'COOKIE-USER@TEST.LOCAL' } });
  assert.equal(profile.status, 200);
  assert.equal(profile.data.user.email, email);
  const profileCookie = profile.headers.get('set-cookie').split(';')[0];
  assert.equal((await api('/api/auth/me', { cookie: renewedCookie })).status, 401);
  const loggedOut = await api('/api/auth/logout', { method: 'POST', cookie: profileCookie });
  assert.equal(loggedOut.status, 200);
  assert.match(loggedOut.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
  assert.equal((await api('/api/auth/me', { cookie: profileCookie })).status, 401);
  assert.equal((await api('/api/auth/me', { token: profile.data.token })).status, 401);
});

test('2FA partial tokens do not grant cookie-based access', async () => {
  const partial = signJwt({ id: ids.manager, partial: true }, { expiresIn: '5m' });
  const result = await api('/api/auth/me', { cookie: `solutionshub_session=${partial}` });
  assert.equal(result.status, 401);
  assert.match(result.data.error, /scope/);
});

test('password endpoints reject malformed and bcrypt-truncated passwords', async () => {
  for (const new_password of [null, {}, [], 'short', 'x'.repeat(73), 'é'.repeat(37)]) {
    for (const path of ['/change-password', '/change-password-first', '/reset-password']) {
      const result = await api(`/api/auth${path}`, { method: 'POST', token: ids.tokenManager,
        body: { new_password, current_password: 'pw', token: 'reset-token' } });
      assert.equal(result.status, 400, `${path}: ${JSON.stringify(new_password)}`);
    }
  }
  assert.equal((await api('/api/auth/forgot-password', { method: 'POST', body: { email: {} } })).status, 400);
  assert.equal((await api('/api/auth/reset-password', { method: 'POST', body: { token: {}, new_password: 'valid-password-123' } })).status, 400);
});

test('reset tokens are single-use and revoke previous sessions', async () => {
  const crypto = require('crypto');
  const user = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
    .run('Reset user', 'reset@test.local', bcrypt.hashSync('old-password-123', 4), 'engineer')).lastInsertRowid;
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  await db.prepare('INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)')
    .run(user, hash, new Date(Date.now() + 3600000).toISOString());
  const session = signJwt({ id: user, token_version: 0 });
  const body = { token, new_password: 'new-reset-password-123' };
  const first = await api('/api/auth/reset-password', { method: 'POST', body });
  assert.equal(first.status, 200);
  assert.equal((await api('/api/auth/reset-password', { method: 'POST', body })).status, 400);
  assert.equal((await api('/api/auth/me', { token: session })).status, 401);
  const stored = await db.prepare('SELECT password, token_version FROM users WHERE id = ?').get(user);
  assert.equal(await bcrypt.compare(body.new_password, stored.password), true);
  assert.equal(stored.token_version, 1);
});

test('concurrent reset requests consume a token only once on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const crypto = require('crypto');
  const user = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
    .run('Concurrent reset user', 'concurrent-reset@test.local', bcrypt.hashSync('old-password-123', 4), 'engineer')).lastInsertRowid;
  const token = crypto.randomBytes(32).toString('hex');
  await db.prepare('INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)')
    .run(user, crypto.createHash('sha256').update(token).digest('hex'), new Date(Date.now() + 3600000).toISOString());
  const results = await Promise.all([0, 1].map(i => api('/api/auth/reset-password', {
    method: 'POST', body: { token, new_password: `concurrent-password-${i}` },
  })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
  const winner = results.findIndex(r => r.status === 200);
  const stored = await db.prepare('SELECT password, token_version FROM users WHERE id = ?').get(user);
  assert.equal(await bcrypt.compare(`concurrent-password-${winner}`, stored.password), true);
  assert.equal(stored.token_version, 1);
});
