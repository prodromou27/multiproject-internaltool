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

async function api(path, { method = 'GET', token, body, cookie, origin, csrf = true, useCurrentVersion = true } = {}) {
  // Business-rule tests use fresh snapshots; conflict tests supply explicit versions.
  if (useCurrentVersion && method === 'PUT' && /^\/api\/service-activities\/\d+$/.test(path) && body && body.version === undefined) {
    const current = await db.prepare('SELECT version FROM service_activities WHERE id = ?').get(Number(path.split('/').pop()));
    if (current) body = { ...body, version: current.version };
  }
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
  app.use('/api/admin', require('../routes/admin'));
  app.use('/api/notes', require('../routes/notes'));
  app.use('/api/search', require('../routes/search'));
  app.use('/api/reports', require('../routes/reports'));
  app.use('/api/tasks', require('../routes/tasks'));
  app.use('/api/projects', require('../routes/projects'));
  app.use('/api/maintenance-visits', require('../routes/maintenance-visits'));
  app.use('/api/time-logs', require('../routes/time-logs'));
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

test('task edits can clear assignments and validate fields and relationships', async () => {
  const created = await api('/api/tasks', { method: 'POST', token: ids.tokenManager,
    body: { title: '  Assignment test  ', assigned_to: ids.engineerEnabled, deadline: '2026-10-15' } });
  assert.equal(created.status, 200);
  const endpoint = `/api/tasks/${created.data.id}`;
  assert.equal((await db.prepare('SELECT title FROM tasks WHERE id=?').get(created.data.id)).title, 'Assignment test');
  for (const body of [{ title: {} }, { title: '' }, { title: 'x'.repeat(501) }, { description: [] },
    { deadline: '2026-02-30' }, { priority: '' }, { assigned_to: ids.manager }, { assigned_to: 99999999 }]) {
    assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenManager, body })).status, 400, JSON.stringify(body));
  }
  assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenManager, body: { assigned_to: null, deadline: null } })).status, 200);
  const task = await db.prepare('SELECT assigned_to, deadline FROM tasks WHERE id=?').get(created.data.id);
  assert.equal(task.assigned_to, null);
  assert.equal(task.deadline, null);
  assert.equal((await api('/api/tasks', { method: 'POST', token: ids.tokenManager,
    body: { title: 'Missing project', project_id: 99999999 } })).status, 400);
});

test('bulk task edits respect role boundaries and clear waiting notes', async () => {
  const project = (await db.prepare('INSERT INTO projects (title, created_by) VALUES (?, ?)').run('Bulk project', ids.manager)).lastInsertRowid;
  const task = (await db.prepare('INSERT INTO tasks (title, project_id, assigned_to, created_by, status, pending_from_customer) VALUES (?, ?, ?, ?, ?, ?)')
    .run('Bulk task', project, ids.engineerEnabled, ids.manager, 'waiting_customer', 'Old waiting note')).lastInsertRowid;
  for (const role of ['planner', 'pm']) {
    const user = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
      .run(`Bulk ${role}`, `bulk-${role}@test.local`, bcrypt.hashSync('pw', 4), role)).lastInsertRowid;
    await db.prepare('INSERT INTO project_assignments (project_id, user_id) VALUES (?, ?)').run(project, user);
    assert.equal((await api('/api/tasks/bulk', { method: 'POST', token: signJwt({ id: user }),
      body: { ids: [task], action: 'status', status: 'completed' } })).status, 403);
  }
  const body = { ids: [task], action: 'status', status: 'in_progress' };
  assert.equal((await api('/api/tasks/bulk', { method: 'POST', token: ids.tokenDisabled, body })).data.affected, 0);
  assert.equal((await api('/api/tasks/bulk', { method: 'POST', token: ids.tokenEnabled, body })).data.affected, 1);
  const stored = await db.prepare('SELECT status, pending_from_customer FROM tasks WHERE id=?').get(task);
  assert.equal(stored.status, 'in_progress');
  assert.equal(stored.pending_from_customer, null);
});

test('time logs enforce task visibility, ownership and private summaries', async () => {
  const task = (await db.prepare('INSERT INTO tasks (title, assigned_to, created_by) VALUES (?, ?, ?)')
    .run('Time log task', ids.engineerEnabled, ids.manager)).lastInsertRowid;
  const body = { task_id: task, hours: 1.5, description: 'Work performed' };
  assert.equal((await api('/api/time-logs', { method: 'POST', token: ids.tokenDisabled, body })).status, 403);
  const created = await api('/api/time-logs', { method: 'POST', token: ids.tokenEnabled, body });
  assert.equal(created.status, 200);
  assert.equal((await api(`/api/time-logs?task_id=${task}`, { token: ids.tokenDisabled })).status, 403);
  assert.equal((await api(`/api/time-logs/${created.data.id}`, { method: 'DELETE', token: ids.tokenDisabled })).status, 403);
  for (const role of ['planner', 'pm']) {
    const user = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
      .run(`Time ${role}`, `time-${role}@test.local`, bcrypt.hashSync('pw', 4), role)).lastInsertRowid;
    const token = signJwt({ id: user });
    assert.equal((await api(`/api/time-logs?task_id=${task}`, { token })).status, 403);
    assert.equal((await api('/api/time-logs', { method: 'POST', token, body })).status, 403);
    const summary = await api(`/api/time-logs/summary?user_id=${ids.engineerEnabled}`, { token });
    assert.equal(summary.status, 200);
    assert.equal(Number(summary.data.total), 0);
  }
  assert.equal(Number((await api(`/api/time-logs/summary?user_id=${ids.engineerEnabled}`, { token: ids.tokenManager })).data.total), 1.5);
});

