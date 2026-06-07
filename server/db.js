const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const db = new Database(path.join(__dirname, 'app.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('manager', 'engineer')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    last_login TEXT
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'on_hold', 'pending_closure', 'closed')),
    priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high')),
    deadline TEXT,
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    created_by INTEGER NOT NULL REFERENCES users(id),
    closed_by INTEGER REFERENCES users(id),
    closed_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS project_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_at TEXT DEFAULT (datetime('now')),
    UNIQUE(project_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'in_progress', 'done', 'cancelled')),
    priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high')),
    assigned_to INTEGER REFERENCES users(id),
    created_by INTEGER NOT NULL REFERENCES users(id),
    deadline TEXT,
    is_adhoc INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS project_status_updates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    message TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS kpis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    target_value REAL NOT NULL,
    current_value REAL NOT NULL DEFAULT 0,
    unit TEXT,
    updated_by INTEGER REFERENCES users(id),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime_type TEXT,
    size INTEGER,
    uploaded_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    contact_name TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    address TEXT,
    notes TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS maintenance_visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    scheduled_date TEXT NOT NULL,
    engineer_id INTEGER REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
    report_sent INTEGER NOT NULL DEFAULT 0,
    report_sent_at TEXT,
    report_sent_by INTEGER REFERENCES users(id),
    notes TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
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
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id  INTEGER NOT NULL REFERENCES users(id),
    message  TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS project_activity (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    action     TEXT NOT NULL,
    detail     TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS project_scorecards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id   INTEGER NOT NULL REFERENCES projects(id)  ON DELETE CASCADE,
    engineer_id  INTEGER NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
    evaluated_by INTEGER NOT NULL REFERENCES users(id),

    -- Five dimensions, each 1–5
    timeline_rating       REAL NOT NULL CHECK(timeline_rating       BETWEEN 1 AND 5),
    delivery_quality      REAL NOT NULL CHECK(delivery_quality      BETWEEN 1 AND 5),
    communication_ownership REAL NOT NULL CHECK(communication_ownership BETWEEN 1 AND 5),
    documentation_quality REAL NOT NULL CHECK(documentation_quality BETWEEN 1 AND 5),
    customer_feedback     REAL NOT NULL CHECK(customer_feedback     BETWEEN 1 AND 5),

    -- Project complexity
    difficulty INTEGER NOT NULL DEFAULT 3 CHECK(difficulty BETWEEN 1 AND 5),

    -- Computed and stored for fast queries
    base_score     REAL NOT NULL,   -- weighted average as 0-100
    adjusted_score REAL NOT NULL,   -- after difficulty multiplier, capped at 100

    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),

    UNIQUE(project_id, engineer_id)  -- one scorecard per engineer per project
  );
