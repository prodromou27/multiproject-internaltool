const test = require('node:test');
const assert = require('node:assert/strict');
const cipher = require('../fieldCipher');

test('customer encryption includes customer name and decrypts all fields', () => {
  const originalKey = process.env.CUSTOMER_FIELD_KEY;
  process.env.CUSTOMER_FIELD_KEY = 'a'.repeat(64);

  const encrypted = cipher.encryptCustomer({
    name: 'Acme Corp',
    contact_name: 'Jane Smith',
    contact_email: 'jane@example.com',
    contact_phone: '+1-555-0100',
    address: '123 Main St',
    notes: 'VIP',
  });

  assert.match(encrypted.name, /^enc:/);
  assert.match(encrypted.contact_email, /^enc:/);
  assert.notEqual(encrypted.name, 'Acme Corp');

  const decrypted = cipher.decryptCustomer(encrypted);
  assert.equal(decrypted.name, 'Acme Corp');
  assert.equal(decrypted.contact_name, 'Jane Smith');
  assert.equal(decrypted.contact_email, 'jane@example.com');
  assert.equal(decrypted.contact_phone, '+1-555-0100');
  assert.equal(decrypted.address, '123 Main St');
  assert.equal(decrypted.notes, 'VIP');

  const status = cipher.keyStatus();
  assert.equal(status.configured, true);
  assert.equal(status.algorithm, 'aes-256-gcm');
  assert.equal(status.fingerprint.length, 12);

  if (originalKey === undefined) delete process.env.CUSTOMER_FIELD_KEY;
  else process.env.CUSTOMER_FIELD_KEY = originalKey;
});