test('time log input validation rejects malformed targets, hours and dates', async () => {
  for (const body of [{ task_id: -1, hours: 1 }, { task_id: {}, hours: 1 }, { task_id: 1, hours: true },
    { task_id: 1, hours: [1] }, { task_id: 1, hours: 'Infinity' }, { task_id: 1, hours: 25 },
    { task_id: 1, hours: 1, description: {} }, { task_id: 1, visit_id: 1, hours: 1 }]) {
    assert.equal((await api('/api/time-logs', { method: 'POST', token: ids.tokenManager, body })).status, 400, JSON.stringify(body));
  }
  for (const path of ['/api/time-logs?task_id=abc', '/api/time-logs/mine?from=2026-02-30&to=2026-03-01',
    '/api/time-logs/summary?month=2026-13', '/api/time-logs/summary?user_id=abc']) {
    assert.equal((await api(path, { token: ids.tokenManager })).status, 400, path);
  }
});

test('customer contracts validate merged dates and allow clearing optional fields', async () => {
  const created = await api('/api/customers', { method: 'POST', token: ids.tokenManager, body: {
    name: 'Contract edit customer', customer_code: 'EDIT', contract_type: 'MSP',
    contract_start_date: '2026-01-01', contract_end_date: '2026-12-31', included_hours: 20,
  } });
  assert.equal(created.status, 200);
  const endpoint = `/api/customers/${created.data.id}`;
  for (const body of [{ name: {} }, { included_hours: -1 }, { included_hours: 'Infinity' },
    { included_hours: [] }, { contract_start_date: '2026-02-30' }, { contract_end_date: '2025-12-31' }, { notes: {} }]) {
    assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenManager, body })).status, 400, JSON.stringify(body));
  }
  assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenManager, body: { notes: 'Updated notes' } })).status, 200);
  let stored = await db.prepare('SELECT contract_start_date, included_hours FROM customers WHERE id=?').get(created.data.id);
  assert.equal(stored.contract_start_date, '2026-01-01');
  assert.equal(Number(stored.included_hours), 20);
  assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenManager,
    body: { customer_code: '', contract_type: null, contract_start_date: '', contract_end_date: null, included_hours: '' } })).status, 200);
  stored = await db.prepare('SELECT customer_code, contract_type, contract_start_date, contract_end_date, included_hours FROM customers WHERE id=?').get(created.data.id);
  assert.ok(Object.values(stored).every(value => value === null));
  assert.equal((await api('/api/customers', { method: 'POST', token: ids.tokenManager, body: { name: [] } })).status, 400);
});

test('projects validate memberships, calendar dates, status updates and pin access', async () => {
  for (const body of [{ title: 'Invalid members', member_ids: {} }, { title: 'Invalid date', deadline: '2026-02-30' },
    { title: 'Wrong role', member_ids: [ids.manager] }]) {
    assert.equal((await api('/api/projects', { method: 'POST', token: ids.tokenManager, body })).status, 400);
  }
  const created = await api('/api/projects', { method: 'POST', token: ids.tokenManager,
    body: { title: 'Project review', deadline: '2026-12-01', member_ids: [ids.engineerEnabled] } });
  assert.equal(created.status, 200);
  const endpoint = `/api/projects/${created.data.id}`;
  assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenManager, body: { deadline: null } })).status, 200);
  assert.equal((await db.prepare('SELECT deadline FROM projects WHERE id=?').get(created.data.id)).deadline, null);
  assert.equal((await api(`${endpoint}/pin`, { method: 'POST', token: ids.tokenDisabled })).status, 403);
  assert.equal((await api(`${endpoint}/pin`, { method: 'POST', token: ids.tokenEnabled })).status, 200);
  for (const message of [{}, '   ']) {
    assert.equal((await api(`${endpoint}/status-update`, { method: 'POST', token: ids.tokenManager, body: { message } })).status, 400);
  }
  assert.equal((await api('/api/projects/99999999/status-update', { method: 'POST', token: ids.tokenManager, body: { message: 'Missing project' } })).status, 404);
  assert.equal((await api(`${endpoint}/request-closure`, { method: 'POST', token: ids.tokenDisabled })).status, 403);
  assert.equal((await api(`${endpoint}/request-closure`, { method: 'POST', token: ids.tokenEnabled })).status, 200);
  assert.equal((await api(`${endpoint}/approve-closure`, { method: 'POST', token: ids.tokenEnabled })).status, 403);
  assert.equal((await api(`${endpoint}/approve-closure`, { method: 'POST', token: ids.tokenManager })).status, 200);
  const updates = await db.prepare('SELECT message FROM project_status_updates WHERE project_id=?').all(created.data.id);
  assert.equal(updates.length, 2);
});

test('concurrent project closure requests and approvals write one update each on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const project = (await db.prepare('INSERT INTO projects (title, created_by) VALUES (?, ?)').run('Concurrent closure', ids.manager)).lastInsertRowid;
  for (const action of ['request-closure', 'approve-closure']) {
    const results = await Promise.all([0, 1, 2].map(() => api(`/api/projects/${project}/${action}`, { method: 'POST', token: ids.tokenManager })));
    assert.equal(results.filter(r => r.status === 200).length, 1);
    assert.ok(results.every(r => [200, 400, 409].includes(r.status)));
  }
  assert.equal((await db.prepare('SELECT message FROM project_status_updates WHERE project_id=?').all(project)).length, 2);
});

