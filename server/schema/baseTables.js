/**
 * Helper functions and the base (final-state) tables.
 * (Extracted verbatim from db.js — see db.js for the connection layer.)
 */
const { NOW } = require('./common');

async function createBaseTables(pool) {
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
      token_version        INTEGER NOT NULL DEFAULT 0,
      notify_external_enabled INTEGER NOT NULL DEFAULT 1,
      notify_teams_enabled INTEGER NOT NULL DEFAULT 0,
      notify_teams_webhook_url TEXT,
      notify_email_enabled INTEGER NOT NULL DEFAULT 0
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
    CREATE TABLE IF NOT EXISTS background_jobs (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed')),
      priority INTEGER NOT NULL DEFAULT 100,
      run_after TEXT NOT NULL DEFAULT ${NOW},
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      dedupe_key TEXT UNIQUE,
      locked_at TEXT,
      locked_by TEXT,
      started_at TEXT,
      completed_at TEXT,
      result TEXT,
      error TEXT,
      artifact_name TEXT,
      artifact_path TEXT,
      artifact_type TEXT,
      artifact_iv TEXT,
      artifact_tag TEXT,
      artifact_expires_at TEXT,
      artifact_downloaded_at TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT ${NOW}
    );
    CREATE INDEX IF NOT EXISTS idx_background_jobs_claim ON background_jobs(status,run_after,priority,id);
    CREATE INDEX IF NOT EXISTS idx_background_jobs_history ON background_jobs(created_at,id);

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
      managed_service_operations INTEGER NOT NULL DEFAULT 0,
      project_delivery_enabled   INTEGER NOT NULL DEFAULT 1,
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

    -- team_id NULL = shared/global category, visible to every team (the original,
    -- pre-team-scoping behavior). A non-null team_id scopes it to that team only.
    -- Name uniqueness is enforced in the app layer, scoped per team_id (see
    -- routes/activityCategories.js), not by a DB constraint — Postgres UNIQUE
    -- treats every NULL as distinct, so it can't express "unique per NULL group".
    CREATE TABLE IF NOT EXISTS activity_categories (
      id                 SERIAL PRIMARY KEY,
      name               TEXT NOT NULL,
      team_id            INTEGER REFERENCES teams(id) ON DELETE CASCADE,
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

}

module.exports = { createBaseTables };
