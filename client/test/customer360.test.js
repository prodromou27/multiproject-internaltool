import test from 'node:test';
import assert from 'node:assert/strict';
import { customer360Section,customer360Sections } from '../src/pages/customer360.js';
import { customerIdFromCreateIntent } from '../src/hooks/useCreateIntent.js';

test('Customer 360 opens on the overview, for managers and engineers',() => {
  assert.equal(customer360Section({ role:'manager' }), 'overview');
  assert.equal(customer360Section({ role:'engineer' }), 'overview');
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
  assert.equal(customer360Section({ role:'engineer' },'assets'),'overview');
  assert.equal(customer360Section({ role:'engineer' },'not-real'),'overview');
  assert.equal(customer360Sections({ role:'engineer' }).some(section => section.id==='service-configuration'),false);
  assert.equal(customer360Sections({ role:'manager' }).some(section => section.id==='service-configuration'),true);
  assert.deepEqual(customer360Sections({ role:'engineer' },{ managedServiceOperations:true,projectDelivery:false }).map(section => section.id),
    ['overview','tasks','maintenance-visits','recommendations','contracts','activities','timeline','projects']);
  assert.deepEqual(customer360Sections({ role:'engineer' },{ managedServiceOperations:false,projectDelivery:true }).map(section => section.id),
    ['overview','projects','tasks','maintenance-visits','recommendations','activities','contracts','timeline']);
  for (const capabilities of [{ managedServiceOperations:false,projectDelivery:true },{ managedServiceOperations:true,projectDelivery:true },{ managedServiceOperations:false,projectDelivery:false }])
    assert.equal(customer360Section({ role:'engineer' },null,capabilities),'overview');
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

test('an engineer who works with the customer gets the Assets tab only when the server grants it', () => {
  const engineer = { role: 'engineer', permissions: { 'assets.access': false } };
  const ids = (grant, capabilities = {}) => customer360Sections(engineer, capabilities, grant).map(section => section.id);
  assert.equal(ids(false).includes('assets'), false);
  assert.equal(ids(true).includes('assets'), true);
  // Also present in the managed-services ordering, next to the tasks.
  assert.deepEqual(ids(true, { managedServiceOperations: true }).slice(0, 4), ['overview', 'tasks', 'assets', 'maintenance-visits']);
  assert.equal(ids(false, { managedServiceOperations: true }).includes('assets'), false);
  // A deep link to Assets falls back to a safe tab without the grant, and works with it.
  assert.equal(customer360Section(engineer, 'assets', {}, false) === 'assets', false);
  assert.equal(customer360Section(engineer, 'assets', {}, true), 'assets');
  // Managers are unaffected.
  assert.equal(customer360Sections({ role: 'manager', permissions: {} }).some(section => section.id === 'assets'), true);
});

test('managed customers add Tickets and Reports, for people who may see managed services', () => {
  const ids = (user, managed) => customer360Sections(user, {}, false, managed).map(section => section.id);
  const manager = { role: 'manager' };
  assert.ok(!ids(manager, false).includes('tickets'));
  assert.ok(ids(manager, true).includes('tickets') && ids(manager, true).includes('reports'));
  assert.ok(!ids({ role: 'manager', permissions: { 'managed_customers.view': false } }, true).includes('tickets'));
  assert.ok(!ids({ role: 'engineer' }, true).includes('reports'));
  assert.equal(customer360Section(manager, 'tickets', {}, false, true), 'tickets');
  assert.equal(customer360Section(manager, 'tickets', {}, false, false), 'overview');
});

test('a customer with a Request Tracker queue gets Tickets even when not managed; Reports stays with managed customers', () => {
  const ids = (managed, tickets) => customer360Sections({ role: 'manager' }, {}, false, managed, tickets).map(section => section.id);
  assert.ok(ids(false, true).includes('tickets'));
  assert.ok(!ids(false, true).includes('reports'));
  assert.ok(!ids(false, false).includes('tickets'));
  assert.ok(ids(true, false).includes('tickets') && ids(true, false).includes('reports'));
});

test('managed customers have no Maintenance Visits tab', () => {
  const ids = (role, managed) => customer360Sections({ role, permissions: { 'managed_customers.view': true } }, {}, false, managed).map(section => section.id);
  for (const role of ['manager', 'engineer', 'planner']) {
    assert.equal(ids(role, true).includes('maintenance-visits'), false, role);
    assert.equal(ids(role, false).includes('maintenance-visits'), true, role);
  }
});

test('a customer the server marks as managed has no Maintenance Visits tab, whatever the viewer may see', () => {
  const ids = customer360Sections({ role: 'engineer' }, {}, true, false, false, true).map(section => section.id);
  assert.equal(ids.includes('maintenance-visits'), false);
  assert.equal(ids.includes('tasks'), true);
});
