/**
 * Secondary indexes, including the PostgreSQL trigram search indexes.
 * (Extracted verbatim from db.js — see db.js for the connection layer.)
 */
async function createIndexes(pool) {
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

  // PostgreSQL trigram indexes preserve the application's intentional substring
  // search semantics while avoiding sequential scans on the largest text lists.
  // pg-mem does not implement extensions. The integration harness uses this
  // sentinel URL while swapping in its own Pool implementation.
  const isPgMemTestDatabase = process.env.DATABASE_URL === 'postgres://fake:fake@localhost/fake';
  if (process.env.DATABASE_URL && !isPgMemTestDatabase) {
    try {
      await pool.query(`
        CREATE EXTENSION IF NOT EXISTS pg_trgm;
        CREATE INDEX IF NOT EXISTS idx_projects_title_trgm ON projects USING GIN (title gin_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_projects_description_trgm ON projects USING GIN (description gin_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_tasks_title_trgm ON tasks USING GIN (title gin_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_tasks_description_trgm ON tasks USING GIN (description gin_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_mv_title_trgm ON maintenance_visits USING GIN (title gin_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_mv_description_trgm ON maintenance_visits USING GIN (description gin_trgm_ops);
      `);
    } catch (error) {
      console.warn('[db] Could not create pg_trgm search indexes:',error.message);
    }
  }
}

module.exports = { createIndexes };
