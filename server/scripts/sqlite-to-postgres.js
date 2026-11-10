/**
 * One-time data migration: copy all rows from the legacy SQLite database
 * (better-sqlite3) into PostgreSQL, preserving primary-key ids, then reset the
 * SERIAL sequences. Encrypted PII columns are copied verbatim (the cipher is
 * DB-agnostic), so no re-encryption is needed.
 *
 * Usage (from the server/ directory), with DATABASE_URL pointing at the target
 * Postgres and the legacy file available:
 *
 *   node scripts/sqlite-to-postgres.js [path/to/app.db]      # default ./app.db
 *
 * Safe to re-run: every insert uses ON CONFLICT DO NOTHING. The Postgres schema
 * is created first via db.init() if it doesn't exist yet.
 *
 * better-sqlite3 is a devDependency used only by this script — run it from a
 * full (non --omit=dev) install, not the slim production image.
 */
const fs = require('fs');
const path = require('path');

// Load .env so DATABASE_URL (and CUSTOMER_FIELD_KEY, though unused here) resolve.
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  });
}

const Database = require('better-sqlite3');
const db = require('../db'); // pg facade + pool + init()

// FK-safe insertion order (parents before children).
const TABLE_ORDER = [
  'users', 'customers', 'projects', 'project_assignments', 'tasks',
  'project_status_updates', 'kpis', 'attachments', 'maintenance_visits',
  'maintenance_visit_engineers', 'settings', 'task_comments', 'project_activity',
  'project_scorecards', 'time_logs', 'personal_notes', 'personal_todos',
  'task_dependencies', 'project_templates', 'project_template_tasks',
  'notifications', 'password_reset_tokens', 'project_milestones', 'audit_log',
  'user_project_pins', 'project_custom_fields', 'task_custom_values',
];

async function pgColumns(table) {
  const { rows } = await db.pool.query(
    'SELECT column_name FROM information_schema.columns WHERE table_name = $1', [table]
  );
  return new Set(rows.map(r => r.column_name));
}

async function main() {
  const sqlitePath = process.argv[2] || path.join(__dirname, '..', 'app.db');
  if (!fs.existsSync(sqlitePath)) {
    console.error(`SQLite file not found: ${sqlitePath}`);
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set — aborting.');
    process.exit(1);
  }

  console.log(`Source : ${sqlitePath}`);
  console.log(`Target : ${process.env.DATABASE_URL.replace(/:\/\/[^@]*@/, '://***@')}`);

  await db.init();
  console.log('[pg] schema ready');

  const sqlite = new Database(sqlitePath, { readonly: true });
  const sqliteTables = new Set(
    sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
  );

  let grandTotal = 0;
  for (const table of TABLE_ORDER) {
    if (!sqliteTables.has(table)) { console.log(`- ${table}: (not in source, skipped)`); continue; }

    const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
    if (!rows.length) { console.log(`- ${table}: 0 rows`); continue; }

    // Only copy columns that exist in both schemas.
    const pgCols = await pgColumns(table);
    const cols = Object.keys(rows[0]).filter(c => pgCols.has(c));
    const colList = cols.map(c => `"${c}"`).join(', ');
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `INSERT INTO ${table} (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;

    let inserted = 0;
    for (const row of rows) {
      const r = await db.pool.query(sql, cols.map(c => row[c]));
      inserted += r.rowCount;
    }
    console.log(`- ${table}: ${inserted}/${rows.length} inserted`);
    grandTotal += inserted;

    // Reset the id sequence so future inserts don't collide with copied ids.
    if (cols.includes('id')) {
      await db.pool.query(
        `SELECT setval(pg_get_serial_sequence($1, 'id'),
                       GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${table}), 1),
                       (SELECT COUNT(*) FROM ${table}) > 0)`,
        [table]
      );
    }
  }

  sqlite.close();
  console.log(`\nDone. ${grandTotal} row(s) migrated.`);
  await db.pool.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error('Migration failed:', e.message);
  try { await db.pool.end(); } catch (_) {}
  process.exit(1);
});