`);

// Migrate: add columns if they don't exist yet (safe on fresh DBs too)
const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!userCols.includes('active'))     db.exec("ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
if (!userCols.includes('last_login')) db.exec("ALTER TABLE users ADD COLUMN last_login TEXT");

// Migrate: projects.customer_id
const projCols = db.prepare("PRAGMA table_info(projects)").all().map(c => c.name);
if (!projCols.includes('customer_id')) db.exec("ALTER TABLE projects ADD COLUMN customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL");

// Migrate: maintenance_visit_engineers — copy existing engineer_id rows into junction table
const mvEngExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='maintenance_visit_engineers'").get();
if (mvEngExists) {
  const toMigrate = db.prepare("SELECT id, engineer_id FROM maintenance_visits WHERE engineer_id IS NOT NULL").all();
  const ins = db.prepare("INSERT OR IGNORE INTO maintenance_visit_engineers (visit_id, user_id) VALUES (?, ?)");
  const migrate = db.transaction(() => toMigrate.forEach(v => ins.run(v.id, v.engineer_id)));
  migrate();
}

// Migrate: projects — add closure_requested_at column
const projColsV2 = db.prepare("PRAGMA table_info(projects)").all().map(c => c.name);
if (!projColsV2.includes('closure_requested_at'))
  db.exec("ALTER TABLE projects ADD COLUMN closure_requested_at TEXT");

// Migrate: maintenance_visits — add report_sent_to_customer columns
const mvCols = db.prepare("PRAGMA table_info(maintenance_visits)").all().map(c => c.name);
if (!mvCols.includes('report_sent_to_customer'))
  db.exec("ALTER TABLE maintenance_visits ADD COLUMN report_sent_to_customer INTEGER NOT NULL DEFAULT 0");
if (!mvCols.includes('report_sent_to_customer_at'))
  db.exec("ALTER TABLE maintenance_visits ADD COLUMN report_sent_to_customer_at TEXT");
if (!mvCols.includes('report_sent_to_customer_by'))
  db.exec("ALTER TABLE maintenance_visits ADD COLUMN report_sent_to_customer_by INTEGER REFERENCES users(id)");

// Migrate: users — extend role CHECK to include 'planner'
const usersDDL = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
if (usersDDL && !usersDDL.sql.includes("'planner'")) {
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`CREATE TABLE users_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('manager', 'engineer', 'planner')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      last_login TEXT
    )`);
    db.exec(`INSERT INTO users_new SELECT id, name, email, password, role, active, created_at, last_login FROM users`);
    db.exec(`DROP TABLE users`);
    db.exec(`ALTER TABLE users_new RENAME TO users`);
  })();
  db.pragma('foreign_keys = ON');
}

// Migrate: users — extend role CHECK to include 'pm'
const usersDDL2 = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
if (usersDDL2 && !usersDDL2.sql.includes("'pm'")) {
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`CREATE TABLE users_new2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('manager', 'engineer', 'planner', 'pm')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      last_login TEXT
    )`);
    db.exec(`INSERT INTO users_new2 SELECT id, name, email, password, role, active, created_at, last_login FROM users`);
    db.exec(`DROP TABLE users`);
    db.exec(`ALTER TABLE users_new2 RENAME TO users`);
  })();
  db.pragma('foreign_keys = ON');
}

// Time tracking, personal notes, personal todos
db.exec(`
  CREATE TABLE IF NOT EXISTS time_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id     INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    visit_id    INTEGER REFERENCES maintenance_visits(id) ON DELETE CASCADE,
    hours       REAL NOT NULL,
    description TEXT,
    logged_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS personal_notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    content    TEXT NOT NULL DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS personal_todos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    done        INTEGER NOT NULL DEFAULT 0,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now'))
  );
`);

// Task dependencies + project templates
db.exec(`
  CREATE TABLE IF NOT EXISTS task_dependencies (
    task_id       INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    depends_on_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, depends_on_id)
  );

  CREATE TABLE IF NOT EXISTS project_templates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    description TEXT,
    created_by  INTEGER REFERENCES users(id),
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS project_template_tasks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id  INTEGER NOT NULL REFERENCES project_templates(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    description  TEXT,
    priority     TEXT NOT NULL DEFAULT 'medium',
    order_index  INTEGER NOT NULL DEFAULT 0
  );
