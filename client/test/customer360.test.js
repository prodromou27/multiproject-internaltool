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
  assert.deepEqual(customer360Sections({ role:'engineer' },{ managedServiceOperations:true,projectDelivery:false }).map(section => section.id),
    ['activities','timeline','recommendations','projects','tasks','maintenance-visits']);
  assert.deepEqual(customer360Sections({ role:'engineer' },{ managedServiceOperations:false,projectDelivery:true }).map(section => section.id),
    ['projects','tasks','maintenance-visits','recommendations','activities','timeline']);
  assert.equal(customer360Section({ role:'engineer' },null,{ managedServiceOperations:false,projectDelivery:true }),'projects');
  assert.equal(customer360Section({ role:'engineer' },null,{ managedServiceOperations:true,projectDelivery:true }),'activities');
  assert.equal(customer360Section({ role:'engineer' },null,{ managedServiceOperations:false,projectDelivery:false }),'activities');
});

import { customerHealth, customerHue } from '../src/pages/customer360.js';

test('customer health is 100 with nothing wrong and lists every deduction otherwise', () => {
  assert.equal(customerHealth(null), null);
  const clean = { projects: { delayed: 0 }, tasks: { overdue: 0 }, recommendations: { high_risk: 0 }, visits: { reports_pending: 0 }, managed: { state: 'active' } };
  assert.deepEqual(customerHealth(clean), { score: 100, tone: 'good', label: 'Healthy', factors: [] });
  const bad = customerHealth({ ...clean, projects: { delayed: 2 }, tasks: { overdue: 3 }, managed: { state: 'sync_attention' } });
  assert.equal(bad.score, 100 - 20 - 15 - 10);
  assert.equal(bad.tone, 'warn');
  assert.deepEqual(bad.factors.map(f => f.label), ['2 delayed projects', '3 overdue tasks', 'ticket sync failing']);
});

test('each factor is capped so one bad area cannot zero the score alone', () => {
  const worst = customerHealth({ projects: { delayed: 50 }, tasks: { overdue: 50 }, recommendations: { high_risk: 50 }, visits: { reports_pending: 50 }, managed: { state: 'sync_attention' } });
  assert.equal(worst.score, 100 - 30 - 25 - 15 - 10 - 10);
  assert.equal(worst.tone, 'bad');
});

test('customer hue is stable per name and within 0-359', () => {
  assert.equal(customerHue('Acme'), customerHue('Acme'));
  assert.notEqual(customerHue('Acme'), customerHue('Globex'));
  for (const name of ['', 'x', 'A very long customer name Ltd.']) assert.ok(customerHue(name) >= 0 && customerHue(name) < 360);
});

test('an engineer on a managed-services team gets the Assets tab for that customer only when the server grants it', () => {
  const engineer = { role: 'engineer', permissions: { 'assets.access': false } };
  const ids = (grant, capabilities = {}) => customer360Sections(engineer, capabilities, grant).map(section => section.id);
  assert.equal(ids(false).includes('assets'), false);
  assert.equal(ids(true).includes('assets'), true);
  // Also present in the managed-services ordering, next to the activities they mainly track.
  assert.deepEqual(ids(true, { managedServiceOperations: true }).slice(0, 3), ['activities', 'assets', 'timeline']);
  assert.equal(ids(false, { managedServiceOperations: true }).includes('assets'), false);
  // A deep link to Assets falls back to a safe tab without the grant, and works with it.
  assert.equal(customer360Section(engineer, 'assets', {}, false) === 'assets', false);
  assert.equal(customer360Section(engineer, 'assets', {}, true), 'assets');
  // Managers are unaffected.
  assert.equal(customer360Sections({ role: 'manager', permissions: {} }).some(section => section.id === 'assets'), true);
});
