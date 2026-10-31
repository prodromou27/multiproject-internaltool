const test = require('node:test');
const assert = require('node:assert/strict');
const { _translate } = require('../db');

test('translates positional placeholders to postgres parameters', () => {
  assert.equal(
    _translate('SELECT * FROM users WHERE id = ? AND email = ?'),
    'SELECT * FROM users WHERE id = $1 AND email = $2'
  );
});

test('numbers each statement from one, independent of earlier statements', () => {
  _translate('SELECT ?, ?, ?');
  assert.equal(_translate('SELECT ?'), 'SELECT $1');
});

test('leaves native PostgreSQL untouched', () => {
  const sql = "SELECT substr(created_at,1,7) AS ym, string_agg(name, ', ') FROM t WHERE title ILIKE 'a%' AND created_at < app_now()";
  assert.equal(_translate(sql), sql);
});

test('no longer rewrites SQLite-only syntax, so it cannot hide in a query', () => {
  const sqlite = "SELECT strftime('%Y-%m', created_at), GROUP_CONCAT(name) FROM t WHERE x LIKE ?";
  assert.match(_translate(sqlite), /strftime|GROUP_CONCAT/);
});
