/**
 * First-run seed data: default statuses, the bootstrap admin, activity lookups.
 * (Extracted verbatim from db.js — see db.js for the connection layer.)
 */
const bcrypt = require('bcryptjs');

async function seedStatusConfig(pool) {
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

async function seedAdmin(pool) {
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

async function seedServiceActivityLookups(pool) {
  // Seeded as global (team_id NULL) categories, visible to every team. No ON CONFLICT
  // needed: this only runs once, when the table is confirmed empty, and the names in
  // DEFAULT_ACTIVITY_CATEGORIES are distinct — unlike `technologies` below, category
  // names are no longer globally unique (they're unique per team_id; see db.js's
  // activity_categories comment), so there is no longer a single constraint an
  // ON CONFLICT (name) clause could target.
  const { rows: catRows } = await pool.query('SELECT COUNT(*)::int AS c FROM activity_categories');
  if (catRows[0].c === 0) {
    for (let i = 0; i < DEFAULT_ACTIVITY_CATEGORIES.length; i++) {
      await pool.query(
        'INSERT INTO activity_categories (name, sort_order) VALUES ($1, $2)',
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

async function runSeeds(pool) {
  await seedStatusConfig(pool);
  await seedAdmin(pool);
  await seedServiceActivityLookups(pool);
}

module.exports = { runSeeds };
