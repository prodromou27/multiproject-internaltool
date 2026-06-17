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
 * Dialect differences from SQLite are handled centrally in translate():
 *   - `?` placeholders        → `$1, $2, …`
 *   - datetime('now')/date()  → text timestamps via to_char / substr
 *   - strftime('%Y-%m', x)    → substr(x, 1, 7)  (timestamps stored as ISO text)
 *   - GROUP_CONCAT(...)       → string_agg(...)
 *   - INSERT OR IGNORE        → INSERT ... ON CONFLICT DO NOTHING
 *   - plain INSERT (id table) → auto-appended RETURNING id for lastInsertRowid
 * INSERT OR REPLACE upserts are rewritten by hand at their call sites.
 */
const pg = require('pg');
const { Pool } = pg;
const bcrypt = require('bcryptjs');

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
const NO_ID_TABLE_RE = /\binto\s+(?:settings|maintenance_visit_engineers|task_dependencies|task_custom_values|user_project_pins)\b/i;

// ── SQL translation (SQLite → Postgres), memoized per unique SQL string ──────
const _cache = new Map();

function translate(sql) {
  const cached = _cache.get(sql);
  if (cached) return cached;

  let s = sql;
  const hadOrIgnore = /\bINSERT\s+OR\s+IGNORE\b/i.test(s);

  // Date/time: timestamps are stored as 'YYYY-MM-DD HH:MM:SS' text.
  s = s.replace(/datetime\(\s*'now'\s*\)/gi,
    "to_char((now() AT TIME ZONE 'UTC'),'YYYY-MM-DD HH24:MI:SS')");
  s = s.replace(/date\(\s*'now'\s*\)/gi,
    "to_char((now() AT TIME ZONE 'UTC'),'YYYY-MM-DD')");
  s = s.replace(/strftime\(\s*'%Y-%m-%d'\s*,\s*([^()]+?)\s*\)/gi, 'substr($1,1,10)');
  s = s.replace(/strftime\(\s*'%Y-%m'\s*,\s*([^()]+?)\s*\)/gi, 'substr($1,1,7)');
  // date(<col-expr>) — not date('now'), which was already replaced above.
  s = s.replace(/\bdate\(\s*([^'()][^()]*?)\s*\)/gi, 'substr($1,1,10)');

  // GROUP_CONCAT(expr, sep) → string_agg(expr, sep)
  s = s.replace(/\bGROUP_CONCAT\(/gi, 'string_agg(');

  // SQLite LIKE is case-insensitive for ASCII; Postgres LIKE is case-sensitive.
  // Use ILIKE so search keeps matching case-insensitively. (\bLIKE\b doesn't
  // match inside ILIKE, so this is safe and idempotent.)
  s = s.replace(/\bLIKE\b/g, 'ILIKE');

  // INSERT OR IGNORE → INSERT ... ON CONFLICT DO NOTHING
  s = s.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT INTO');
  if (hadOrIgnore && !/on\s+conflict/i.test(s)) s += ' ON CONFLICT DO NOTHING';

  // Positional placeholders ? → $1, $2, … (must run last)
  let n = 0;
  s = s.replace(/\?/g, () => `$${++n}`);

  _cache.set(sql, s);
  return s;
}

// Build the prepare()-style interface bound to a runner (pool or tx client).
function makeInterface(runner) {
  return {
    prepare(rawSql) {
      return {
        async get(...params) {
          const r = await runner.query(translate(rawSql), params);
          return r.rows[0];
        },
        async all(...params) {
          const r = await runner.query(translate(rawSql), params);
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
          const r = await runner.query(sql, params);
          return {
            lastInsertRowid: r.rows && r.rows[0] ? r.rows[0].id : undefined,
            changes: r.rowCount,
          };
        },
      };
    },
    async exec(rawSql) {
      // Multi-statement DDL/SQL — passed through untranslated (used for schema).
      return runner.query(rawSql);
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
const NOW = "to_char((now() AT TIME ZONE 'UTC'),'YYYY-MM-DD HH24:MI:SS')";

async function init() {
  // Add the round(double precision, int) overload Postgres lacks, so existing
  // ROUND(AVG(x), 1) / ROUND(SUM(x), 1) calls work unchanged.
  await pool.query(`
    CREATE OR REPLACE FUNCTION round(double precision, integer)
    RETURNS numeric AS $$ SELECT round($1::numeric, $2) $$ LANGUAGE sql IMMUTABLE;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id                   SERIAL PRIMARY KEY,
      name                 TEXT NOT NULL,
      email                TEXT UNIQUE,
      password             TEXT NOT NULL,
      role                 TEXT NOT NULL CHECK(role IN ('manager','engineer','planner','pm')),
      active               INTEGER NOT NULL DEFAULT 1,
      created_at           TEXT DEFAULT ${NOW},
      last_login           TEXT,
      avatar_url           TEXT,
      totp_secret          TEXT,
      totp_enabled         INTEGER NOT NULL DEFAULT 0,
      totp_exempt          INTEGER NOT NULL DEFAULT 0,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      password_changed_at  TEXT,
      ical_token_hash      TEXT,
      ical_token_created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS customers (
      id            SERIAL PRIMARY KEY,
      name          TEXT NOT NULL,
      contact_name  TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      address       TEXT,
      notes         TEXT,
      created_by    INTEGER REFERENCES users(id),
      created_at    TEXT DEFAULT ${NOW}
    );

    CREATE TABLE IF NOT EXISTS projects (
      id                    SERIAL PRIMARY KEY,
      title                 TEXT NOT NULL,
      description           TEXT,
      status                TEXT NOT NULL DEFAULT 'in_progress',
      priority              TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),
      deadline              TEXT,
      customer_id           INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      created_by            INTEGER NOT NULL REFERENCES users(id),
      closed_by             INTEGER REFERENCES users(id),
      closed_at             TEXT,
      created_at            TEXT DEFAULT ${NOW},
      updated_at            TEXT DEFAULT ${NOW},
      closure_requested_at  TEXT,
      pending_from_customer TEXT,
      completion_pct        INTEGER,
      rag_override          TEXT
    );

    CREATE TABLE IF NOT EXISTS project_assignments (
      id          SERIAL PRIMARY KEY,
      project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      assigned_at TEXT DEFAULT ${NOW},
      UNIQUE(project_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id          SERIAL PRIMARY KEY,
      project_id  INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      description TEXT,
      status      TEXT NOT NULL DEFAULT 'open',
      priority    TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),
      assigned_to INTEGER REFERENCES users(id),
      created_by  INTEGER NOT NULL REFERENCES users(id),
      deadline    TEXT,
      is_adhoc    INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT DEFAULT ${NOW},
      updated_at  TEXT DEFAULT ${NOW},
      pending_from_customer TEXT
    );

    CREATE TABLE IF NOT EXISTS project_status_updates (
      id         SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      message    TEXT NOT NULL,
      created_at TEXT DEFAULT ${NOW}
    );

    CREATE TABLE IF NOT EXISTS kpis (
      id            SERIAL PRIMARY KEY,
      project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      target_value  REAL NOT NULL,
      current_value REAL NOT NULL DEFAULT 0,
      unit          TEXT,
      updated_by    INTEGER REFERENCES users(id),
      updated_at    TEXT DEFAULT ${NOW}
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id            SERIAL PRIMARY KEY,
      project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      stored_name   TEXT NOT NULL,
      mime_type     TEXT,
      size          INTEGER,
      uploaded_by   INTEGER NOT NULL REFERENCES users(id),
      created_at    TEXT DEFAULT ${NOW},
      enc_iv        TEXT,
      enc_tag       TEXT
    );

    CREATE TABLE IF NOT EXISTS maintenance_visits (
      id                         SERIAL PRIMARY KEY,
      customer_id                INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      title                      TEXT NOT NULL,
      description                TEXT,
      scheduled_date             TEXT NOT NULL,
      engineer_id                INTEGER REFERENCES users(id),
      status                     TEXT NOT NULL DEFAULT 'scheduled',
      report_sent                INTEGER NOT NULL DEFAULT 0,
      report_sent_at             TEXT,
      report_sent_by             INTEGER REFERENCES users(id),
      notes                      TEXT,
      created_by                 INTEGER NOT NULL REFERENCES users(id),
      created_at                 TEXT DEFAULT ${NOW},
      updated_at                 TEXT DEFAULT ${NOW},
      report_sent_to_customer    INTEGER NOT NULL DEFAULT 0,
      report_sent_to_customer_at TEXT,
      report_sent_to_customer_by INTEGER REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS maintenance_visit_engineers (
      visit_id INTEGER NOT NULL REFERENCES maintenance_visits(id) ON DELETE CASCADE,
      user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (visit_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_comments (
      id         SERIAL PRIMARY KEY,
      task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      message    TEXT NOT NULL,
      created_at TEXT DEFAULT ${NOW}
    );

    CREATE TABLE IF NOT EXISTS project_activity (
      id         SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      action     TEXT NOT NULL,
      detail     TEXT,
      created_at TEXT DEFAULT ${NOW}
    );

    CREATE TABLE IF NOT EXISTS project_scorecards (
      id           SERIAL PRIMARY KEY,
      project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      engineer_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      evaluated_by INTEGER NOT NULL REFERENCES users(id),
      timeline_rating         REAL NOT NULL CHECK(timeline_rating       BETWEEN 1 AND 5),
      delivery_quality        REAL NOT NULL CHECK(delivery_quality      BETWEEN 1 AND 5),
      communication_ownership REAL NOT NULL CHECK(communication_ownership BETWEEN 1 AND 5),
      documentation_quality   REAL NOT NULL CHECK(documentation_quality BETWEEN 1 AND 5),
      customer_feedback       REAL NOT NULL CHECK(customer_feedback     BETWEEN 1 AND 5),
      difficulty   INTEGER NOT NULL DEFAULT 3 CHECK(difficulty BETWEEN 1 AND 5),
      base_score     REAL NOT NULL,
      adjusted_score REAL NOT NULL,
      notes      TEXT,
      created_at TEXT DEFAULT ${NOW},
      updated_at TEXT DEFAULT ${NOW},
      UNIQUE(project_id, engineer_id)
    );

    CREATE TABLE IF NOT EXISTS time_logs (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      task_id     INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
      visit_id    INTEGER REFERENCES maintenance_visits(id) ON DELETE CASCADE,
      hours       REAL NOT NULL,
      description TEXT,
      logged_at   TEXT DEFAULT ${NOW}
    );

    CREATE TABLE IF NOT EXISTS personal_notes (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      content    TEXT NOT NULL DEFAULT '',
      updated_at TEXT DEFAULT ${NOW}
    );

    CREATE TABLE IF NOT EXISTS personal_todos (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      done        INTEGER NOT NULL DEFAULT 0,
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT DEFAULT ${NOW}
    );

    CREATE TABLE IF NOT EXISTS task_dependencies (
      task_id       INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      depends_on_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      PRIMARY KEY (task_id, depends_on_id)
    );

    CREATE TABLE IF NOT EXISTS project_templates (
      id          SERIAL PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT,
      created_by  INTEGER REFERENCES users(id),
      created_at  TEXT DEFAULT ${NOW}
    );

    CREATE TABLE IF NOT EXISTS project_template_tasks (
      id          SERIAL PRIMARY KEY,
      template_id INTEGER NOT NULL REFERENCES project_templates(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      description TEXT,
      priority    TEXT NOT NULL DEFAULT 'medium',
      order_index INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type       TEXT NOT NULL,
      title      TEXT NOT NULL,
      body       TEXT,
      link       TEXT,
      read       INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT ${NOW}
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used       INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT ${NOW}
    );

    CREATE TABLE IF NOT EXISTS project_milestones (
      id           SERIAL PRIMARY KEY,
      project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title        TEXT NOT NULL,
      description  TEXT,
      due_date     TEXT,
      completed_at TEXT,
      completed_by INTEGER REFERENCES users(id),
      created_by   INTEGER NOT NULL REFERENCES users(id),
      created_at   TEXT DEFAULT ${NOW},
      updated_at   TEXT DEFAULT ${NOW}
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id           SERIAL PRIMARY KEY,
      user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      user_name    TEXT NOT NULL DEFAULT '',
      user_role    TEXT,
      entity_type  TEXT NOT NULL,
      entity_id    INTEGER,
      entity_title TEXT,
      action       TEXT NOT NULL,
      detail       TEXT,
      ip_address   TEXT,
      created_at   TEXT DEFAULT ${NOW}
    );

    CREATE TABLE IF NOT EXISTS user_project_pins (
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      pinned_at  TEXT DEFAULT ${NOW},
      PRIMARY KEY (user_id, project_id)
    );

    CREATE TABLE IF NOT EXISTS project_custom_fields (
      id         SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      field_type TEXT NOT NULL DEFAULT 'text',
      options    TEXT,
      required   INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT ${NOW}
    );

    CREATE TABLE IF NOT EXISTS task_custom_values (
      task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      field_id INTEGER NOT NULL REFERENCES project_custom_fields(id) ON DELETE CASCADE,
      value    TEXT,
      PRIMARY KEY (task_id, field_id)
    );
  `);

  // Indexes (mirror the SQLite set)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_tasks_project_id        ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to       ON tasks(assigned_to);
    CREATE INDEX IF NOT EXISTS idx_tasks_status            ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_pa_project_id           ON project_assignments(project_id);
    CREATE INDEX IF NOT EXISTS idx_pa_user_id              ON project_assignments(user_id);
    CREATE INDEX IF NOT EXISTS idx_mve_visit_id            ON maintenance_visit_engineers(visit_id);
    CREATE INDEX IF NOT EXISTS idx_mve_user_id             ON maintenance_visit_engineers(user_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_id   ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_project_activity_proj   ON project_activity(project_id);
    CREATE INDEX IF NOT EXISTS idx_mv_customer_id          ON maintenance_visits(customer_id);
    CREATE INDEX IF NOT EXISTS idx_mv_status               ON maintenance_visits(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_updated_at        ON tasks(updated_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_deadline          ON tasks(deadline);
    CREATE INDEX IF NOT EXISTS idx_time_logs_task_id       ON time_logs(task_id);
    CREATE INDEX IF NOT EXISTS idx_time_logs_visit_id      ON time_logs(visit_id);
    CREATE INDEX IF NOT EXISTS idx_time_logs_user_id       ON time_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read);
    CREATE INDEX IF NOT EXISTS idx_project_activity_at     ON project_activity(created_at);
    CREATE INDEX IF NOT EXISTS idx_mv_scheduled_date       ON maintenance_visits(scheduled_date);
    CREATE INDEX IF NOT EXISTS idx_scorecards_engineer     ON project_scorecards(engineer_id);
    CREATE INDEX IF NOT EXISTS idx_scorecards_project      ON project_scorecards(project_id);
    CREATE INDEX IF NOT EXISTS idx_prt_token               ON password_reset_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_prt_user                ON password_reset_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_pcf_project_id          ON project_custom_fields(project_id);
    CREATE INDEX IF NOT EXISTS idx_tcv_task_id             ON task_custom_values(task_id);
    CREATE INDEX IF NOT EXISTS idx_upp_user_id             ON user_project_pins(user_id);
    CREATE INDEX IF NOT EXISTS idx_users_ical_token        ON users(ical_token_hash);
  `);

  await seedStatusConfig();
  await seedAdmin();
}

async function seedStatusConfig() {
  const { rows } = await pool.query("SELECT 1 FROM settings WHERE key = 'status_config'");
  if (rows.length) return;
  const defaultConfig = JSON.stringify({
    project: [
      { value: 'not_started',        label: 'Not Started',                 bg: '#f1f5f9', text: '#475569', dot: '#94a3b8', requires_reason: false, is_terminal: false },
      { value: 'in_progress',        label: 'In Progress',                 bg: '#fef9c3', text: '#854d0e', dot: '#eab308', requires_reason: false, is_terminal: false },
      { value: 'waiting_customer',   label: 'Waiting for Customer',        bg: '#fff7ed', text: '#9a3412', dot: '#f97316', requires_reason: true,  is_terminal: false },
      { value: 'waiting_vendor',     label: 'Waiting for Vendor',          bg: '#faf5ff', text: '#6b21a8', dot: '#a855f7', requires_reason: true,  is_terminal: false },
      { value: 'on_hold',            label: 'On Hold',                     bg: '#f1f5f9', text: '#475569', dot: '#94a3b8', requires_reason: false, is_terminal: false },
      { value: 'delayed',            label: 'Delayed',                     bg: '#fee2e2', text: '#991b1b', dot: '#f87171', requires_reason: false, is_terminal: false },
      { value: 'completed_engineer', label: 'Completed by Engineer',       bg: '#dcfce7', text: '#166534', dot: '#22c55e', requires_reason: false, is_terminal: false },
      { value: 'pending_approval',   label: 'Pending Management Approval', bg: '#fef3c7', text: '#92400e', dot: '#f59e0b', requires_reason: false, is_terminal: false },
      { value: 'closed',             label: 'Closed',                      bg: '#d1fae5', text: '#065f46', dot: '#10b981', requires_reason: false, is_terminal: true  },
      { value: 'reopened',           label: 'Reopened',                    bg: '#dbeafe', text: '#1d4ed8', dot: '#3b82f6', requires_reason: false, is_terminal: false },
      { value: 'cancelled',          label: 'Cancelled',                   bg: '#fee2e2', text: '#991b1b', dot: '#ef4444', requires_reason: false, is_terminal: true  },
    ],
    task: [
      { value: 'open',             label: 'Open',                bg: '#eff6ff', text: '#1e40af', dot: '#3b82f6', requires_reason: false, is_terminal: false },
      { value: 'in_progress',      label: 'In Progress',         bg: '#fef9c3', text: '#854d0e', dot: '#eab308', requires_reason: false, is_terminal: false },
      { value: 'waiting_customer', label: 'Waiting for Customer',bg: '#fff7ed', text: '#9a3412', dot: '#f97316', requires_reason: true,  is_terminal: false },
      { value: 'waiting_vendor',   label: 'Waiting for Vendor',  bg: '#faf5ff', text: '#6b21a8', dot: '#a855f7', requires_reason: true,  is_terminal: false },
      { value: 'completed',        label: 'Completed',           bg: '#dcfce7', text: '#166534', dot: '#22c55e', requires_reason: false, is_terminal: false },
      { value: 'pending_approval', label: 'Pending Approval',    bg: '#fef3c7', text: '#92400e', dot: '#f59e0b', requires_reason: false, is_terminal: false },
      { value: 'closed',           label: 'Closed',              bg: '#d1fae5', text: '#065f46', dot: '#10b981', requires_reason: false, is_terminal: true  },
      { value: 'cancelled',        label: 'Cancelled',           bg: '#fee2e2', text: '#991b1b', dot: '#ef4444', requires_reason: false, is_terminal: true  },
    ],
    visit: [
      { value: 'scheduled',  label: 'Scheduled',  bg: '#eff6ff', text: '#1e40af', dot: '#3b82f6', requires_reason: false, is_terminal: false },
      { value: 'in_progress',label: 'In Progress',bg: '#fef9c3', text: '#854d0e', dot: '#eab308', requires_reason: false, is_terminal: false },
      { value: 'completed',  label: 'Completed',  bg: '#dcfce7', text: '#166534', dot: '#22c55e', requires_reason: false, is_terminal: false },
      { value: 'cancelled',  label: 'Cancelled',  bg: '#fee2e2', text: '#991b1b', dot: '#ef4444', requires_reason: false, is_terminal: true  },
    ],
  });
  await pool.query(
    "INSERT INTO settings (key, value) VALUES ('status_config', $1) ON CONFLICT (key) DO NOTHING",
    [defaultConfig]
  );
}

async function seedAdmin() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM users');
  if (rows[0].c > 0) return;
  const crypto = require('crypto');
  const generatedPassword = process.env.ADMIN_PASSWORD ||
    crypto.randomBytes(12).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
  const hash = bcrypt.hashSync(generatedPassword, 12);
  await pool.query(
    "INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4)",
    ['Admin Manager', 'admin@company.com', hash, 'manager']
  );
  console.log('═══════════════════════════════════════════════════════');
  console.log('  First-run admin account created:');
  console.log('    Email:    admin@company.com');
  console.log(`    Password: ${generatedPassword} (shown once — change immediately)`);
  console.log('  CHANGE THIS PASSWORD IMMEDIATELY after first login!');
  console.log('═══════════════════════════════════════════════════════');
}

module.exports = {
  prepare: poolApi.prepare,
  exec: poolApi.exec,
  transaction,
  init,
  pool,
  _translate: translate, // exported for tests
};
