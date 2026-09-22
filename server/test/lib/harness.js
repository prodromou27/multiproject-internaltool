/**
 * Shared route-test harness: swaps db.js's Postgres Pool for pg-mem (unless
 * TEST_DATABASE_URL points at a real disposable database), mounts the given
 * route modules on a minimal Express app and returns a small API client.
 * Must be required BEFORE '../db'.
 */
process.env.JWT_SECRET = 'x'.repeat(32);
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://fake:fake@localhost/fake';

const { newDb, DataType } = require('pg-mem');
const Module = require('module');

const memDb = newDb();
memDb.public.registerFunction({ name: 'substr', args: [DataType.text, DataType.integer, DataType.integer],
  returns: DataType.text, implementation: (text, start, length) => text.substring(start - 1, start - 1 + length) });
const { Pool: RealPool } = memDb.adapters.createPg();

// pg-mem lacks round() overloads, to_char()/AT TIME ZONE and NULL-vs-CHECK semantics;
// see serviceActivities.integration.test.js for the full rationale.
function pgMemCompatible(sql) {
  if (/CREATE OR REPLACE FUNCTION (round|app_now|app_today)/i.test(sql)) return null;
  const now = new Date().toISOString();
  let out = sql
    .replace(/\bapp_now\(\)/g, `'${now.slice(0, 19).replace('T', ' ')}'`)
    .replace(/\bapp_today\(\)/g, `'${now.slice(0, 10)}'`)
    .replace(/to_char\(\(now\(\)\s*AT TIME ZONE 'UTC'\),\s*'YYYY-MM-DD HH24:MI:SS'\)/gi, `'${now.slice(0, 19).replace('T', ' ')}'`)
    .replace(/to_char\(\(now\(\)\s*AT TIME ZONE 'UTC'\),\s*'YYYY-MM-DD'\)/gi, `'${now.slice(0, 10)}'`);
  if (/^\s*CREATE TABLE/i.test(out)) out = out.replace(/\s+CHECK\([a-z_]+\s+IN\s*\([^)]*\)\)/gi, '');
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

const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === 'pg' && !process.env.TEST_DATABASE_URL) return { ...originalRequire.apply(this, arguments), Pool };
  return originalRequire.apply(this, arguments);
};

require('express-async-errors');
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../../db');
const { signJwt } = require('../../middleware/auth');

/** mounts: { '/api/notes': require('../routes/notes'), ... } */
async function start(mounts) {
  await db.init();
  const app = express();
  app.use(express.json());
  for (const [path, router] of Object.entries(mounts)) app.use(path, router);
  app.use(require('../../middleware/errors').errorHandler);
  const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function api(path, { method = 'GET', token, body } = {}) {
    const res = await fetch(baseUrl + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  }

  async function makeUser(name, role) {
    const id = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
      .run(name, `${name.toLowerCase().replace(/\W+/g, '.')}@test.local`, bcrypt.hashSync('pw', 4), role)).lastInsertRowid;
    return { id, token: signJwt({ id }) };
  }

  async function stop() {
    await new Promise(resolve => server.close(resolve));
    await db.pool.end();
    Module.prototype.require = originalRequire;
  }

  return { api, makeUser, stop, db, baseUrl };
}

module.exports = { start };
