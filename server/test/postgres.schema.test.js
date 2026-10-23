/**
 * Checks that need a real PostgreSQL server, so they run only when
 * TEST_DATABASE_URL points at a disposable database (CI provides one).
 *
 *  1. init() can run again and again without changing anything: each migration is
 *     recorded once, every index is valid and the expected tables exist.
 *  2. Every static SQL statement in the server source is accepted by PostgreSQL.
 *     Statements are prepared, not executed, so a renamed column, a typo or a
 *     dialect mistake in the SQLite-to-Postgres translation fails here instead of
 *     on the one screen that happens to use it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const hasDatabase = Boolean(process.env.TEST_DATABASE_URL);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(32);
if (hasDatabase) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

const skip = hasDatabase ? false : 'needs TEST_DATABASE_URL (a real PostgreSQL database)';

const { extractStatements } = require('./lib/extractSql');

test('extractor finds the statements the app runs', () => {
  const { statements } = extractStatements(path.join(__dirname, '..'));
  assert.ok(statements.length > 300, `expected hundreds of statements, found ${statements.length}`);
  assert.ok(statements.some(s => s.file === 'routes/serviceActivities.js'));
});

test('init() is safe to run repeatedly', { skip }, async () => {
  const db = require('../db');
  await db.init();
  const first = (await db.pool.query('SELECT id FROM schema_migrations ORDER BY id')).rows.map(r => r.id);
  assert.ok(first.length > 0, 'migrations are recorded');

  await db.init();
  const second = (await db.pool.query('SELECT id FROM schema_migrations ORDER BY id')).rows.map(r => r.id);
  assert.deepEqual(second, first, 'a second init() changes no migration records');
  assert.equal(new Set(second).size, second.length, 'no migration is recorded twice');

  const tables = new Set((await db.pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")).rows.map(r => r.table_name));
  for (const name of ['users', 'customers', 'projects', 'tasks', 'maintenance_visits', 'settings', 'audit_log',
    'teams', 'team_members', 'customer_teams', 'customer_search_documents', 'customer_search_tokens',
    'managed_customer_configurations', 'customer_ticketing_configurations', 'external_tickets', 'ticket_sync_runs', 'service_activities', 'activity_categories', 'technologies',
    'kpi_definitions', 'kpi_values']) {
    assert.ok(tables.has(name), `table ${name} exists`);
  }

  const invalid = (await db.pool.query(
    `SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE NOT i.indisvalid`)).rows;
  assert.deepEqual(invalid, [], 'every index is valid');
});

// Codes that only mean PostgreSQL cannot guess a parameter's type without a value.
// The statement itself is fine and works once the app supplies real values.
const UNTYPED_PARAMETER = new Set(['42P18', '42P08']);

test('every static SQL statement is accepted by PostgreSQL', { skip }, async () => {
  const db = require('../db');
  await db.init();
  const { statements } = extractStatements(path.join(__dirname, '..'));
  const client = await db.pool.connect();
  const failures = [];
  try {
    for (const [index, statement] of statements.entries()) {
      const sql = db._translate(statement.sql).replace(/;\s*$/, '');
      const name = `smoke_${index}`;
      try {
        await client.query(`PREPARE ${name} AS ${sql}`);
        await client.query(`DEALLOCATE ${name}`);
      } catch (error) {
        if (UNTYPED_PARAMETER.has(error.code)) continue;
        failures.push(`${statement.file}:${statement.line}  [${error.code}] ${error.message}`);
      }
    }
  } finally {
    client.release();
  }
  assert.deepEqual(failures, [], `${failures.length} statement(s) rejected by PostgreSQL:\n${failures.join('\n')}`);
});

test.after(async () => {
  if (hasDatabase) await require('../db').pool.end();
});
