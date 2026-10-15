const test = require('node:test');
const assert = require('node:assert/strict');
const { z } = require('zod');
const { validate } = require('../middleware/validate');

function run(schema, body, source = 'body') {
  const req = { [source]: body };
  let statusCode, jsonBody, calledNext = false;
  const res = { status(code) { statusCode = code; return this; }, json(body) { jsonBody = body; return this; } };
  validate(schema, source)(req, res, () => { calledNext = true; });
  return { req, statusCode, jsonBody, calledNext };
}

test('valid input passes through, with the schema\'s parsed/transformed value', () => {
  const schema = z.object({ name: z.string().trim().min(1) });
  const result = run(schema, { name: '  Alice  ' });
  assert.equal(result.calledNext, true);
  assert.equal(result.statusCode, undefined);
  assert.equal(result.req.body.name, 'Alice'); // trimmed by the schema
});

test('invalid input responds 400 with a single plain-string error, and does not call next', () => {
  const schema = z.object({ name: z.string().min(1, 'Name required') });
  const result = run(schema, { name: '' });
  assert.equal(result.calledNext, false);
  assert.equal(result.statusCode, 400);
  assert.equal(typeof result.jsonBody.error, 'string');
  assert.match(result.jsonBody.error, /Name required/);
});

test('the error message is prefixed with the field path for nested schemas', () => {
  const schema = z.object({ user: z.object({ email: z.string().min(1, 'Email required') }) });
  const result = run(schema, { user: { email: '' } });
  assert.equal(result.statusCode, 400);
  assert.equal(result.jsonBody.error, 'user.email: Email required');
});

test('validates req.query or req.params when given a different source', () => {
  const schema = z.object({ id: z.coerce.number().int().positive() });
  assert.equal(run(schema, { id: '5' }, 'query').calledNext, true);
  assert.equal(run(schema, { id: 'abc' }, 'params').statusCode, 400);
});

test('a missing body object fails cleanly instead of throwing', () => {
  const schema = z.object({ name: z.string() });
  const result = run(schema, undefined);
  assert.equal(result.statusCode, 400);
  assert.equal(result.calledNext, false);
});