test('maintenance visits validate dates, assignments and engineer notes', async () => {
  const body = { title: 'Reviewed visit', customer_id: ids.customer, scheduled_date: '2026-11-01', engineer_ids: [ids.engineerEnabled] };
  for (const invalid of [{ ...body, scheduled_date: '2026-02-30' }, { ...body, engineer_ids: [ids.manager] }, { ...body, notes: {} }]) {
    assert.equal((await api('/api/maintenance-visits', { method: 'POST', token: ids.tokenManager, body: invalid })).status, 400);
  }
  const created = await api('/api/maintenance-visits', { method: 'POST', token: ids.tokenManager, body });
  assert.equal(created.status, 200);
  const endpoint = `/api/maintenance-visits/${created.data.id}`;
  assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenDisabled, body: { notes: 'Private' } })).status, 403);
  assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenEnabled, body: { notes: {} } })).status, 400);
  assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenEnabled, body: { notes: 'Engineer notes' } })).status, 200);
  assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenManager,
    body: { title: 'Rescheduled visit', engineer_ids: [ids.engineerDisabled] } })).status, 200);
  const assigned = await db.prepare('SELECT user_id FROM maintenance_visit_engineers WHERE visit_id=?').all(created.data.id);
  assert.deepEqual(assigned, [{ user_id: ids.engineerDisabled }]);
});

test('maintenance report transitions preserve original attribution and clear downstream flags', async () => {
  const visit = (await db.prepare('INSERT INTO maintenance_visits (customer_id, title, scheduled_date, status, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(ids.customer, 'Report transitions', '2026-11-01', 'in_progress', ids.manager)).lastInsertRowid;
  await db.prepare('INSERT INTO maintenance_visit_engineers (visit_id, user_id) VALUES (?, ?)').run(visit, ids.engineerEnabled);
  const endpoint = `/api/maintenance-visits/${visit}`;
  assert.equal((await api(`${endpoint}/report-sent`, { method: 'POST', token: ids.tokenEnabled })).status, 200);
  assert.equal((await api(`${endpoint}/report-sent`, { method: 'POST', token: ids.tokenManager })).status, 200);
  assert.equal((await db.prepare('SELECT report_sent_by FROM maintenance_visits WHERE id=?').get(visit)).report_sent_by, ids.engineerEnabled);
  assert.equal((await api(`${endpoint}/report-customer-sent`, { method: 'POST', token: ids.tokenManager })).status, 200);
  assert.equal((await api(`${endpoint}/report-unsent`, { method: 'POST', token: ids.tokenManager })).status, 200);
  let stored = await db.prepare('SELECT status, report_sent, report_sent_to_customer, report_sent_to_customer_by FROM maintenance_visits WHERE id=?').get(visit);
  assert.equal(stored.status, 'in_progress');
  assert.equal(stored.report_sent, 0);
  assert.equal(stored.report_sent_to_customer, 0);
  assert.equal(stored.report_sent_to_customer_by, null);
  assert.equal((await api(`${endpoint}/report-customer-sent`, { method: 'POST', token: ids.tokenManager })).status, 400);
  await db.prepare("UPDATE maintenance_visits SET status='completed' WHERE id=?").run(visit);
  assert.equal((await api(`${endpoint}/report-customer-unsent`, { method: 'POST', token: ids.tokenManager })).status, 200);
  assert.equal((await db.prepare('SELECT status FROM maintenance_visits WHERE id=?').get(visit)).status, 'completed');
  await db.prepare("UPDATE maintenance_visits SET status='cancelled' WHERE id=?").run(visit);
  for (const action of ['report-sent', 'report-customer-sent', 'complete']) {
    assert.equal((await api(`${endpoint}/${action}`, { method: 'POST', token: ids.tokenManager })).status, 400);
  }
  assert.equal((await api('/api/maintenance-visits/99999999/report-customer-unsent', { method: 'POST', token: ids.tokenManager })).status, 404);
});

test('admin user input validation, duplicate emails and email clearing return predictable results', async () => {
  const body = { name: 'Admin test engineer', email: 'admin-test@test.local', password: 'new-password-123', role: 'engineer' };
  for (const invalid of [{ ...body, name: {} }, { ...body, email: {} }, { ...body, password: {} }, { ...body, password: 'x'.repeat(73) }]) {
    assert.equal((await api('/api/admin/users', { method: 'POST', token: ids.tokenManager, body: invalid })).status, 400);
  }
  const created = await api('/api/admin/users', { method: 'POST', token: ids.tokenManager, body });
  assert.equal(created.status, 200);
  assert.equal((await api('/api/admin/users', { method: 'POST', token: ids.tokenManager, body })).status, 409);
  const endpoint = `/api/admin/users/${created.data.id}`;
  assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenManager, body: { name: {} } })).status, 400);
  assert.equal((await api(`${endpoint}/reset-password`, { method: 'POST', token: ids.tokenManager, body: { password: {} } })).status, 400);
  assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenManager, body: { email: null } })).status, 200);
  assert.equal((await db.prepare('SELECT email FROM users WHERE id=?').get(created.data.id)).email, null);
  assert.equal((await api(`/api/admin/users/${ids.manager}/toggle-active`, { method: 'POST', token: ids.tokenManager })).status, 400);
  assert.equal((await api(`/api/admin/users/${ids.manager}`, { method: 'DELETE', token: ids.tokenManager })).status, 400);
  assert.equal((await api('/api/admin/users', { method: 'POST', token: ids.tokenEnabled, body })).status, 403);
});

