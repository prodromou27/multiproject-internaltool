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
const NO_ID_TABLE_RE = /\binto\s+(?:settings|maintenance_visit_engineers|maintenance_visit_assets|task_dependencies|task_custom_values|user_project_pins|team_members|customer_teams|customer_engineers|managed_customer_configurations|service_activity_technologies|service_activity_assets|saved_custom_report_users|saved_custom_report_teams)\b/i;

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
const RECOMMENDATIONS_SCHEMA = `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_customer_pair ON maintenance_visits(customer_id,id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_project_customer_pair ON projects(customer_id,id);
  CREATE TABLE IF NOT EXISTS customer_recommendations (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    source_visit_id INTEGER,
    finding TEXT NOT NULL,
    recommendation TEXT NOT NULL,
    risk_level TEXT NOT NULL DEFAULT 'medium' CHECK(risk_level IN ('low','medium','high','critical')),
    owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    due_date TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','accepted','rejected','in_progress','implemented','deferred','converted_to_project','closed')),
    follow_up_notes TEXT,
    related_project_id INTEGER,
    version INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT DEFAULT ${NOW},
    updated_at TEXT DEFAULT ${NOW},
    FOREIGN KEY(customer_id,source_visit_id) REFERENCES maintenance_visits(customer_id,id) ON DELETE RESTRICT,
    FOREIGN KEY(customer_id,related_project_id) REFERENCES projects(customer_id,id) ON DELETE RESTRICT
  );
  CREATE INDEX IF NOT EXISTS idx_recommendation_customer ON customer_recommendations(customer_id,created_at,id);
  CREATE TABLE IF NOT EXISTS recommendation_history (
    id SERIAL PRIMARY KEY,
    recommendation_id INTEGER NOT NULL REFERENCES customer_recommendations(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    version INTEGER NOT NULL,
    created_at TEXT DEFAULT ${NOW}
  );
  CREATE INDEX IF NOT EXISTS idx_recommendation_history ON recommendation_history(recommendation_id,id);
`;
const CUSTOMER_ASSETS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS customer_assets (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    technology_id INTEGER REFERENCES technologies(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    asset_tag TEXT,
    asset_tag_hash TEXT,
    asset_type TEXT NOT NULL,
    vendor TEXT,
    model TEXT,
    serial_number TEXT,
    hostname TEXT,
    ip_address TEXT,
    mac_address TEXT,
    software_version TEXT,
    location TEXT,
    environment TEXT NOT NULL DEFAULT 'production' CHECK(environment IN ('production','test','development','dr','other')),
    criticality TEXT NOT NULL DEFAULT 'medium' CHECK(criticality IN ('low','medium','high','critical')),
    lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK(lifecycle_status IN ('active','spare','retired','decommissioned')),
    coverage_type TEXT NOT NULL DEFAULT 'neither' CHECK(coverage_type IN ('managed','support','neither')),
    support_provider TEXT,
    support_reference TEXT,
    support_start_date TEXT,
    support_end_date TEXT,
    warranty_expiry_date TEXT,
    management_url TEXT,
    notes TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER NOT NULL REFERENCES users(id),
    updated_by INTEGER REFERENCES users(id),
    created_at TEXT DEFAULT ${NOW},
    updated_at TEXT DEFAULT ${NOW}
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_asset_tag ON customer_assets(customer_id,asset_tag_hash) WHERE asset_tag_hash IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_customer_asset_list ON customer_assets(customer_id,lifecycle_status,coverage_type,id);
  CREATE TABLE IF NOT EXISTS customer_asset_history (
    id SERIAL PRIMARY KEY,
    asset_id INTEGER,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL CHECK(action IN ('created','updated','deleted')),
    lifecycle_status TEXT NOT NULL,
    coverage_type TEXT NOT NULL,
    version INTEGER NOT NULL,
    created_at TEXT DEFAULT ${NOW}
  );
  CREATE INDEX IF NOT EXISTS idx_customer_asset_history ON customer_asset_history(customer_id,created_at,id);
`;

async function init() {
  // Add the round(double precision, int) overload Postgres lacks, so existing
  // ROUND(AVG(x), 1) / ROUND(SUM(x), 1) calls work unchanged.
  await pool.query(`
    CREATE OR REPLACE FUNCTION round(double precision, integer)
    RETURNS numeric AS $$ SELECT round($1::numeric, $2) $$ LANGUAGE sql IMMUTABLE;
  `);

  // "Now" and "today" as the text the app stores (UTC). Used in route SQL.
  await pool.query(`
    CREATE OR REPLACE FUNCTION app_now() RETURNS text AS $$
      SELECT to_char((now() AT TIME ZONE 'UTC'),'YYYY-MM-DD HH24:MI:SS') $$ LANGUAGE sql STABLE;
  `);
  await pool.query(`
    CREATE OR REPLACE FUNCTION app_today() RETURNS text AS $$
      SELECT to_char((now() AT TIME ZONE 'UTC'),'YYYY-MM-DD') $$ LANGUAGE sql STABLE;
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
      ical_token_created_at TEXT,
      token_version        INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS customers (
      id                             SERIAL PRIMARY KEY,
      name                           TEXT NOT NULL,
      contact_name                   TEXT,
      contact_email                  TEXT,
      contact_phone                  TEXT,
      address                        TEXT,
      notes                          TEXT,
      created_by                     INTEGER REFERENCES users(id),
      created_at                     TEXT DEFAULT ${NOW},
      customer_code                  TEXT,
      active                         INTEGER NOT NULL DEFAULT 1,
      service_activity_enabled       INTEGER NOT NULL DEFAULT 0,
      primary_contact                TEXT,
      location                       TEXT,
      contract_type                  TEXT,
      contract_start_date            TEXT,
      contract_end_date              TEXT,
      reporting_frequency            TEXT,
      included_hours                 REAL,
      contract_hour_period           TEXT CHECK(contract_hour_period IN ('monthly','annual')),
      service_notes                  TEXT,
      require_duration                INTEGER NOT NULL DEFAULT 0,
      require_ticket_reference        INTEGER NOT NULL DEFAULT 0,
      require_technology              INTEGER NOT NULL DEFAULT 0,
      require_category                INTEGER NOT NULL DEFAULT 0,
      require_notes                   INTEGER NOT NULL DEFAULT 0,
      require_billable_classification INTEGER NOT NULL DEFAULT 0
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
      closure_requested_by  INTEGER REFERENCES users(id),
      closure_request_version INTEGER NOT NULL DEFAULT 0,
      closure_reviewed_by   INTEGER REFERENCES users(id),
      closure_reviewed_at   TEXT,
      closure_review_comment TEXT,
      closure_decision      TEXT,
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
      project_id    INTEGER REFERENCES projects(id) ON DELETE CASCADE,
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

    -- ── Service Activity Tracking (MSP Operations Log) ──────────────────────
    CREATE TABLE IF NOT EXISTS teams (
      id                        SERIAL PRIMARY KEY,
      name                      TEXT NOT NULL UNIQUE,
      description               TEXT,
      service_activity_enabled  INTEGER NOT NULL DEFAULT 0,
      created_at                TEXT DEFAULT ${NOW}
    );

    CREATE TABLE IF NOT EXISTS team_members (
      team_id     INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      added_at    TEXT DEFAULT ${NOW},
      PRIMARY KEY (team_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS customer_teams (
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      team_id     INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      PRIMARY KEY (customer_id, team_id)
    );

    CREATE TABLE IF NOT EXISTS customer_engineers (
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (customer_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS activity_categories (
      id                 SERIAL PRIMARY KEY,
      name               TEXT NOT NULL UNIQUE,
      active             INTEGER NOT NULL DEFAULT 1,
      sort_order         INTEGER NOT NULL DEFAULT 0,
      require_attachment INTEGER NOT NULL DEFAULT 0,
      created_at         TEXT DEFAULT ${NOW}
    );

    CREATE TABLE IF NOT EXISTS activity_subcategories (
      id          SERIAL PRIMARY KEY,
      category_id INTEGER NOT NULL REFERENCES activity_categories(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      active      INTEGER NOT NULL DEFAULT 1,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT DEFAULT ${NOW},
      UNIQUE(category_id, name)
    );

    CREATE TABLE IF NOT EXISTS technologies (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      active     INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT ${NOW}
    );

    CREATE TABLE IF NOT EXISTS service_activity_sequences (
      year INTEGER PRIMARY KEY,
      last_value INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS service_activities (
      id                          SERIAL PRIMARY KEY,
      activity_reference          TEXT NOT NULL UNIQUE,
      customer_id                 INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
      team_id                     INTEGER NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
      engineer_id                 INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      activity_date               TEXT NOT NULL,
      start_time                  TEXT,
      end_time                    TEXT,
      duration_minutes            INTEGER,
      category_id                 INTEGER NOT NULL REFERENCES activity_categories(id) ON DELETE RESTRICT,
      subcategory_id              INTEGER REFERENCES activity_subcategories(id) ON DELETE SET NULL,
      title                       TEXT NOT NULL,
      description                 TEXT,
      status                      TEXT NOT NULL DEFAULT 'planned',
      priority                    TEXT CHECK(priority IN ('low','medium','high','critical')),
      work_location               TEXT CHECK(work_location IN ('remote','onsite','internal','hybrid')),
      customer_impact             TEXT,
      ticket_reference            TEXT,
      external_case_reference     TEXT,
      billable_classification     TEXT CHECK(billable_classification IN ('included_in_contract','billable','non_billable','internal','not_applicable')),
      billable_minutes            INTEGER,
      follow_up_required          INTEGER NOT NULL DEFAULT 0,
      follow_up_date              TEXT,
      related_project_id          INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      related_task_id             INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      related_visit_id            INTEGER REFERENCES maintenance_visits(id) ON DELETE SET NULL,
      follow_up_task_id            INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      change_type                 TEXT,
      change_reason               TEXT,
      previous_state               TEXT,
      new_state                   TEXT,
      change_risk                 TEXT,
      rollback_available           INTEGER,
      customer_approval_reference TEXT,
      verified_by                 INTEGER REFERENCES users(id),
      verification_notes          TEXT,
      created_by                  INTEGER NOT NULL REFERENCES users(id),
      created_at                  TEXT DEFAULT ${NOW},
      updated_by                  INTEGER REFERENCES users(id),
      updated_at                  TEXT DEFAULT ${NOW},
      completed_at                TEXT,
      version                     INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS service_activity_technologies (
      service_activity_id INTEGER NOT NULL REFERENCES service_activities(id) ON DELETE CASCADE,
      technology_id        INTEGER NOT NULL REFERENCES technologies(id) ON DELETE CASCADE,
      PRIMARY KEY (service_activity_id, technology_id)
    );

    -- Added here (not on the attachments CREATE TABLE above) because attachments
    -- is defined earlier in this file, before service_activities exists.
    ALTER TABLE attachments ADD COLUMN IF NOT EXISTS service_activity_id INTEGER REFERENCES service_activities(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS idx_attachments_activity ON attachments(service_activity_id);
  `);

  await applyCompatibilityMigrations();

  // Indexes (mirror the SQLite set)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_projects_approval_backlog ON projects(status, closure_requested_at, id);
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

    CREATE INDEX IF NOT EXISTS idx_sa_customer_date        ON service_activities(customer_id, activity_date);
    CREATE INDEX IF NOT EXISTS idx_sa_engineer_date         ON service_activities(engineer_id, activity_date);
    CREATE INDEX IF NOT EXISTS idx_sa_team_date             ON service_activities(team_id, activity_date);
    CREATE INDEX IF NOT EXISTS idx_sa_category              ON service_activities(category_id);
    CREATE INDEX IF NOT EXISTS idx_sa_status                ON service_activities(status);
    CREATE INDEX IF NOT EXISTS idx_sa_reference             ON service_activities(activity_reference);
    CREATE INDEX IF NOT EXISTS idx_sat_technology           ON service_activity_technologies(technology_id);
    CREATE INDEX IF NOT EXISTS idx_team_members_user        ON team_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_customer_teams_team      ON customer_teams(team_id);
    CREATE INDEX IF NOT EXISTS idx_customer_engineers_user  ON customer_engineers(user_id);
  `);

  await seedStatusConfig();
  await seedAdmin();
  await seedServiceActivityLookups();
}

async function applyCompatibilityMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         TEXT PRIMARY KEY,
      applied_at TEXT DEFAULT ${NOW}
    );
  `);

  const migrations = [
    ['20260619_compat_columns', `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_exempt INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS ical_token_hash TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS ical_token_created_at TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

      ALTER TABLE projects ADD COLUMN IF NOT EXISTS closure_requested_at TEXT;
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS pending_from_customer TEXT;
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS completion_pct INTEGER;
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS rag_override TEXT;

      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_adhoc INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS pending_from_customer TEXT;

      ALTER TABLE attachments ADD COLUMN IF NOT EXISTS enc_iv TEXT;
      ALTER TABLE attachments ADD COLUMN IF NOT EXISTS enc_tag TEXT;

      ALTER TABLE maintenance_visits ADD COLUMN IF NOT EXISTS report_sent_to_customer INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE maintenance_visits ADD COLUMN IF NOT EXISTS report_sent_to_customer_at TEXT;
      ALTER TABLE maintenance_visits ADD COLUMN IF NOT EXISTS report_sent_to_customer_by INTEGER REFERENCES users(id);
    `],
    ['20260619_token_version', `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
    `],
    ['20260916_service_activity_tracking', `
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_code TEXT;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS active INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS service_activity_enabled INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS primary_contact TEXT;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS location TEXT;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS contract_type TEXT;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS contract_start_date TEXT;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS contract_end_date TEXT;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS reporting_frequency TEXT;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS included_hours REAL;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS contract_hour_period TEXT;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS service_notes TEXT;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS require_duration INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS require_ticket_reference INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS require_technology INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS require_category INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS require_notes INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS require_billable_classification INTEGER NOT NULL DEFAULT 0;

      ALTER TABLE attachments ALTER COLUMN project_id DROP NOT NULL;
    `],
    ['20260916_activity_category_attachment_rule', `
      ALTER TABLE activity_categories ADD COLUMN IF NOT EXISTS require_attachment INTEGER NOT NULL DEFAULT 0;
    `],
    ['20260916_activity_follow_up_task', `
      ALTER TABLE service_activities ADD COLUMN IF NOT EXISTS follow_up_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL;
      UPDATE service_activities SET follow_up_task_id = related_task_id, related_task_id = NULL
      WHERE id IN (
        SELECT sa.id FROM service_activities sa JOIN audit_log a ON a.entity_id = sa.id
        WHERE a.entity_type = 'service_activity' AND a.action = 'follow_up_task_created'
          AND a.detail = 'task_id=' || CAST(sa.related_task_id AS TEXT)
      );
    `],
  ];

  migrations.push(['20260917_activity_version', 'ALTER TABLE service_activities ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1']);
  migrations.push(['20260918_customer_recommendations', RECOMMENDATIONS_SCHEMA]);
  migrations.push(['20260918_workload_planning_inputs', `
    CREATE TABLE IF NOT EXISTS workload_estimates (
      id SERIAL PRIMARY KEY,
      task_id INTEGER UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
      visit_id INTEGER UNIQUE REFERENCES maintenance_visits(id) ON DELETE CASCADE,
      remaining_hours REAL NOT NULL CHECK(remaining_hours>=0 AND remaining_hours<=10000),
      version INTEGER NOT NULL DEFAULT 1,
      updated_by INTEGER REFERENCES users(id),
      updated_at TEXT DEFAULT ${NOW},
      CHECK((task_id IS NOT NULL AND visit_id IS NULL) OR (task_id IS NULL AND visit_id IS NOT NULL))
    );
    CREATE TABLE IF NOT EXISTS workload_availability (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      week_start TEXT NOT NULL,
      available_hours REAL NOT NULL CHECK(available_hours>=0 AND available_hours<=168),
      version INTEGER NOT NULL DEFAULT 1,
      updated_by INTEGER REFERENCES users(id),
      updated_at TEXT DEFAULT ${NOW},
      UNIQUE(user_id,week_start)
    );
  `]);
  migrations.push(['20260918_saved_custom_reports', `
    CREATE TABLE IF NOT EXISTS saved_custom_reports (
      id SERIAL PRIMARY KEY,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','shared','management')),
      definition TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT ${NOW},
      updated_at TEXT DEFAULT ${NOW}
    );
    CREATE INDEX IF NOT EXISTS idx_saved_report_owner ON saved_custom_reports(owner_id,updated_at,id);
    CREATE INDEX IF NOT EXISTS idx_saved_report_visibility ON saved_custom_reports(visibility,updated_at,id);
  `]);

  migrations.push(['20260918_custom_report_schedules', `
    CREATE TABLE IF NOT EXISTS custom_report_schedules (
      report_id INTEGER PRIMARY KEY REFERENCES saved_custom_reports(id) ON DELETE CASCADE,
      frequency TEXT NOT NULL CHECK(frequency IN ('daily','weekly','monthly')),
      day INTEGER NOT NULL,
      hour INTEGER NOT NULL CHECK(hour>=0 AND hour<=23),
      minute INTEGER NOT NULL CHECK(minute>=0 AND minute<=59),
      recipient_ids TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1,
      next_run TEXT,
      last_run TEXT,
      last_status TEXT,
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_custom_report_schedule_due ON custom_report_schedules(enabled,next_run);
  `]);

  migrations.push(['20260918_workload_policy', `
    CREATE TABLE IF NOT EXISTS workload_policy (
      id INTEGER PRIMARY KEY CHECK(id=1),
      configuration TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at TEXT DEFAULT ${NOW}
    );
  `]);
  migrations.push(['20260921_customer_assets', CUSTOMER_ASSETS_SCHEMA]);
  migrations.push(['20260921_recommendation_tasks', `
    ALTER TABLE customer_recommendations ADD COLUMN IF NOT EXISTS related_task_id INTEGER REFERENCES tasks(id) ON DELETE RESTRICT;
    CREATE INDEX IF NOT EXISTS idx_recommendation_task ON customer_recommendations(related_task_id);
  `]);
  migrations.push(['20260921_custom_report_sharing', `
    ALTER TABLE saved_custom_reports DROP CONSTRAINT IF EXISTS saved_custom_reports_visibility_check;
    ALTER TABLE saved_custom_reports ADD CONSTRAINT saved_custom_reports_visibility_check CHECK(visibility IN ('private','shared','management'));
    CREATE TABLE IF NOT EXISTS saved_custom_report_users (
      report_id INTEGER NOT NULL REFERENCES saved_custom_reports(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY(report_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS saved_custom_report_teams (
      report_id INTEGER NOT NULL REFERENCES saved_custom_reports(id) ON DELETE CASCADE,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      PRIMARY KEY(report_id,team_id)
    );
    CREATE INDEX IF NOT EXISTS idx_saved_report_user_access ON saved_custom_report_users(user_id,report_id);
    CREATE INDEX IF NOT EXISTS idx_saved_report_team_access ON saved_custom_report_teams(team_id,report_id);
  `]);
  migrations.push(['20260921_service_activity_assets', `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_service_activity_customer_pair ON service_activities(customer_id,id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_asset_customer_pair ON customer_assets(customer_id,id);
    CREATE TABLE IF NOT EXISTS service_activity_assets (
      service_activity_id INTEGER NOT NULL,
      asset_id INTEGER NOT NULL,
      customer_id INTEGER NOT NULL,
      PRIMARY KEY(service_activity_id,asset_id),
      FOREIGN KEY(customer_id,service_activity_id) REFERENCES service_activities(customer_id,id) ON DELETE CASCADE,
      FOREIGN KEY(customer_id,asset_id) REFERENCES customer_assets(customer_id,id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_service_activity_asset_history ON service_activity_assets(asset_id,service_activity_id);
  `]);
  migrations.push(['20260921_maintenance_visit_assets', `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_maintenance_visit_customer_pair ON maintenance_visits(customer_id,id);
    CREATE TABLE IF NOT EXISTS maintenance_visit_assets (
      visit_id INTEGER NOT NULL,
      asset_id INTEGER NOT NULL,
      customer_id INTEGER NOT NULL,
      PRIMARY KEY(visit_id,asset_id),
      FOREIGN KEY(customer_id,visit_id) REFERENCES maintenance_visits(customer_id,id) ON DELETE CASCADE,
      FOREIGN KEY(customer_id,asset_id) REFERENCES customer_assets(customer_id,id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_maintenance_visit_asset_history ON maintenance_visit_assets(asset_id,visit_id);
  `]);
  migrations.push(['20260921_customer_asset_attachments', `
    ALTER TABLE attachments ADD COLUMN IF NOT EXISTS customer_asset_id INTEGER REFERENCES customer_assets(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS idx_attachments_customer_asset ON attachments(customer_asset_id,created_at DESC);
  `]);
  migrations.push(['20260921_managed_customer_configuration', `
    CREATE TABLE IF NOT EXISTS managed_customer_configurations (
      customer_id INTEGER PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
      managed_services_enabled INTEGER NOT NULL DEFAULT 0,
      task_reporting_enabled INTEGER NOT NULL DEFAULT 1,
      project_reporting_enabled INTEGER NOT NULL DEFAULT 1,
      maintenance_visit_reporting_enabled INTEGER NOT NULL DEFAULT 1,
      recommendation_tracking_enabled INTEGER NOT NULL DEFAULT 1,
      include_in_managed_services_reports INTEGER NOT NULL DEFAULT 1,
      responsible_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      service_manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reporting_frequency TEXT,
      default_report_template_id INTEGER,
      version INTEGER NOT NULL DEFAULT 1,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT DEFAULT ${NOW},
      updated_at TEXT DEFAULT ${NOW}
    );
    CREATE TABLE IF NOT EXISTS customer_ticketing_configurations (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
      provider_type TEXT NOT NULL DEFAULT 'request_tracker' CHECK(provider_type IN ('request_tracker')),
      external_queue_id TEXT NOT NULL,
      external_queue_name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      include_in_reporting INTEGER NOT NULL DEFAULT 1,
      last_successful_sync_at TEXT,
      last_sync_status TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT ${NOW},
      updated_at TEXT DEFAULT ${NOW},
      UNIQUE(provider_type,external_queue_id)
    );
    CREATE INDEX IF NOT EXISTS idx_managed_customer_enabled ON managed_customer_configurations(managed_services_enabled,customer_id);
    CREATE INDEX IF NOT EXISTS idx_customer_ticketing_enabled ON customer_ticketing_configurations(enabled,customer_id);
  `]);

  migrations.push(['20260917_project_closure_review', `
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS closure_requested_by INTEGER REFERENCES users(id);
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS closure_request_version INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS closure_reviewed_by INTEGER REFERENCES users(id);
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS closure_reviewed_at TEXT;
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS closure_review_comment TEXT;
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS closure_decision TEXT;
  `]);

  for (const [id, sql] of migrations) {
    const { rows } = await pool.query('SELECT 1 FROM schema_migrations WHERE id = $1', [id]);
    if (rows.length) continue;
    await transaction(async (tx) => {
      await tx.exec(sql);
      await tx.prepare('INSERT INTO schema_migrations (id) VALUES (?)').run(id);
    });
  }
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
    service_activity: [
      { value: 'planned',          label: 'Planned',              bg: '#eff6ff', text: '#1e40af', dot: '#3b82f6', requires_reason: false, is_terminal: false },
      { value: 'in_progress',      label: 'In Progress',          bg: '#fef9c3', text: '#854d0e', dot: '#eab308', requires_reason: false, is_terminal: false },
      { value: 'waiting_customer', label: 'Waiting for Customer', bg: '#fff7ed', text: '#9a3412', dot: '#f97316', requires_reason: true,  is_terminal: false },
      { value: 'waiting_vendor',   label: 'Waiting for Vendor',   bg: '#faf5ff', text: '#6b21a8', dot: '#a855f7', requires_reason: true,  is_terminal: false },
      { value: 'completed',        label: 'Completed',            bg: '#dcfce7', text: '#166534', dot: '#22c55e', requires_reason: false, is_terminal: true  },
      { value: 'cancelled',        label: 'Cancelled',            bg: '#fee2e2', text: '#991b1b', dot: '#ef4444', requires_reason: false, is_terminal: true  },
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
  // Bootstrap credentials apply only when the users table is empty. Force a
  // secure password replacement immediately after the first login.
  const generatedPassword = process.env.ADMIN_PASSWORD || 'admin';
  const hash = bcrypt.hashSync(generatedPassword, 12);
  await pool.query(
    "INSERT INTO users (name, email, password, role, must_change_password) VALUES ($1, $2, $3, $4, 1)",
    ['Admin Manager', 'admin@company.com', hash, 'manager']
  );
  console.log('═══════════════════════════════════════════════════════');
  console.log('  First-run admin account created:');
  console.log('    Username: admin');
  console.log('    Email:    admin@company.com');
  console.log(`    Password: ${generatedPassword} (shown once — change immediately)`);
  console.log('  CHANGE THIS PASSWORD IMMEDIATELY after first login!');
  console.log('═══════════════════════════════════════════════════════');
}

const DEFAULT_ACTIVITY_CATEGORIES = [
  'Support', 'Incident Resolution', 'Troubleshooting', 'Maintenance', 'Preventive Maintenance',
  'Upgrade', 'Patch / Firmware Update', 'Configuration Change', 'Security Change',
  'Review / Health Check', 'Monitoring', 'Backup / Restore', 'User Administration',
  'Documentation', 'Customer Meeting', 'Vendor Coordination', 'Change Implementation',
  'Testing / Validation', 'Investigation', 'Advisory / Consultation',
  'Internal Operational Work', 'Other',
];

const DEFAULT_TECHNOLOGIES = [
  'Firewall', 'Network', 'Microsoft 365', 'Intune', 'WAF', 'PAM', 'Microsegmentation',
  'Endpoint Security', 'Email Security', 'Load Balancer', 'Backup', 'Vulnerability Management',
];

async function seedServiceActivityLookups() {
  const { rows: catRows } = await pool.query('SELECT COUNT(*)::int AS c FROM activity_categories');
  if (catRows[0].c === 0) {
    for (let i = 0; i < DEFAULT_ACTIVITY_CATEGORIES.length; i++) {
      await pool.query(
        'INSERT INTO activity_categories (name, sort_order) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
        [DEFAULT_ACTIVITY_CATEGORIES[i], i]
      );
    }
  }

  const { rows: techRows } = await pool.query('SELECT COUNT(*)::int AS c FROM technologies');
  if (techRows[0].c === 0) {
    for (let i = 0; i < DEFAULT_TECHNOLOGIES.length; i++) {
      await pool.query(
        'INSERT INTO technologies (name, sort_order) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
        [DEFAULT_TECHNOLOGIES[i], i]
      );
    }
  }

  const { rows: settingsRows } = await pool.query("SELECT 1 FROM settings WHERE key = 'service_activity_settings'");
  if (!settingsRows.length) {
    await pool.query(
      "INSERT INTO settings (key, value) VALUES ('service_activity_settings', $1) ON CONFLICT (key) DO NOTHING",
      [JSON.stringify({ retention_days: null, allow_attachments: true, allow_follow_up_task_creation: true })]
    );
  }

  // Patch pre-existing status_config rows (created before this module existed)
  // so the service_activity status group is always present.
  const { rows: statusRows } = await pool.query("SELECT value FROM settings WHERE key = 'status_config'");
  if (statusRows.length) {
    try {
      const config = JSON.parse(statusRows[0].value);
      if (!Array.isArray(config.service_activity)) {
        config.service_activity = [
          { value: 'planned',          label: 'Planned',              bg: '#eff6ff', text: '#1e40af', dot: '#3b82f6', requires_reason: false, is_terminal: false },
          { value: 'in_progress',      label: 'In Progress',          bg: '#fef9c3', text: '#854d0e', dot: '#eab308', requires_reason: false, is_terminal: false },
          { value: 'waiting_customer', label: 'Waiting for Customer', bg: '#fff7ed', text: '#9a3412', dot: '#f97316', requires_reason: true,  is_terminal: false },
          { value: 'waiting_vendor',   label: 'Waiting for Vendor',   bg: '#faf5ff', text: '#6b21a8', dot: '#a855f7', requires_reason: true,  is_terminal: false },
          { value: 'completed',        label: 'Completed',            bg: '#dcfce7', text: '#166534', dot: '#22c55e', requires_reason: false, is_terminal: true  },
          { value: 'cancelled',        label: 'Cancelled',            bg: '#fee2e2', text: '#991b1b', dot: '#ef4444', requires_reason: false, is_terminal: true  },
        ];
        await pool.query("UPDATE settings SET value = $1 WHERE key = 'status_config'", [JSON.stringify(config)]);
      }
    } catch (_) { /* leave as-is if unparsable */ }
  }
}

module.exports = {
  prepare: poolApi.prepare,
  exec: poolApi.exec,
  transaction,
  init,
  pool,
  _translate: translate, // exported for tests
};