`);

// Migrate: notifications table
db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,
    title      TEXT NOT NULL,
    body       TEXT,
    link       TEXT,
    read       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Migrate: users — add avatar_url column
const userColNames = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!userColNames.includes('avatar_url')) {
  db.exec("ALTER TABLE users ADD COLUMN avatar_url TEXT");
}

// Check status_migration_v1 early so older migrations can skip if it already ran
const smV1Early = db.prepare("SELECT value FROM settings WHERE key='status_migration_v1'").get();

// Migrate: projects — add 'waiting_customer' status + pending_from_customer column
const projectsDDL = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='projects'").get();
if (!smV1Early && projectsDDL && !projectsDDL.sql.includes("'waiting_customer'")) {
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`CREATE TABLE projects_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','on_hold','pending_closure','closed','waiting_customer')),
      priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),
      deadline TEXT,
      customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      created_by INTEGER NOT NULL REFERENCES users(id),
      closed_by INTEGER REFERENCES users(id),
      closed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      closure_requested_at TEXT,
      pending_from_customer TEXT
    )`);
    db.exec(`INSERT INTO projects_new
      (id,title,description,status,priority,deadline,customer_id,created_by,
       closed_by,closed_at,created_at,updated_at,closure_requested_at)
      SELECT id,title,description,status,priority,deadline,customer_id,created_by,
       closed_by,closed_at,created_at,updated_at,closure_requested_at
      FROM projects`);
    db.exec(`DROP TABLE projects`);
    db.exec(`ALTER TABLE projects_new RENAME TO projects`);
  })();
  db.pragma('foreign_keys = ON');
} else {
  // Table already has waiting_customer — just ensure pending_from_customer column exists
  const pfc = db.prepare("PRAGMA table_info(projects)").all().map(c => c.name);
  if (!pfc.includes('pending_from_customer'))
    db.exec("ALTER TABLE projects ADD COLUMN pending_from_customer TEXT");
}

// Migrate: tasks — add 'waiting_customer' status + pending_from_customer column
const tasksDDL = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'").get();
if (!smV1Early && tasksDDL && !tasksDDL.sql.includes("'waiting_customer'")) {
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`CREATE TABLE tasks_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','done','cancelled','waiting_customer')),
      priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),
      assigned_to INTEGER REFERENCES users(id),
      created_by INTEGER NOT NULL REFERENCES users(id),
      deadline TEXT,
      is_adhoc INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      pending_from_customer TEXT
    )`);
    db.exec(`INSERT INTO tasks_new
      (id,project_id,title,description,status,priority,assigned_to,
       created_by,deadline,is_adhoc,created_at,updated_at)
      SELECT id,project_id,title,description,status,priority,assigned_to,
       created_by,deadline,is_adhoc,created_at,updated_at
      FROM tasks`);
    db.exec(`DROP TABLE tasks`);
    db.exec(`ALTER TABLE tasks_new RENAME TO tasks`);
  })();
  db.pragma('foreign_keys = ON');
} else {
  const tfc = db.prepare("PRAGMA table_info(tasks)").all().map(c => c.name);
  if (!tfc.includes('pending_from_customer'))
    db.exec("ALTER TABLE tasks ADD COLUMN pending_from_customer TEXT");
}

// ── Status Management migration ─────────────────────────────────────────────
// Removes CHECK constraints from status columns, adds completion_pct to projects,
// migrates old status values (active→in_progress, pending_closure→pending_approval,
// done→completed for tasks), seeds default status_config in settings.
const smDone = db.prepare("SELECT value FROM settings WHERE key='status_migration_v1'").get();
if (!smDone) {
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    // 1. Recreate projects: no CHECK on status, add completion_pct
    db.exec(`CREATE TABLE projects_sm (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      title                TEXT NOT NULL,
      description          TEXT,
      status               TEXT NOT NULL DEFAULT 'in_progress',
      priority             TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),
      deadline             TEXT,
      customer_id          INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      created_by           INTEGER NOT NULL REFERENCES users(id),
      closed_by            INTEGER REFERENCES users(id),
      closed_at            TEXT,
      created_at           TEXT DEFAULT (datetime('now')),
      updated_at           TEXT DEFAULT (datetime('now')),
      closure_requested_at TEXT,
      pending_from_customer TEXT,
      completion_pct       INTEGER
    )`);
    db.exec(`INSERT INTO projects_sm
      (id,title,description,status,priority,deadline,customer_id,created_by,
       closed_by,closed_at,created_at,updated_at,closure_requested_at,pending_from_customer)
      SELECT id,title,description,
        CASE status
          WHEN 'active'          THEN 'in_progress'
          WHEN 'pending_closure' THEN 'pending_approval'
          ELSE status
        END,
        priority,deadline,customer_id,created_by,
        closed_by,closed_at,created_at,updated_at,closure_requested_at,pending_from_customer
      FROM projects`);
    db.exec(`DROP TABLE projects`);
    db.exec(`ALTER TABLE projects_sm RENAME TO projects`);

    // 2. Recreate tasks: no CHECK on status, done→completed
    db.exec(`CREATE TABLE tasks_sm (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id  INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      description TEXT,
      status      TEXT NOT NULL DEFAULT 'open',
      priority    TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),
      assigned_to INTEGER REFERENCES users(id),
      created_by  INTEGER NOT NULL REFERENCES users(id),
      deadline    TEXT,
      is_adhoc    INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now')),
      pending_from_customer TEXT
    )`);
    db.exec(`INSERT INTO tasks_sm
      (id,project_id,title,description,status,priority,assigned_to,
       created_by,deadline,is_adhoc,created_at,updated_at,pending_from_customer)
      SELECT id,project_id,title,description,
        CASE status WHEN 'done' THEN 'completed' ELSE status END,
        priority,assigned_to,created_by,deadline,is_adhoc,created_at,updated_at,pending_from_customer
      FROM tasks`);
    db.exec(`DROP TABLE tasks`);
    db.exec(`ALTER TABLE tasks_sm RENAME TO tasks`);

    // 3. Recreate maintenance_visits: no CHECK on status
    db.exec(`CREATE TABLE maintenance_visits_sm (
      id                         INTEGER PRIMARY KEY AUTOINCREMENT,
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
      created_at                 TEXT DEFAULT (datetime('now')),
      updated_at                 TEXT DEFAULT (datetime('now')),
      report_sent_to_customer    INTEGER NOT NULL DEFAULT 0,
      report_sent_to_customer_at TEXT,
      report_sent_to_customer_by INTEGER REFERENCES users(id)
    )`);
    db.exec(`INSERT INTO maintenance_visits_sm
      (id,customer_id,title,description,scheduled_date,engineer_id,status,
       report_sent,report_sent_at,report_sent_by,notes,created_by,created_at,updated_at,
       report_sent_to_customer,report_sent_to_customer_at,report_sent_to_customer_by)
      SELECT id,customer_id,title,description,scheduled_date,engineer_id,status,
       report_sent,report_sent_at,report_sent_by,notes,created_by,created_at,updated_at,
       report_sent_to_customer,report_sent_to_customer_at,report_sent_to_customer_by
      FROM maintenance_visits`);
    db.exec(`DROP TABLE maintenance_visits`);
    db.exec(`ALTER TABLE maintenance_visits_sm RENAME TO maintenance_visits`);

    // 4. Mark migration done & seed default status config
    db.exec(`INSERT OR REPLACE INTO settings (key,value) VALUES ('status_migration_v1','1')`);

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
    db.exec(`INSERT OR IGNORE INTO settings (key,value) VALUES ('status_config','${defaultConfig.replace(/'/g, "''")}')`);
  })();
  db.pragma('foreign_keys = ON');
} else {
  // Already migrated — ensure completion_pct column exists (safe on fresh DBs too)
  const projC = db.prepare("PRAGMA table_info(projects)").all().map(c => c.name);
  if (!projC.includes('completion_pct'))
    db.exec("ALTER TABLE projects ADD COLUMN completion_pct INTEGER");
}