test('the final active manager cannot demote themselves', async () => {
  const original = await db.prepare("SELECT id FROM users WHERE role='manager' AND active=1").all();
  const user = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
    .run('Final manager', 'final-manager@test.local', bcrypt.hashSync('pw', 4), 'manager')).lastInsertRowid;
  try {
    for (const row of original) await db.prepare('UPDATE users SET active=0 WHERE id=?').run(row.id);
    assert.equal((await api(`/api/admin/users/${user}`, { method: 'PUT', token: signJwt({ id: user }), body: { role: 'engineer' } })).status, 400);
    assert.equal((await db.prepare('SELECT role FROM users WHERE id=?').get(user)).role, 'manager');
  } finally {
    for (const row of original) await db.prepare('UPDATE users SET active=1 WHERE id=?').run(row.id);
    await db.prepare('UPDATE users SET active=0 WHERE id=?').run(user);
  }
});

test('concurrent manager self-demotions preserve an active manager on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const original = await db.prepare("SELECT id FROM users WHERE role='manager' AND active=1").all();
  const managers = [];
  for (const suffix of ['a', 'b']) managers.push((await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
    .run(`Concurrent manager ${suffix}`, `concurrent-manager-${suffix}@test.local`, bcrypt.hashSync('pw', 4), 'manager')).lastInsertRowid);
  try {
    for (const row of original) await db.prepare('UPDATE users SET active=0 WHERE id=?').run(row.id);
    const results = await Promise.all(managers.map(id => api(`/api/admin/users/${id}`, {
      method: 'PUT', token: signJwt({ id }), body: { role: 'engineer' },
    })));
    assert.equal(results.filter(r => r.status === 200).length, 1);
    assert.ok(results.every(r => [200, 400, 401].includes(r.status)));
    const remaining = await db.prepare("SELECT COUNT(*) AS c FROM users WHERE role='manager' AND active=1").get();
    assert.equal(Number(remaining.c), 1);
  } finally {
    for (const row of original) await db.prepare('UPDATE users SET active=1 WHERE id=?').run(row.id);
    for (const id of managers) await db.prepare('UPDATE users SET active=0 WHERE id=?').run(id);
  }
});

test('personal notes and todos reject malformed values and isolate users', async () => {
  assert.equal((await api('/api/notes/note', { method: 'PUT', token: ids.tokenEnabled, body: { content: {} } })).status, 400);
  assert.equal((await api('/api/notes/note', { method: 'PUT', token: ids.tokenEnabled, body: { content: 'Private scratchpad' } })).status, 200);
  assert.equal((await api('/api/notes/note', { token: ids.tokenEnabled })).data.content, 'Private scratchpad');
  assert.equal((await api('/api/notes/note', { token: ids.tokenDisabled })).data.content, '');
  assert.equal((await api('/api/notes/todos', { method: 'POST', token: ids.tokenEnabled, body: { title: {} } })).status, 400);
  const created = await api('/api/notes/todos', { method: 'POST', token: ids.tokenEnabled, body: { title: 'Private todo' } });
  assert.equal(created.status, 200);
  const endpoint = `/api/notes/todos/${created.data.id}`;
  for (const body of [{ title: {} }, { done: 'false' }]) {
    assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenEnabled, body })).status, 400);
  }
  assert.equal((await api(endpoint, { method: 'PUT', token: ids.tokenDisabled, body: { done: true } })).status, 404);
  assert.equal((await api(endpoint, { method: 'DELETE', token: ids.tokenDisabled })).status, 200);
  assert.equal((await api('/api/notes/todos', { token: ids.tokenEnabled })).data.length, 1);
});

// pg-mem does not implement the correlated customer-count subqueries used by search.
test('quick and smart search enforce task roles and PM project visibility', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const project = (await db.prepare('INSERT INTO projects (title, created_by) VALUES (?, ?)').run('Search review project', ids.manager)).lastInsertRowid;
  await db.prepare('INSERT INTO tasks (title, created_by, assigned_to) VALUES (?, ?, ?)').run('Search review private task', ids.manager, ids.engineerEnabled);
  for (const role of ['planner', 'pm']) {
    const user = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
      .run(`Search ${role}`, `search-${role}@test.local`, bcrypt.hashSync('pw', 4), role)).lastInsertRowid;
    const token = signJwt({ id: user });
    const quick = await api('/api/search?q=Search%20review', { token });
    assert.equal(quick.status, 200);
    assert.deepEqual(quick.data.tasks, []);
    const smart = await api('/api/search/smart?entity=tasks&q=Search%20review', { token });
    assert.equal(smart.status, 200);
    assert.deepEqual(smart.data.tasks, []);
    const projects = await api('/api/search/smart?entity=projects&q=Search%20review', { token });
    assert.equal(projects.status, 200);
    assert.equal(projects.data.projects.some(p => p.id === project), role === 'pm');
    assert.equal(quick.data.projects.some(p => p.id === project), role === 'pm');
  }
  assert.equal((await api('/api/search?q=Search%20review', { token: ids.tokenEnabled })).data.tasks.length, 1);
  assert.equal((await api('/api/search?q=Search%20review', { token: ids.tokenDisabled })).data.tasks.length, 0);
  for (const path of ['/api/search?q[a]=test', '/api/search/smart?q[a]=test', '/api/search/smart?entity=unknown'])
    assert.equal((await api(path, { token: ids.tokenManager })).status, 400);
});

