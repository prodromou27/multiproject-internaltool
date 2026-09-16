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
process.env.DATABASE_URL = 'postgres://fake:fake@localhost/fake';

const { newDb } = require('pg-mem');
const memDb = newDb();
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
  if (id === 'pg') {
    const real = originalRequire.apply(this, arguments);
    return { ...real, Pool };
  }
  return originalRequire.apply(this, arguments);
};

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signJwt } = require('../middleware/auth');

let server, baseUrl;

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

let ids = {};

test.before(async () => {
  await db.init();

  const app = express();
  app.use(express.json());
  app.use('/api/teams', require('../routes/teams'));
  app.use('/api/customers', require('../routes/customers'));
  app.use('/api/service-activities', require('../routes/serviceActivities'));
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
  await new Promise(resolve => server.close(resolve));
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
