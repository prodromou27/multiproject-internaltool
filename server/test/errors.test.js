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

test('logs never carry the request body, query string or database detail', async () => {
  const express = require('express');
  const logged = [];
  const saved = { warn: console.warn, error: console.error };
  console.warn = console.error = (...args) => logged.push(JSON.stringify(args));
  const app = express();
  app.use(express.json());
  app.post('/api/auth/login', () => { throw new Error('should not run'); });
  app.get('/api/boom', () => { throw Object.assign(new Error('db failed'), { detail: 'Key (email)=(secret@x) exists', code: 'XX000' }); });
  app.use(errorHandler);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const bad = await fetch(`${base}/api/auth/login?token=query-secret`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"email":"a@b.c","password":"Hunter2-secret" broken' });
    assert.equal(bad.status, 400);
    assert.equal((await fetch(`${base}/api/boom?token=query-secret`)).status, 500);
  } finally { server.close(); Object.assign(console, saved); }
  const all = logged.join('\n');
  assert.ok(logged.length >= 2);
  for (const secret of ['Hunter2-secret', 'query-secret', 'secret@x']) assert.ok(!all.includes(secret), secret);
  assert.match(all, /entity\.parse\.failed/);
  assert.match(all, /db failed/);
});