test('service activities validate follow-up dates, times, IDs, text and boolean inputs', async () => {
  const base = { customer_id: ids.customer, activity_date: new Date().toISOString().slice(0, 10), category_id: ids.category, title: 'Validation review' };
  for (const invalid of [{ follow_up_date: '2026-02-30' }, { follow_up_date: {} }, { start_time: '25:00' },
    { end_time: '12:99' }, { category_id: {} }, { related_project_id: [] }, { change_reason: {} },
    { follow_up_required: 'false' }, { rollback_available: 'false' }]) {
    assert.equal((await api('/api/service-activities', { method: 'POST', token: ids.tokenEnabled, body: { ...base, ...invalid } })).status, 400, JSON.stringify(invalid));
  }
  const created = await api('/api/service-activities', { method: 'POST', token: ids.tokenEnabled,
    body: { ...base, start_time: '09:00', end_time: '10:00', follow_up_required: true, follow_up_date: '2026-12-01' } });
  assert.equal(created.status, 200);
  assert.equal((await api(`/api/service-activities/${created.data.id}`, { method: 'PUT', token: ids.tokenEnabled,
    body: { follow_up_date: 'not-a-date' } })).status, 400);
});

test('tracking blocks planners even in enabled teams and keeps PM activity access separate from task creation', async () => {
  for (const role of ['planner', 'pm']) {
    const user = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
      .run(`Tracking ${role}`, `tracking-${role}@test.local`, bcrypt.hashSync('pw', 4), role)).lastInsertRowid;
    await db.prepare('INSERT INTO team_members (team_id, user_id) VALUES (?, ?)').run(ids.teamEnabled, user);
    const token = signJwt({ id: user });
    const body = { customer_id: ids.customer, activity_date: new Date().toISOString().slice(0, 10), category_id: ids.category, title: `Tracking ${role}` };
    assert.equal((await api('/api/service-activities/meta', { token })).status, role === 'planner' ? 403 : 200);
    const created = await api('/api/service-activities', { method: 'POST', token, body });
    assert.equal(created.status, role === 'planner' ? 403 : 200);
    if (role === 'pm') {
      assert.equal((await api(`/api/service-activities/${created.data.id}`, { token })).status, 200);
      assert.equal((await api(`/api/service-activities/${created.data.id}/follow-up-task`, { method: 'POST', token })).status, 403);
      const other = await db.prepare('SELECT id FROM service_activities WHERE engineer_id=? LIMIT 1').get(ids.engineerEnabled);
      assert.equal((await api(`/api/service-activities/${other.id}`, { token })).status, 403);
    }
  }
});

test('tracking metadata exposes customer requirements only for authorized customers', async () => {
  await db.prepare('UPDATE customers SET require_ticket_reference=1 WHERE id=?').run(ids.customer);
  try {
    const meta = await api('/api/service-activities/meta', { token: ids.tokenEnabled });
    assert.equal(meta.status, 200);
    assert.equal(meta.data.customers.find(c => c.id === ids.customer).require_ticket_reference, 1);
    assert.ok(!meta.data.customers.some(c => c.id === ids.customerUnassigned));
  } finally { await db.prepare('UPDATE customers SET require_ticket_reference=0 WHERE id=?').run(ids.customer); }
});

test('the activity detail used for editing preserves notes, category and technologies', async () => {
  const technology = (await db.prepare('INSERT INTO technologies (name) VALUES (?)').run('Edit detail technology')).lastInsertRowid;
  const created = await api('/api/service-activities', { method: 'POST', token: ids.tokenEnabled, body: {
    customer_id: ids.customer, category_id: ids.category, activity_date: new Date().toISOString().slice(0, 10),
    title: 'Full edit detail', description: 'Preserve these notes', technology_ids: [technology], ticket_reference: 'CASE-123',
  } });
  assert.equal(created.status, 200);
  const detail = await api(`/api/service-activities/${created.data.id}`, { token: ids.tokenEnabled });
  assert.equal(detail.status, 200);
  assert.equal(detail.data.customer_id, ids.customer);
  assert.equal(detail.data.category_id, ids.category);
  assert.equal(detail.data.description, 'Preserve these notes');
  assert.deepEqual(detail.data.technologies.map(t => t.id), [technology]);
  const edited = await api(`/api/service-activities/${created.data.id}`, { method: 'PUT', token: ids.tokenEnabled,
    body: { ...detail.data, title: 'Edited title', technology_ids: detail.data.technologies.map(t => t.id) } });
  assert.equal(edited.status, 200);
  const saved = await api(`/api/service-activities/${created.data.id}`, { token: ids.tokenEnabled });
  assert.equal(saved.data.description, 'Preserve these notes');
  assert.equal(saved.data.ticket_reference, 'CASE-123');
  assert.deepEqual(saved.data.technologies.map(t => t.id), [technology]);
});

