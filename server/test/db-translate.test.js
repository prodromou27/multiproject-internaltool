const test = require('node:test');
const assert = require('node:assert/strict');
const { _translate } = require('../db');

test('translates positional placeholders to postgres parameters', () => {
  assert.equal(
    _translate('SELECT * FROM users WHERE id = ? AND email = ?'),
    'SELECT * FROM users WHERE id = $1 AND email = $2'
  );
});

test('translates common sqlite date and search expressions', () => {
  const sql = _translate(
    "SELECT strftime('%Y-%m', created_at) ym FROM tasks WHERE title LIKE ? AND date(created_at) = date('now')"
  );

  assert.match(sql, /substr\(created_at,1,7\)/);
  assert.match(sql, /title ILIKE \$1/);
  assert.match(sql, /substr\(created_at,1,10\) = to_char/);
});

test('translates INSERT OR IGNORE to ON CONFLICT DO NOTHING', () => {
  const sql = _translate('INSERT OR IGNORE INTO user_project_pins (user_id, project_id) VALUES (?, ?)');

  assert.equal(
    sql,
    'INSERT INTO user_project_pins (user_id, project_id) VALUES ($1, $2) ON CONFLICT DO NOTHING'
  );
});

test('translates GROUP_CONCAT to string_agg', () => {
  const sql = _translate("SELECT GROUP_CONCAT(name, ', ') FROM users");

  assert.equal(sql, "SELECT string_agg(name, ', ') FROM users");
});