// Seed default manager account if no users exist
const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get();
if (userCount.c === 0) {
  // Generate a random secure password instead of a hardcoded default
  const crypto = require('crypto');
  const generatedPassword = process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
  const hash = bcrypt.hashSync(generatedPassword, 12);
  db.prepare(`INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)`)
    .run('Admin Manager', 'admin@company.com', hash, 'manager');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  First-run admin account created:');
  console.log('    Email:    admin@company.com');
  console.log(`    Password: ${generatedPassword.slice(0, 3)}${'*'.repeat(generatedPassword.length - 3)} (shown once — change immediately)`);
  console.log('  CHANGE THIS PASSWORD IMMEDIATELY after first login!');
  console.log('═══════════════════════════════════════════════════════');
}

// ── New feature tables ────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS project_milestones (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    description  TEXT,
    due_date     TEXT,
    completed_at TEXT,
    completed_by INTEGER REFERENCES users(id),
    created_by   INTEGER NOT NULL REFERENCES users(id),
    created_at   TEXT DEFAULT (datetime('now')),
    updated_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    user_name    TEXT NOT NULL DEFAULT '',
    user_role    TEXT,
    entity_type  TEXT NOT NULL,
    entity_id    INTEGER,
    entity_title TEXT,
    action       TEXT NOT NULL,
    detail       TEXT,
    ip_address   TEXT,
    created_at   TEXT DEFAULT (datetime('now'))
  );