test('attachment upload failures clean files and attachment reads enforce activity ownership', async t => {
  const fs = require('fs');
  const path = require('path');
  const { uploadDir } = require('../uploadUtils');
  const activity = (await api('/api/service-activities', { method: 'POST', token: ids.tokenEnabled, body: {
    customer_id: ids.customer, category_id: ids.category, activity_date: new Date().toISOString().slice(0, 10), title: 'Attachment regression',
  } })).data.id;
  const endpoint = `/api/service-activities/${activity}/attachments`;
  const uploadPdf = async () => {
    const form = new FormData();
    form.append('file', new Blob(['%PDF-1.4\nTest document'], { type: 'application/pdf' }), 'test.pdf');
    const response = await fetch(`${baseUrl}${endpoint}`, { method: 'POST', headers: { Authorization: `Bearer ${ids.tokenEnabled}` }, body: form });
    return { status: response.status, data: await response.json() };
  };
  const before = (await fs.promises.readdir(uploadDir)).sort();
  const originalPrepare = db.prepare;
  const failure = t.mock.method(db, 'prepare', function(sql) {
    if (/INSERT INTO attachments/i.test(sql)) return { run: async () => { throw new Error('Simulated attachment database failure'); } };
    return originalPrepare.call(this, sql);
  });
  try {
    assert.equal((await uploadPdf()).status, 500);
    assert.deepEqual((await fs.promises.readdir(uploadDir)).sort(), before);
  } finally { failure.mock.restore(); }
  const uploaded = await uploadPdf();
  assert.equal(uploaded.status, 200);
  const attachment = await db.prepare('SELECT stored_name FROM attachments WHERE id=?').get(uploaded.data.id);
  const storedPath = path.join(uploadDir, attachment.stored_name);
  try {
    assert.equal((await api(endpoint, { token: ids.tokenDisabled })).status, 403);
    const download = await fetch(`${baseUrl}${endpoint}/${uploaded.data.id}/download`, { headers: { Authorization: `Bearer ${ids.tokenDisabled}` } });
    assert.equal(download.status, 403);
    const original = db.prepare;
    const deletionFailure = t.mock.method(db, 'prepare', function(sql) {
      if (/DELETE FROM attachments WHERE id/i.test(sql)) return { run: async () => { throw new Error('Simulated delete failure'); } };
      return original.call(this, sql);
    });
    try {
      assert.equal((await api(`${endpoint}/${uploaded.data.id}`, { method: 'DELETE', token: ids.tokenEnabled })).status, 500);
      assert.equal(fs.existsSync(storedPath), true);
    } finally { deletionFailure.mock.restore(); }
    assert.equal((await api(`${endpoint}/${uploaded.data.id}`, { method: 'DELETE', token: ids.tokenEnabled })).status, 200);
    assert.equal(fs.existsSync(storedPath), false);
  } finally {
    await fs.promises.unlink(storedPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
});


test('activity edits reject stale versions without changing fields or technologies', async () => {
  const technology = (await db.prepare('INSERT INTO technologies (name) VALUES (?)').run('Concurrent edit technology')).lastInsertRowid;
  const created = await createActivity({ title: 'Concurrent editing', description: 'Original', technology_ids: [technology] });
  const path = `/api/service-activities/${created.data.id}`;
  const snapshot = await api(path, { token: ids.tokenManager });
  const options = { method: 'PUT', token: ids.tokenManager };
  const first = await api(path, { ...options, body: { version: snapshot.data.version, description: 'Winning edit' } });
  assert.equal(first.status, 200);
  const stale = await api(path, { ...options, body: { version: snapshot.data.version, description: 'Lost edit', technology_ids: [] } });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.code, 'ACTIVITY_CONFLICT');
  const saved = await api(path, { token: ids.tokenManager });
  assert.equal(saved.data.description, 'Winning edit');
  assert.deepEqual(saved.data.technologies.map(item => item.id), [technology]);
  assert.equal(saved.data.version, snapshot.data.version + 1);
  assert.equal((await api(path, { ...options, useCurrentVersion: false, body: { title: 'Missing version' } })).status, 428);
  assert.equal((await api(path, { ...options, body: { version: '1' } })).status, 400);
  assert.equal((await api(path, { ...options, body: { version: saved.data.version, description: 'Fresh edit' } })).status, 200);
});

test('list and export reject the same malformed filters', async () => {
  for (const query of ['customer_id=1x', 'category_id=-1', 'technology_id=0', 'from=2026-02-30', 'to=bad', 'from=2026-09-17&to=2026-09-01', 'page=1.5', 'page_size=201', 'page=9007199254740991', 'search=a&search=b', 'status[x]=planned']) {
    for (const route of ['/api/service-activities', '/api/service-activities/export']) {
      const result = await api(`${route}?${query}`, { token: ids.tokenManager });
      assert.equal(result.status, 400, `${route}?${query}`);
    }
  }
});

// pg-mem cannot execute the correlated technology predicate over these joins.
test('Excel export matches all list filters and exports the entire matching set', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const technology = (await db.prepare('INSERT INTO technologies (name) VALUES (?)').run('Export consistency technology')).lastInsertRowid;
  for (let i = 0; i < 2; i++) await createActivity({ title: `Export consistency ${i}`, technology_ids: [technology], billable_classification: 'billable' });
  await createActivity({ title: 'Export consistency excluded', billable_classification: 'non_billable' });
  const query = new URLSearchParams({ customer_id: ids.customer, category_id: ids.category, technology_id: technology, status: 'planned', billable_classification: 'billable', search: 'Export consistency', from: '2026-01-01', to: '2026-01-31', page_size: 1 });
  const list = await api(`/api/service-activities?${query}`, { token: ids.tokenManager });
  assert.equal(list.status, 200);
  assert.equal(Number(list.data.total), 2);
  assert.equal(list.data.rows.length, 1);
  const response = await fetch(`${baseUrl}/api/service-activities/export?${query}`, { headers: { Authorization: `Bearer ${ids.tokenManager}` } });
  assert.equal(response.status, 200);
  const workbook = new (require('exceljs').Workbook)();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  const rows = workbook.getWorksheet('Service Activities').getSheetValues().slice(2);
  assert.equal(rows.length, 2);
  assert.equal(rows[0][1], list.data.rows[0].activity_reference);
  assert.ok(rows.every(row => row[5].startsWith('Export consistency') && row[8] === 'billable'));
});


