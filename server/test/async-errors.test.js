const test = require('node:test');
const assert = require('node:assert/strict');
require('express-async-errors');
const express = require('express');
const { errorHandler } = require('../middleware/errors');

test('rejected asynchronous routes return a safe error and leave the server responsive', async () => {
  const previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const app = express();
  app.get('/fail', async () => {
    await Promise.resolve();
    throw new Error('Sensitive database credentials');
  });
  app.get('/ok', async (req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, () => resolve(instance));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const failed = await fetch(`${base}/fail`);
    assert.equal(failed.status, 500);
    assert.deepEqual(await failed.json(), { error: 'An internal error occurred' });
    const healthy = await fetch(`${base}/ok`);
    assert.equal(healthy.status, 200);
    assert.deepEqual(await healthy.json(), { ok: true });
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
  }
});
