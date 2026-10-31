const test = require('node:test');
const assert = require('node:assert/strict');

const { requireAuth, requireDownloadAuth, signJwt } = require('../middleware/auth');

function mockReq(token, query = {}) {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    query,
  };
}

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('normal auth rejects 2FA partial tokens before any user access', async () => {
  const token = signJwt({ id: 123, partial: true }, { expiresIn: '5m' });
  const req = mockReq(token);
  const res = mockRes();
  let nextCalled = false;

  await requireAuth(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Invalid token scope');
});

test('normal auth rejects download-scoped tokens before any user access', async () => {
  const token = signJwt({ id: 123, download: true }, { expiresIn: '60s' });
  const req = mockReq(token);
  const res = mockRes();
  let nextCalled = false;

  await requireAuth(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Invalid token scope');
});

test('query-string download auth rejects full session tokens', async () => {
  const token = signJwt({ id: 123, role: 'manager' }, { expiresIn: '24h' });
  const req = mockReq(null, { token });
  const res = mockRes();
  let nextCalled = false;

  await requireDownloadAuth(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.match(res.body.error, /scoped download token/);
});
