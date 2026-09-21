const test = require('node:test');
const assert = require('node:assert/strict');
const { errorHandler } = require('../middleware/errors');

function run(err) {
  const res = { headersSent: false, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  const saved = { warn: console.warn, error: console.error };
  console.warn = console.error = () => {};
  try { errorHandler(err, { method: 'GET', originalUrl: '/api/kpis/abc?x=1' }, res, () => {}); } finally { Object.assign(console, saved); }
  return res;
}

test('database errors caused by the request are 4xx, not 500', () => {
  assert.equal(run({ code: '22P02', message: 'invalid input syntax for type integer: "abc"' }).code, 400);
  assert.equal(run({ code: '23503', message: 'fk' }).code, 409);
  assert.equal(run({ code: '23505', message: 'dup' }).code, 409);
  assert.equal(run({ code: '22003' }).code, 400);
  // The internal message must not leak.
  assert.doesNotMatch(JSON.stringify(run({ code: '22P02', message: 'type integer: "abc"' }).body), /integer/);
});

test('explicit statuses win, and unknown errors stay 500', () => {
  assert.equal(run({ status: 404, code: '23503', message: 'x' }).code, 404);
  assert.equal(run(new Error('boom')).code, 500);
});
