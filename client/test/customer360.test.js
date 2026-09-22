import test from 'node:test';
import assert from 'node:assert/strict';
import { customer360Section,customer360Sections } from '../src/pages/customer360.js';
import { customerIdFromCreateIntent } from '../src/hooks/useCreateIntent.js';

test('Customer 360 defaults managers to overview and engineers to service activities',() => {
  assert.equal(customer360Section({ role:'manager' }), 'overview');
  assert.equal(customer360Section({ role:'engineer' }), 'activities');
});

test('Customer 360 quick-create intents preserve only safe customer IDs',() => {
  assert.equal(customerIdFromCreateIntent(new URLSearchParams('create=1&customer_id=42')),42);
  for (const value of ['', '0', '-1', '1.5', '9007199254740992', '42&customer_id=43']) assert.equal(customerIdFromCreateIntent(new URLSearchParams({ customer_id:value })),null);
});

test('Customer 360 accepts available deep links and safely rejects unavailable sections',() => {
  assert.equal(customer360Section({ role:'manager' },'projects'),'projects');
  assert.equal(customer360Section({ role:'engineer' },'tasks'),'tasks');
  assert.equal(customer360Section({ role:'planner' },'tasks'),'activities');
  assert.equal(customer360Section({ role:'manager' },'timeline'),'timeline');
  assert.equal(customer360Section({ role:'engineer' },'timeline'),'timeline');
  assert.equal(customer360Section({ role:'manager' },'managed-services'),'service-configuration');
  assert.equal(customer360Section({ role:'engineer' },'assets'),'activities');
  assert.equal(customer360Section({ role:'engineer' },'not-real'),'activities');
  assert.equal(customer360Sections({ role:'engineer' }).some(section => section.id==='service-configuration'),false);
  assert.equal(customer360Sections({ role:'manager' }).some(section => section.id==='service-configuration'),true);
});
