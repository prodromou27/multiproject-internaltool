/**
 * Ordered, recorded-once schema migrations.
 * (Extracted verbatim from db.js — see db.js for the connection layer.)
 */
const { NOW } = require('./common');

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

async function applyMigrations(pool, transaction) {
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
      write_back_enabled INTEGER NOT NULL DEFAULT 0,
      write_back_status TEXT,
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
  migrations.push(['20260921_external_ticket_sync', `
    CREATE TABLE IF NOT EXISTS external_tickets (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      provider_type TEXT NOT NULL DEFAULT 'request_tracker',
      external_queue_id TEXT NOT NULL,
      external_queue_name TEXT NOT NULL,
      external_ticket_id TEXT NOT NULL,
      ticket_number TEXT NOT NULL,
      subject TEXT NOT NULL,
      external_status TEXT NOT NULL,
      normalized_status TEXT NOT NULL,
      status_group TEXT NOT NULL CHECK(status_group IN ('open','closed')),
      external_priority TEXT,
      normalized_priority TEXT,
      owner_external_id TEXT,
      owner_name TEXT,
      category TEXT,
      subcategory TEXT,
      created_at_external TEXT,
      updated_at_external TEXT,
      resolved_at_external TEXT,
      closed_at_external TEXT,
      sla_due_at TEXT,
      sla_breached INTEGER NOT NULL DEFAULT 0,
      external_url TEXT,
      last_synced_at TEXT DEFAULT ${NOW},
      raw_metadata TEXT,
      UNIQUE(provider_type,external_ticket_id)
    );
    CREATE TABLE IF NOT EXISTS ticket_sync_runs (
      id SERIAL PRIMARY KEY,
      started_at TEXT DEFAULT ${NOW},
      completed_at TEXT,
      status TEXT NOT NULL CHECK(status IN ('running','success','failed')),
      customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      queue_id TEXT,
      tickets_found INTEGER NOT NULL DEFAULT 0,
      tickets_created INTEGER NOT NULL DEFAULT 0,
      tickets_updated INTEGER NOT NULL DEFAULT 0,
      errors INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      triggered_by INTEGER REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_external_ticket_customer_status ON external_tickets(customer_id,status_group,normalized_status);
    CREATE INDEX IF NOT EXISTS idx_external_ticket_period ON external_tickets(customer_id,created_at_external,resolved_at_external);
    CREATE INDEX IF NOT EXISTS idx_ticket_sync_run_customer ON ticket_sync_runs(customer_id,started_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_sync_one_running ON ticket_sync_runs(customer_id) WHERE status='running';
  `]);
  migrations.push(['20260922_managed_report_templates', `
    CREATE TABLE IF NOT EXISTS managed_report_templates (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      sections TEXT NOT NULL,
      default_narratives TEXT NOT NULL DEFAULT '{}',
      active INTEGER NOT NULL DEFAULT 1,
      version INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT DEFAULT ${NOW},
      updated_at TEXT DEFAULT ${NOW}
    );
    CREATE INDEX IF NOT EXISTS idx_managed_report_templates_active ON managed_report_templates(active,name);
    INSERT INTO managed_report_templates (name,description,sections,default_narratives,active)
      VALUES ('Monthly Managed Services Report','Monthly operational service review','["executive_summary","service_overview","ticket_summary","open_tickets","period_tickets","service_activities","tasks","projects","maintenance_visits","recommendations","upcoming_work"]','{}',1)
      ON CONFLICT (name) DO NOTHING;
    INSERT INTO managed_report_templates (name,description,sections,default_narratives,active)
      VALUES ('Support Services Report','Ticket-focused support performance report','["service_overview","ticket_summary","open_tickets","period_tickets","risks"]','{}',1)
      ON CONFLICT (name) DO NOTHING;
    INSERT INTO managed_report_templates (name,description,sections,default_narratives,active)
      VALUES ('Quarterly Service Review','Quarterly service improvement and delivery review','["executive_summary","service_overview","ticket_summary","service_activities","projects","maintenance_visits","recommendations","risks","upcoming_work"]','{}',1)
      ON CONFLICT (name) DO NOTHING;
  `]);
  migrations.push(['20260922_managed_report_history', `
    CREATE TABLE IF NOT EXISTS managed_report_version_counters (
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      output_format TEXT NOT NULL CHECK(output_format IN ('docx','xlsx','pdf')),
      last_version INTEGER NOT NULL,
      PRIMARY KEY(customer_id,period_start,period_end,output_format)
    );
    CREATE TABLE IF NOT EXISTS managed_report_history (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
      template_id INTEGER REFERENCES managed_report_templates(id) ON DELETE SET NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      output_format TEXT NOT NULL CHECK(output_format IN ('docx','xlsx','pdf')),
      report_version INTEGER NOT NULL CHECK(report_version > 0),
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','final')),
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL UNIQUE,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL CHECK(size >= 0),
      sections TEXT NOT NULL,
      generated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      generated_at TEXT DEFAULT ${NOW},
      enc_iv TEXT,
      enc_tag TEXT,
      UNIQUE(customer_id,period_start,period_end,output_format,report_version)
    );
    CREATE INDEX IF NOT EXISTS idx_managed_report_history_customer ON managed_report_history(customer_id,generated_at DESC,id DESC);
  `]);
  migrations.push(['20260922_permission_overrides', `
    CREATE TABLE IF NOT EXISTS role_permission_overrides (
      role TEXT NOT NULL CHECK(role IN ('manager','engineer','planner','pm')),
      permission_key TEXT NOT NULL,
      allowed INTEGER NOT NULL CHECK(allowed IN (0,1)),
      version INTEGER NOT NULL DEFAULT 1,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at TEXT DEFAULT ${NOW},
      PRIMARY KEY(role,permission_key)
    );
    CREATE TABLE IF NOT EXISTS user_permission_overrides (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      permission_key TEXT NOT NULL,
      allowed INTEGER NOT NULL CHECK(allowed IN (0,1)),
      version INTEGER NOT NULL DEFAULT 1,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at TEXT DEFAULT ${NOW},
      PRIMARY KEY(user_id,permission_key)
    );
    CREATE INDEX IF NOT EXISTS idx_user_permission_overrides_user ON user_permission_overrides(user_id);
  `]);
  migrations.push(['20260922_managed_report_workflow', `
    ALTER TABLE managed_report_history ADD COLUMN IF NOT EXISTS workflow_status TEXT NOT NULL DEFAULT 'draft' CHECK(workflow_status IN ('draft','in_review','approved','final'));
    ALTER TABLE managed_report_history ADD COLUMN IF NOT EXISTS workflow_version INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE managed_report_history ADD COLUMN IF NOT EXISTS submitted_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE managed_report_history ADD COLUMN IF NOT EXISTS submitted_at TEXT;
    ALTER TABLE managed_report_history ADD COLUMN IF NOT EXISTS reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE managed_report_history ADD COLUMN IF NOT EXISTS reviewed_at TEXT;
    ALTER TABLE managed_report_history ADD COLUMN IF NOT EXISTS finalized_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE managed_report_history ADD COLUMN IF NOT EXISTS finalized_at TEXT;
    ALTER TABLE managed_report_history ADD COLUMN IF NOT EXISTS decision_comment TEXT;
    UPDATE managed_report_history SET workflow_status='final' WHERE status='final';
    CREATE TABLE IF NOT EXISTS managed_report_workflow_history (
      id SERIAL PRIMARY KEY,
      report_id INTEGER NOT NULL REFERENCES managed_report_history(id) ON DELETE CASCADE,
      from_status TEXT,
      to_status TEXT NOT NULL CHECK(to_status IN ('draft','in_review','approved','final')),
      action TEXT NOT NULL CHECK(action IN ('generated','submitted','approved','rejected','finalized','reopened')),
      comment TEXT,
      actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      workflow_version INTEGER NOT NULL,
      created_at TEXT DEFAULT ${NOW}
    );
    CREATE INDEX IF NOT EXISTS idx_managed_report_workflow_history_report ON managed_report_workflow_history(report_id,created_at,id);
    INSERT INTO managed_report_workflow_history (report_id,from_status,to_status,action,actor_id,workflow_version,created_at)
      SELECT id,NULL,workflow_status,'generated',generated_by,workflow_version,generated_at FROM managed_report_history;
  `]);
  migrations.push(['20260922_managed_report_review_queue', `
    CREATE INDEX IF NOT EXISTS idx_managed_report_review_queue
      ON managed_report_history(workflow_status,submitted_at,id)
      WHERE workflow_status IN ('in_review','approved');
  `]);
  migrations.push(['20260922_notification_center', `
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('normal','high','critical'));
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TEXT;
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS acknowledged_at TEXT;
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dismissed_at TEXT;
    UPDATE notifications SET read_at=created_at WHERE read=1 AND read_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_notifications_center ON notifications(user_id,dismissed_at,created_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_action_required ON notifications(user_id,priority,acknowledged_at) WHERE dismissed_at IS NULL;
  `]);

  migrations.push(['20260917_project_closure_review', `
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS closure_requested_by INTEGER REFERENCES users(id);
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS closure_request_version INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS closure_reviewed_by INTEGER REFERENCES users(id);
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS closure_reviewed_at TEXT;
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS closure_review_comment TEXT;
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS closure_decision TEXT;
  `]);
  migrations.push(['20260923_team_activity_categories', `
    ALTER TABLE activity_categories DROP CONSTRAINT IF EXISTS activity_categories_name_key;
    ALTER TABLE activity_categories ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS idx_activity_categories_team ON activity_categories(team_id, sort_order, name);
  `]);
  migrations.push(['20260923_team_sla_targets', `
    -- One row per team; a team with no row uses the app-wide default targets
    -- (see routes/teams.js DEFAULT_SLA_TARGETS).
    CREATE TABLE IF NOT EXISTS team_sla_targets (
      team_id                  INTEGER PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
      response_hours           REAL NOT NULL DEFAULT 8,
      resolution_hours         REAL NOT NULL DEFAULT 48,
      updated_by                INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at                TEXT DEFAULT ${NOW}
    );
  `]);
  migrations.push(['20260923_ticket_writeback', `
    -- Opt-in, per customer: when set, completing a service activity whose
    -- ticket_reference matches one of this customer's synced RT tickets sets
    -- that ticket's Status to write_back_status. Off (0/NULL) by default —
    -- see ticketWriteback.js and routes/serviceActivities.js's /complete route.
    ALTER TABLE customer_ticketing_configurations ADD COLUMN IF NOT EXISTS write_back_enabled INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE customer_ticketing_configurations ADD COLUMN IF NOT EXISTS write_back_status TEXT;
  `]);

  migrations.push(['20260923_notification_preferences', `
    -- Per-user opt-out for direct chat notifications (currently: Webex direct
    -- messages). Defaults to 1 so existing behavior is unchanged for everyone
    -- until they turn it off themselves. Teams/Webex space posts go to a
    -- shared channel, not a specific person, so this only affects Webex
    -- "direct"/"both" mode DMs — see notifications.js.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_external_enabled INTEGER NOT NULL DEFAULT 1;
  `]);

  migrations.push(['20260923_team_workflow_capabilities', `
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS managed_service_operations INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS project_delivery_enabled INTEGER NOT NULL DEFAULT 1;
    UPDATE teams SET managed_service_operations=1,project_delivery_enabled=0
      WHERE service_activity_enabled=1 AND managed_service_operations=0;
  `]);

  migrations.push(['20260924_background_jobs', `
    -- The final-state schema above creates this table before compatibility
    -- migrations run. Keep this marker for deployed revision history; the
    -- artifact migration below remains additive for existing installations.
    SELECT 1;
  `]);

  migrations.push(['20260924_background_job_artifacts', `
    ALTER TABLE background_jobs ADD COLUMN IF NOT EXISTS artifact_name TEXT;
    ALTER TABLE background_jobs ADD COLUMN IF NOT EXISTS artifact_path TEXT;
    ALTER TABLE background_jobs ADD COLUMN IF NOT EXISTS artifact_type TEXT;
    ALTER TABLE background_jobs ADD COLUMN IF NOT EXISTS artifact_iv TEXT;
    ALTER TABLE background_jobs ADD COLUMN IF NOT EXISTS artifact_tag TEXT;
    ALTER TABLE background_jobs ADD COLUMN IF NOT EXISTS artifact_expires_at TEXT;
    ALTER TABLE background_jobs ADD COLUMN IF NOT EXISTS artifact_downloaded_at TEXT;
  `]);
  migrations.push(['20260924_customer_search_index', `
    CREATE TABLE IF NOT EXISTS customer_search_documents (
      customer_id INTEGER PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
      key_fingerprint TEXT NOT NULL,
      updated_at TEXT DEFAULT ${NOW}
    );
    CREATE TABLE IF NOT EXISTS customer_search_tokens (
      customer_id INTEGER NOT NULL REFERENCES customer_search_documents(customer_id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      PRIMARY KEY(customer_id,token_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_customer_search_token ON customer_search_tokens(token_hash,customer_id);
  `]);

  migrations.push(['20260924_kpi_administration', `
    CREATE TABLE IF NOT EXISTS kpi_definitions (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL,
      data_source TEXT NOT NULL CHECK(data_source IN ('manual','project_completion','task_completion','overdue_tasks','service_hours')),
      calculation_config TEXT NOT NULL DEFAULT '{}',
      target_value REAL NOT NULL,
      warning_threshold REAL NOT NULL,
      critical_threshold REAL NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('higher','lower')),
      scope_type TEXT NOT NULL CHECK(scope_type IN ('organization','team','project')),
      team_id INTEGER REFERENCES teams(id) ON DELETE RESTRICT,
      project_id INTEGER REFERENCES projects(id) ON DELETE RESTRICT,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
      display_order INTEGER NOT NULL DEFAULT 0,
      visualization_type TEXT NOT NULL DEFAULT 'number' CHECK(visualization_type IN ('number','gauge','progress','trend','bar')),
      version INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT DEFAULT ${NOW},
      updated_at TEXT DEFAULT ${NOW}
    );
    CREATE TABLE IF NOT EXISTS kpi_values (
      id SERIAL PRIMARY KEY,
      definition_id INTEGER NOT NULL REFERENCES kpi_definitions(id) ON DELETE CASCADE,
      value REAL NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('healthy','warning','critical')),
      period_start TEXT,
      period_end TEXT,
      calculated_at TEXT DEFAULT ${NOW},
      calculated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      source_summary TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_kpi_definitions_order ON kpi_definitions(enabled,display_order,id);
    CREATE INDEX IF NOT EXISTS idx_kpi_values_history ON kpi_values(definition_id,calculated_at DESC,id DESC);
  `]);

  migrations.push(['20260923_personal_notification_channels', `
    -- Each engineer can additionally point their own notifications at a
    -- personal Teams channel (an incoming-webhook URL they own — Teams has
    -- no per-user DM concept the way Webex does) and/or their own inbox
    -- (via the SMTP the admin already configured for reports). Both default
    -- off: unlike notify_external_enabled above, these are brand-new
    -- channels nobody has opted into yet, not an opt-out of something that
    -- already existed. See notifications.js.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_teams_enabled INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_teams_webhook_url TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_email_enabled INTEGER NOT NULL DEFAULT 0;
  `]);

  migrations.push(['20260924_upgrade_asset_tracking', `
    -- Which asset an activity worked on, and (optionally) the version it was left
    -- at. The category flag mirrors require_attachment: categories that describe
    -- changing a specific device can require that an asset be selected.
    ALTER TABLE service_activity_assets ADD COLUMN IF NOT EXISTS version TEXT;
    ALTER TABLE activity_categories ADD COLUMN IF NOT EXISTS require_asset INTEGER NOT NULL DEFAULT 0;
    UPDATE activity_categories SET require_asset = 1 WHERE name IN ('Upgrade', 'Patch / Firmware Update');
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

module.exports = { applyMigrations };
