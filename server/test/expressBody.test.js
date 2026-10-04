const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { ensureBody } = require('../middleware/body');

// Express 5 leaves req.body undefined for requests without a body; handlers expect {}.
test('a bodiless DELETE still sees an empty object body, and JSON bodies are untouched', async () => {
  const app = express();
  app.use(express.json());
  app.use(ensureBody);
  app.delete('/x', (req, res) => { const { version } = req.body; res.json({ body: req.body, version: version ?? null }); });
  app.post('/x', (req, res) => res.json({ body: req.body }));
  const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const del = await fetch(`${base}/x`, { method: 'DELETE' });
    assert.equal(del.status, 200);
    assert.deepEqual(await del.json(), { body: {}, version: null });
    const post = await fetch(`${base}/x`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ a: 1 }) });
    assert.deepEqual(await post.json(), { body: { a: 1 } });
  } finally { await new Promise(resolve => server.close(resolve)); }
});