`);

// Migrate: add rag_override to projects
const projCols2 = db.prepare("PRAGMA table_info(projects)").all().map(c => c.name);
if (!projCols2.includes('rag_override'))
  db.exec("ALTER TABLE projects ADD COLUMN rag_override TEXT");

// Migrate: users — add TOTP columns for 2FA
const userColsTotp = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!userColsTotp.includes('totp_secret'))           db.exec("ALTER TABLE users ADD COLUMN totp_secret TEXT");
if (!userColsTotp.includes('totp_enabled'))          db.exec("ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0");
if (!userColsTotp.includes('totp_exempt'))           db.exec("ALTER TABLE users ADD COLUMN totp_exempt INTEGER NOT NULL DEFAULT 0");
if (!userColsTotp.includes('must_change_password'))  db.exec("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0");
if (!userColsTotp.includes('password_changed_at'))   db.exec("ALTER TABLE users ADD COLUMN password_changed_at TEXT");
// Back-fill: treat created_at as password-set date for existing users
db.exec("UPDATE users SET password_changed_at = created_at WHERE password_changed_at IS NULL");

// Password-reset tokens (for self-service forgot-password flow)
db.exec(`
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_prt_token ON password_reset_tokens(token_hash);
  CREATE INDEX IF NOT EXISTS idx_prt_user  ON password_reset_tokens(user_id);
`);

// Attachment encryption columns
const attColNames = db.prepare("PRAGMA table_info(attachments)").all().map(c => c.name);
if (!attColNames.includes('enc_iv'))  db.exec("ALTER TABLE attachments ADD COLUMN enc_iv TEXT");
if (!attColNames.includes('enc_tag')) db.exec("ALTER TABLE attachments ADD COLUMN enc_tag TEXT");

// ── Performance indexes (safe to run on every startup — IF NOT EXISTS) ───────
db.exec(`
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
`);

// ── Feature tables: pinned projects, custom task fields ──────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS user_project_pins (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    pinned_at  TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, project_id)
  );

  CREATE TABLE IF NOT EXISTS project_custom_fields (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    field_type TEXT NOT NULL DEFAULT 'text',
    options    TEXT,
    required   INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS task_custom_values (
    task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    field_id INTEGER NOT NULL REFERENCES project_custom_fields(id) ON DELETE CASCADE,
    value    TEXT,
    PRIMARY KEY (task_id, field_id)
  );

  CREATE INDEX IF NOT EXISTS idx_pcf_project_id  ON project_custom_fields(project_id);
  CREATE INDEX IF NOT EXISTS idx_tcv_task_id      ON task_custom_values(task_id);
  CREATE INDEX IF NOT EXISTS idx_upp_user_id      ON user_project_pins(user_id);
`);

// Migrate: users — make email optional (remove NOT NULL constraint)
{
  const emailCol = db.prepare("PRAGMA table_info(users)").all().find(c => c.name === 'email');
  if (emailCol && emailCol.notnull === 1) {
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
      db.exec(`DROP TABLE IF EXISTS users_email_opt`);
      db.exec(`CREATE TABLE users_email_opt (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        name                 TEXT NOT NULL,
        email                TEXT UNIQUE,
        password             TEXT NOT NULL,
        role                 TEXT NOT NULL CHECK(role IN ('manager', 'engineer', 'planner', 'pm')),
        active               INTEGER NOT NULL DEFAULT 1,
        created_at           TEXT DEFAULT (datetime('now')),
        last_login           TEXT,
        avatar_url           TEXT,
        totp_secret          TEXT,
        totp_enabled         INTEGER NOT NULL DEFAULT 0,
        totp_exempt          INTEGER NOT NULL DEFAULT 0,
        must_change_password INTEGER NOT NULL DEFAULT 0,
        password_changed_at  TEXT
      )`);
      db.exec(`INSERT INTO users_email_opt
        (id, name, email, password, role, active, created_at, last_login,
         avatar_url, totp_secret, totp_enabled, totp_exempt, must_change_password, password_changed_at)
        SELECT id, name, email, password, role, active, created_at, last_login,
         avatar_url, totp_secret, totp_enabled, totp_exempt, must_change_password, password_changed_at
        FROM users`);
      db.exec(`DROP TABLE users`);
      db.exec(`ALTER TABLE users_email_opt RENAME TO users`);
    })();
    db.pragma('foreign_keys = ON');
  }
}

module.exports = db;