test('simultaneous edits allow exactly one write on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const created = await createActivity({ title: 'Simultaneous edits' });
  const path = `/api/service-activities/${created.data.id}`;
  const snapshot = await api(path, { token: ids.tokenEnabled });
  const results = await Promise.all(['First writer', 'Second writer'].map(description => api(path, {
    method: 'PUT', token: ids.tokenEnabled, body: { version: snapshot.data.version, description },
  })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const saved = await api(path, { token: ids.tokenEnabled });
  assert.equal(saved.data.version, snapshot.data.version + 1);
  assert.ok(['First writer', 'Second writer'].includes(saved.data.description));
});

test('completion and follow-up creation invalidate older editing snapshots', async () => {
  const created = await createActivity({ title: 'Other mutations invalidate edits' });
  const path = `/api/service-activities/${created.data.id}`;
  const token = ids.tokenEnabled;
  const before = (await api(path, { token })).data;
  assert.equal((await api(`${path}/complete`, { method: 'POST', token, body: {} })).status, 200);
  const completed = (await api(path, { token })).data;
  assert.equal(completed.version, before.version + 1);
  assert.equal((await api(path, { method: 'PUT', token, body: { version: before.version, title: 'Stale' } })).status, 409);
  assert.equal((await api(`${path}/complete`, { method: 'POST', token, body: {} })).status, 200);
  assert.equal((await api(path, { token })).data.version, completed.version);
  assert.equal((await api(`${path}/follow-up-task`, { method: 'POST', token, body: {} })).status, 200);
  const linked = (await api(path, { token })).data;
  assert.equal(linked.version, completed.version + 1);
  assert.equal((await api(path, { method: 'PUT', token, body: { version: completed.version, title: 'Stale' } })).status, 409);
  assert.equal((await api(`${path}/follow-up-task`, { method: 'POST', token, body: {} })).status, 200);
  assert.equal((await api(path, { token })).data.version, linked.version);
});


test('management activity report export rejects non-managers including scoped download tokens', async () => {
  for (const role of ['planner', 'pm', 'engineer']) {
    const user = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
      .run(`Report guard ${role}`, `report-guard-${role}@test.local`, bcrypt.hashSync('pw', 4), role)).lastInsertRowid;
    const token = signJwt({ id: user });
    assert.equal((await api('/api/reports/service-activity/export', { token })).status, 403);
    const downloadToken = signJwt({ id: user, download: true });
    assert.equal((await api(`/api/reports/service-activity/export?token=${downloadToken}`)).status, 403);
  }
  for (const suffix of ['', `?token=${signJwt({ id: ids.manager, download: true })}`]) {
    const response = await fetch(`${baseUrl}/api/reports/service-activity/export${suffix}`, {
      headers: suffix ? {} : { Authorization: `Bearer ${ids.tokenManager}` },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /spreadsheetml/);
    await response.arrayBuffer();
  }
});


test('project closure rejection records a complete decision and protects newer requests', async () => {
  const project = (await db.prepare('INSERT INTO projects (title, customer_id, created_by) VALUES (?, ?, ?)').run('Closure revision flow', ids.customer, ids.manager)).lastInsertRowid;
  await db.prepare('INSERT INTO project_assignments (project_id, user_id) VALUES (?, ?)').run(project, ids.engineerEnabled);
  const path = `/api/projects/${project}`;
  const request = await api(`${path}/request-closure`, { method: 'POST', token: ids.tokenEnabled });
  assert.equal(request.status, 200);
  const stored = await db.prepare('SELECT * FROM projects WHERE id=?').get(project);
  assert.equal(stored.closure_requested_by, ids.engineerEnabled);
  assert.equal(stored.closure_request_version, request.data.request_version);
  for (const comment of ['', '   ', {}, 'x'.repeat(2001)]) {
    assert.equal((await api(`${path}/reject-closure`, { method: 'POST', token: ids.tokenManager, body: { comment } })).status, 400);
  }
  assert.equal((await api(`${path}/reject-closure`, { method: 'POST', token: ids.tokenEnabled, body: { comment: 'Unauthorized' } })).status, 403);
  const rejection = await api(`${path}/reject-closure`, { method: 'POST', token: ids.tokenManager, body: { comment: 'Finish the handover documents', request_version: stored.closure_request_version } });
  assert.equal(rejection.status, 200);
  const rejected = await db.prepare('SELECT * FROM projects WHERE id=?').get(project);
  assert.equal(rejected.status, 'reopened');
  assert.equal(rejected.closure_reviewed_by, ids.manager);
  assert.equal(rejected.closure_decision, 'rejected');
  assert.equal(rejected.closure_review_comment, 'Finish the handover documents');
  assert.ok(rejected.closure_reviewed_at);
  assert.equal(rejected.closed_at, null);
  assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM project_activity WHERE project_id=? AND action='closure_rejected'").get(project)).n), 1);
  assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_id=? AND entity_type='project' AND action='closure_rejected'").get(project)).n), 1);
  assert.equal((await api(`${path}/reject-closure`, { method: 'POST', token: ids.tokenManager, body: { comment: 'Repeat' } })).status, 409);
  const notification = await db.prepare("SELECT body FROM notifications WHERE user_id=? AND type='project.closure_rejected' AND link=?").get(ids.engineerEnabled, path.replace('/api', ''));
  assert.match(notification.body, /handover documents/);
  const second = await api(`${path}/request-closure`, { method: 'POST', token: ids.tokenEnabled });
  assert.equal(second.data.request_version, stored.closure_request_version + 1);
  assert.equal((await api(`${path}/approve-closure`, { method: 'POST', token: ids.tokenManager, body: { request_version: stored.closure_request_version } })).status, 409);
  const approved = await api(`${path}/approve-closure`, { method: 'POST', token: ids.tokenManager, body: { request_version: second.data.request_version, comment: 'Handover reviewed' } });
  assert.equal(approved.status, 200);
  const detail = await api(path, { token: ids.tokenEnabled });
  assert.equal(detail.data.closure_requested_by_name, 'Engineer Enabled');
  assert.equal(detail.data.closure_reviewed_by_name, 'Manager One');
  assert.equal(detail.data.status, 'closed');
  assert.equal(detail.data.closure_decision, 'approved');
  assert.equal(detail.data.closure_review_comment, 'Handover reviewed');
  assert.equal(detail.data.updates.length, 4);
});

test('approval backlog and review endpoints are management-only with validated inputs', async () => {
  for (const token of [ids.tokenEnabled, ids.tokenDisabled]) {
    assert.equal((await api('/api/projects/approvals', { token })).status, 403);
  }
  for (const role of ['planner', 'pm']) {
    const user = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)').run(`Approval ${role}`, `approval-${role}@test.local`, bcrypt.hashSync('pw', 4), role)).lastInsertRowid;
    const token = signJwt({ id: user });
    assert.equal((await api('/api/projects/approvals', { token })).status, 403);
    assert.equal((await api(`/api/projects/1/reject-closure`, { method: 'POST', token, body: { comment: 'Denied' } })).status, 403);
  }
  for (const query of ['page=0', 'page=1x', 'page_size=101', 'page=9007199254740991', 'page=1&page=2']) {
    assert.equal((await api(`/api/projects/approvals?${query}`, { token: ids.tokenManager })).status, 400);
  }
  const project = (await db.prepare("INSERT INTO projects (title, status, created_by) VALUES (?, 'pending_approval', ?)").run('Legacy approval request', ids.manager)).lastInsertRowid;
  const backlog = await api('/api/projects/approvals?page_size=1', { token: ids.tokenManager });
  assert.equal(backlog.status, 200);
  assert.ok(backlog.data.total >= 1);
  assert.equal(backlog.data.rows.length, 1);
  for (const review of [{ request_version: '0' }, { comment: {} }]) {
    assert.equal((await api(`/api/projects/${project}/approve-closure`, { method: 'POST', token: ids.tokenManager, body: review })).status, 400);
  }
  assert.equal((await api(`/api/projects/${project}/approve-closure`, { method: 'POST', token: ids.tokenManager })).status, 200, 'existing clients may still approve without a version');
});

