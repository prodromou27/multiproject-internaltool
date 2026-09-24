/**
 * PostgreSQL data layer.
 *
 * Exposes a small async facade that preserves the better-sqlite3 call shape used
 * throughout the routes — db.prepare(sql).get/all/run(...params) — so the SQL and
 * route structure stay intact; only `await` + async handlers change at call sites.
 *
 *   const row  = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
 *   const rows = await db.prepare('SELECT * FROM users').all();
 *   const { lastInsertRowid, changes } = await db.prepare('INSERT ...').run(a, b);
 *
 * Transactions:
 *   await db.transaction(async (tx) => { await tx.prepare('...').run(...); });
 *
 * The SQL in the routes is native PostgreSQL. The only rewriting left is in translate():
 *   - `?` placeholders        -> `$1, $2, ...`
 *   - plain INSERT (id table) -> auto-appended RETURNING id for lastInsertRowid (in run())
 * Timestamps are TEXT ('YYYY-MM-DD HH:MM:SS' in UTC), so "now" and "today" come from the
 * helper functions app_now() and app_today(), which init() creates. Month and day prefixes
 * of those strings use substr(col, 1, 7) and substr(col, 1, 10).
 * A test (test/nativeSql.test.js) fails if SQLite-only syntax is written back in.
 */
const pg = require('pg');
const { Pool } = pg;
const queryMetrics = require('./queryMetrics');

// node-pg returns int8 (bigint) and numeric as STRINGS by default. SQLite gave
// JS numbers, and the app does arithmetic/comparisons on COUNT/SUM/AVG/ROUND
// results everywhere, so coerce them back to numbers globally. All such values
// in this app are well within IEEE-754 safe range.
if (pg.types && pg.types.setTypeParser) {
  pg.types.setTypeParser(20,   v => (v === null ? null : parseInt(v, 10)));   // int8  / bigint
  pg.types.setTypeParser(1700, v => (v === null ? null : parseFloat(v)));     // numeric
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX) || 10,
});

pool.on('error', (err) => console.error('[pg pool]', err.message));

// Tables with no `id` column — never append RETURNING id to inserts into these.
const NO_ID_TABLE_RE = /\binto\s+(?:settings|maintenance_visit_engineers|maintenance_visit_assets|task_dependencies|task_custom_values|user_project_pins|team_members|customer_teams|customer_engineers|customer_search_documents|customer_search_tokens|managed_customer_configurations|service_activity_technologies|service_activity_assets|saved_custom_report_users|saved_custom_report_teams|role_permission_overrides|user_permission_overrides)\b/i;

// ── Placeholders: `?` -> `$1, $2, ...`, memoized per unique SQL string ───────
const _cache = new Map();

function translate(sql) {
  const cached = _cache.get(sql);
  if (cached) return cached;
  let n = 0;
  const converted = sql.replace(/\?/g, () => `$${++n}`);
  _cache.set(sql, converted);
  return converted;
}

// Build the prepare()-style interface bound to a runner (pool or tx client).
function makeInterface(runner) {
  const query = (sql, params) => queryMetrics.observeQuery(sql, () => runner.query(sql, params));
  return {
    prepare(rawSql) {
      return {
        async get(...params) {
          const r = await query(translate(rawSql), params);
          return r.rows[0];
        },
        async all(...params) {
          const r = await query(translate(rawSql), params);
          return r.rows;
        },
        async run(...params) {
          let sql = translate(rawSql);
          // Auto-return the new id for inserts so callers get lastInsertRowid.
          // Skip OR-IGNORE / ON-CONFLICT, statements with explicit RETURNING, and
          // the id-less tables (settings + junction tables) which have no `id`.
          if (/^\s*insert\s/i.test(sql) && !/returning/i.test(sql) && !/on\s+conflict/i.test(sql) && !NO_ID_TABLE_RE.test(sql)) {
            sql = sql.replace(/;?\s*$/, '') + ' RETURNING id';
          }
          const r = await query(sql, params);
          return {
            lastInsertRowid: r.rows && r.rows[0] ? r.rows[0].id : undefined,
            changes: r.rowCount,
          };
        },
      };
    },
    async exec(rawSql) {
      // Multi-statement DDL/SQL — passed through untranslated (used for schema).
      return query(rawSql);
    },
  };
}

const poolApi = makeInterface(pool);

// db.transaction(work): runs work(tx) inside BEGIN/COMMIT, ROLLBACK on throw.
async function transaction(work) {
  const client = await pool.connect();
  const tx = makeInterface(client);
  try {
    await client.query('BEGIN');
    const result = await work(tx);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}

// ── Schema (final state) + seed ──────────────────────────────────────────────
// ── Schema + seed (see ./schema/) ────────────────────────────────────────────
const { createBaseTables } = require('./schema/baseTables');
const { applyMigrations } = require('./schema/migrations');
const { createIndexes } = require('./schema/indexes');
const { runSeeds } = require('./schema/seeds');

async function init() {
  await createBaseTables(pool);
  await applyMigrations(pool, transaction);
  await require('./customerSearchIndex').ensureCustomerSearchIndex({ ...poolApi,transaction });
  await createIndexes(pool);
  await runSeeds(pool);
}

module.exports = {
  prepare: poolApi.prepare,
  exec: poolApi.exec,
  transaction,
  init,
  pool,
  queryMetrics: () => queryMetrics.snapshot(pool),
  _translate: translate, // exported for tests
};
