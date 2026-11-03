const test = require('node:test');
const assert = require('node:assert/strict');
const { getRuntimeConfigIssues } = require('../config');

const hexKey = 'a'.repeat(64);

test('production config requires database, app URL, JWT secret, and encryption keys', () => {
  const { errors } = getRuntimeConfigIssues({ NODE_ENV: 'production' });

  assert(errors.includes('DATABASE_URL is required in production'));
  assert(errors.includes('JWT_SECRET must be at least 32 characters in production'));
  assert(errors.includes('CUSTOMER_FIELD_KEY is required in production'));
  assert(errors.includes('ATTACHMENT_KEY is required in production'));
  assert(errors.includes('APP_URL is required in production for password reset links'));
});

test('production config accepts valid required settings', () => {
  const { errors } = getRuntimeConfigIssues({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://app:secret@db:5432/app',
    JWT_SECRET: 'b'.repeat(48),
    CUSTOMER_FIELD_KEY: hexKey,
    ATTACHMENT_KEY: hexKey,
    APP_URL: 'https://app.example.com',
    TRUST_PROXY: '1',
  });

  assert.deepEqual(errors, []);
});

test('config rejects malformed URLs and encryption keys', () => {
  const { errors } = getRuntimeConfigIssues({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://app:secret@db:5432/app',
    JWT_SECRET: 'b'.repeat(48),
    CUSTOMER_FIELD_KEY: 'not-hex',
    ATTACHMENT_KEY: hexKey,
    APP_URL: 'localhost:8080',
    ALLOWED_ORIGIN: 'also-bad',
    TRUST_PROXY: '0',
  });

  assert(errors.includes('CUSTOMER_FIELD_KEY must be exactly 64 hex characters'));
  assert(errors.includes('APP_URL must be a valid http(s) URL'));
  assert(errors.includes('ALLOWED_ORIGIN must be a valid http(s) URL'));
  assert(errors.includes('TRUST_PROXY must be a positive integer when set'));
});