test('concurrent approval and rejection write exactly one decision on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const project = (await db.prepare('INSERT INTO projects (title, created_by) VALUES (?, ?)').run('Opposing closure decisions', ids.manager)).lastInsertRowid;
  const path = `/api/projects/${project}`;
  const request = await api(`${path}/request-closure`, { method: 'POST', token: ids.tokenManager });
  const body = { request_version: request.data.request_version, comment: 'Review decision' };
  const results = await Promise.all(['approve-closure', 'reject-closure'].map(action => api(`${path}/${action}`, { method: 'POST', token: ids.tokenManager, body })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM project_status_updates WHERE project_id=?').get(project)).n), 2);
  const stored = await db.prepare('SELECT status, closure_decision FROM projects WHERE id=?').get(project);
  assert.ok((stored.status === 'closed' && stored.closure_decision === 'approved') || (stored.status === 'reopened' && stored.closure_decision === 'rejected'));
});


test('closure review rolls back when its history cannot be recorded on PostgreSQL', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const project = (await db.prepare('INSERT INTO projects (title, created_by) VALUES (?, ?)').run('Closure history rollback', ids.manager)).lastInsertRowid;
  const path = `/api/projects/${project}`;
  const request = await api(`${path}/request-closure`, { method: 'POST', token: ids.tokenManager });
  const originalTransaction = db.transaction;
  try {
    db.transaction = callback => originalTransaction(tx => callback({ ...tx, prepare(sql) {
      if (sql.startsWith('INSERT INTO project_status_updates')) throw new Error('Simulated review history failure');
      return tx.prepare(sql);
    } }));
    const response = await api(`${path}/reject-closure`, { method: 'POST', token: ids.tokenManager, body: { comment: 'Review must persist', request_version: request.data.request_version } });
    assert.equal(response.status, 500);
  } finally { db.transaction = originalTransaction; }
  const stored = await db.prepare('SELECT status, closure_decision, closure_reviewed_by FROM projects WHERE id=?').get(project);
  assert.equal(stored.status, 'pending_approval');
  assert.equal(stored.closure_decision, null);
  assert.equal(stored.closure_reviewed_by, null);
});
