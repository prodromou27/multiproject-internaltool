/**
 * Shared harness for the service-activity integration suites: pg-mem (or the
 * CI PostgreSQL) behind the real db.js, the real route modules on a minimal
 * Express app, and a seeded cast of users/teams/customers (`ids`). Each suite
 * file requires this once, so each runs in its own process with a fresh database.
 * See the original file header notes in git history for the rationale.
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
  if (/CREATE OR REPLACE FUNCTION (round|app_now|app_today)/i.test(sql)) return null; // no-op
  const now = new Date().toISOString();
  let out = sql
    .replace(/\bapp_now\(\)/g, `'${now.slice(0, 19).replace('T', ' ')}'`)
    .replace(/\bapp_today\(\)/g, `'${now.slice(0, 10)}'`)
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
const db = require('../../db');
const { signJwt } = require('../../middleware/auth');

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
const afterSeedHooks = [];
/* Register extra setup that runs once the shared cast has been seeded. */
const afterSeed = fn => { afterSeedHooks.push(fn); };

// `node --test` also runs files under test/ directly; only hook in when a suite requires this.
const isSuiteImport = require.main !== module;

if (isSuiteImport) test.before(async () => {
  await db.init();

  const app = express();
  app.use(express.json());
  app.use('/api', require('../../middleware/session').protectCookieRequests);
  app.use('/api/auth', require('../../routes/auth'));
  app.use('/api/admin', require('../../routes/admin'));
  app.use('/api/notes', require('../../routes/notes'));
  app.use('/api/search', require('../../routes/search'));
  app.use('/api/reports', require('../../routes/reports'));
  app.use('/api/tasks', require('../../routes/tasks'));
  app.use('/api/projects', require('../../routes/projects'));
  app.use('/api/attachments', require('../../routes/attachments'));
  app.use('/api/operations', require('../../routes/operations'));
  app.use('/api/calendar', require('../../routes/calendar'));
  app.use('/api/maintenance-visits', require('../../routes/maintenance-visits'));
  app.use('/api/time-logs', require('../../routes/time-logs'));
  app.use('/api/teams', require('../../routes/teams'));
  app.use('/api/customers', require('../../routes/customers'));
  app.use('/api/workload', require('../../routes/workload'));
  app.use('/api/report-settings', require('../../routes/report-settings'));
  app.use('/api/settings', require('../../routes/settings'));
  app.use('/api/ticketing', require('../../routes/ticketing'));
  app.use('/api/managed-customers', require('../../routes/managedCustomers'));
  app.use('/api/managed-report-templates', require('../../routes/managedReportTemplates'));
  app.use('/api/permissions', require('../../routes/permissions'));
  app.use('/api/service-activities', require('../../routes/serviceActivities'));
  app.use('/api/projects/:projectId/custom-fields', require('../../routes/customFields'));
  app.use(require('../../middleware/errors').errorHandler);
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
  ids.planner = await mkUser('Planner One', 'planner');
  ids.pm = await mkUser('PM One', 'pm');

  ids.teamEnabled = (await db.prepare('INSERT INTO teams (name, service_activity_enabled) VALUES (?, 1)').run('Security Team')).lastInsertRowid;
  ids.teamDisabled = (await db.prepare('INSERT INTO teams (name, service_activity_enabled) VALUES (?, 0)').run('Legacy Team')).lastInsertRowid;
  await db.prepare('INSERT INTO team_members (team_id, user_id) VALUES (?, ?)').run(ids.teamEnabled, ids.engineerEnabled);
  await db.prepare('INSERT INTO team_members (team_id, user_id) VALUES (?, ?)').run(ids.teamDisabled, ids.engineerDisabled);

  ids.customer = (await db.prepare('INSERT INTO customers (name, active, service_activity_enabled) VALUES (?, 1, 1)').run('Acme Corp')).lastInsertRowid;
  ids.customerUnassigned = (await db.prepare('INSERT INTO customers (name, active, service_activity_enabled) VALUES (?, 1, 1)').run('Other Corp')).lastInsertRowid;
  await db.prepare('INSERT INTO customer_teams (customer_id, team_id) VALUES (?, ?)').run(ids.customer, ids.teamEnabled);

  const cat = await db.prepare('SELECT id FROM activity_categories LIMIT 1').get();
  ids.category = cat.id;
  ids.technology = (await db.prepare('SELECT id FROM technologies WHERE active=1 ORDER BY id LIMIT 1').get()).id;

  ids.tokenManager = signJwt({ id: ids.manager });
  ids.tokenEnabled = signJwt({ id: ids.engineerEnabled });
  ids.tokenDisabled = signJwt({ id: ids.engineerDisabled });
  ids.tokenPlanner = signJwt({ id: ids.planner });
  ids.tokenPm = signJwt({ id: ids.pm });
  for (const hook of afterSeedHooks) await hook();
});

if (isSuiteImport) test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await db.pool.end();
  Module.prototype.require = originalRequire;
});


async function createActivity(overrides = {}) {
  return api('/api/service-activities', {
    method: 'POST', token: ids.tokenEnabled,
    body: { customer_id: ids.customer, activity_date: '2026-01-15',
      category_id: ids.category, title: 'Validation regression', status: 'planned', ...overrides },
  });
}

/* Baseline customer work (an activity, a project with a task, a completed visit)
   for suites whose assertions were written against data earlier tests used to
   leave behind. Call from a suite's own test.before so the suite stands alone. */
async function seedCustomerWork() {
  await createActivity({ title: 'Baseline activity' });
  const project = (await db.prepare('INSERT INTO projects (title, customer_id, created_by) VALUES (?, ?, ?)').run('Baseline project', ids.customer, ids.manager)).lastInsertRowid;
  await db.prepare('INSERT INTO tasks (project_id, title, assigned_to, created_by) VALUES (?, ?, ?, ?)').run(project, 'Baseline task', ids.engineerEnabled, ids.manager);
  await db.prepare('INSERT INTO maintenance_visits (title, customer_id, scheduled_date, status, created_by) VALUES (?, ?, ?, ?, ?)').run('Baseline visit', ids.customer, '2026-03-10', 'completed', ids.manager);
}

module.exports = { test, assert, api, db, ids, createActivity, seedCustomerWork, afterSeed, express, bcrypt, signJwt, Module, originalRequire,
  get baseUrl() { return baseUrl; }, get server() { return server; } };
