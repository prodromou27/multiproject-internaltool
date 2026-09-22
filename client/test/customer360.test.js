import test from 'node:test';
import assert from 'node:assert/strict';
import { customer360Section,customer360Sections } from '../src/pages/customer360.js';

test('Customer 360 defaults managers to overview and engineers to service activities',() => {
  assert.equal(customer360Section({ role:'manager' }), 'overview');
  assert.equal(customer360Section({ role:'engineer' }), 'activities');
});

test('Customer 360 accepts available deep links and safely rejects unavailable sections',() => {
  assert.equal(customer360Section({ role:'manager' },'timeline'),'overview');
  assert.equal(customer360Section({ role:'manager' },'managed-services'),'service-configuration');
  assert.equal(customer360Section({ role:'engineer' },'assets'),'activities');
  assert.equal(customer360Section({ role:'engineer' },'not-real'),'activities');
  assert.equal(customer360Sections({ role:'engineer' }).some(section => section.id==='service-configuration'),false);
  assert.equal(customer360Sections({ role:'manager' }).some(section => section.id==='service-configuration'),true);
});
