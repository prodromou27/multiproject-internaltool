const test = require('node:test');
const assert = require('node:assert/strict');
const { setSessionCookie } = require('../middleware/session');

test('session cookies are Secure when the public app URL uses HTTPS behind a proxy', () => {
  const previous = process.env.APP_URL;
  process.env.APP_URL = 'https://solutions.example';
  let options;
  try {
    setSessionCookie({ secure: false }, {
      cookie(name, token, value) { options = value; }, setHeader() {},
    }, 'token');
    assert.equal(options.secure, true);
    assert.equal(options.httpOnly, true);
    assert.equal(options.sameSite, 'strict');
  } finally {
    if (previous === undefined) delete process.env.APP_URL; else process.env.APP_URL = previous;
  }
});
