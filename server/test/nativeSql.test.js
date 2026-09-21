/**
 * The SQL in this app is native PostgreSQL. This guards against SQLite-only syntax being
 * written back in: it would fail on a real database, and pg-mem or a quick read of the
 * code would not always show it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function sourceFiles() {
  const out = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) { if (!['node_modules', 'test', 'data', 'uploads'].includes(entry.name)) walk(path.join(dir, entry.name)); }
      else if (entry.name.endsWith('.js')) out.push(path.join(dir, entry.name));
    }
  })(root);
  return out;
}

// Lines that are only comments can describe the old syntax.
const codeLines = text => text.split('\n').map((line, i) => ({ line, number: i + 1 }))
  .filter(({ line }) => !/^\s*(\/\/|\*|\/\*)/.test(line));

const SQLITE_ONLY = [
  [/(?<![A-Za-z_])datetime\(/i, "datetime() - use app_now()"],
  [/\bdate\(\s*(\\?')/i, "date('now') - use app_today()"],
  [/strftime\(/i, 'strftime() - use substr(col, 1, 7) or substr(col, 1, 10)'],
  [/(?<![A-Za-z_.])date\(\s*[A-Za-z_]/, 'date(col) - use substr(col, 1, 10)'],
  [/\bGROUP_CONCAT\(/i, 'GROUP_CONCAT() - use string_agg()'],
  [/\bINSERT\s+OR\s+(IGNORE|REPLACE)\b/i, 'INSERT OR IGNORE/REPLACE - use ON CONFLICT'],
  [/(?<![A-Za-z_])LIKE(?=\s+\?)/, 'LIKE is case-sensitive in PostgreSQL - use ILIKE'],
];

test('server source contains no SQLite-only syntax', () => {
  const found = [];
  for (const file of sourceFiles()) {
    for (const { line, number } of codeLines(fs.readFileSync(file, 'utf8'))) {
      for (const [pattern, advice] of SQLITE_ONLY) {
        if (pattern.test(line)) found.push(`${path.relative(root, file).replace(/\\/g, '/')}:${number}  ${advice}`);
      }
    }
  }
  assert.deepEqual(found, []);
});
