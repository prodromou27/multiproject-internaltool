import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGES, canAccessPage, visiblePages, primaryPages, quickCreateActions, pageForPath } from '../src/navigation.js';

test('navigation and create actions respect existing role and feature boundaries', () => {
  const ids = role => visiblePages(role).map(page => page.id);
  for (const role of ['engineer', 'planner', 'pm']) {
    for (const id of ['customers', 'reports', 'workload', 'users', 'settings', 'scorecards', 'approvals']) {
      assert.ok(!ids(role).includes(id), `${role} cannot discover ${id}`);
    }
    assert.ok(ids(role).includes('calendar'), `${role} can reach the existing calendar`);
  }
  const activity = PAGES.find(page => page.id === 'activities');
  assert.equal(canAccessPage(activity, 'manager'), true);
  assert.equal(canAccessPage(activity, 'engineer'), false);
  assert.equal(canAccessPage(activity, 'engineer', true), true);
  assert.equal(canAccessPage(activity, 'pm', true), true);
  assert.equal(canAccessPage(activity, 'planner', true), false);
  assert.equal(canAccessPage(activity, 'unknown', true), false);
  assert.deepEqual(quickCreateActions('engineer').map(action => action.id), ['task']);
  assert.deepEqual(quickCreateActions('engineer', true).map(action => action.id), ['task', 'activity']);
  assert.deepEqual(quickCreateActions('engineer',true,{ managedServiceOperations:true }).map(action => action.id),['activity','task']);
  assert.deepEqual(quickCreateActions('planner', true).map(action => action.id), ['visit']);
  assert.deepEqual(quickCreateActions('pm', true).map(action => action.id), ['activity']);
  assert.equal(quickCreateActions('manager').length, 4);
  const delegatedReviewer={ role:'planner',permissions:{ 'managed_reports.review':true,'managed_customers.view':false } };
  assert.equal(visiblePages(delegatedReviewer).some(page => page.id==='approvals'),true);
  assert.equal(visiblePages(delegatedReviewer).some(page => page.id==='managedCustomers'),false);
  assert.equal(visiblePages({ role:'manager',permissions:{ 'projects.access':false } }).some(page => page.id==='projects'),false);
  assert.equal(visiblePages({ role:'planner',permissions:{ 'customers.access':true } }).some(page => page.id==='customers'),true);
});

test('primary navigation stays concise and respects role and feature access', () => {
  const manager = { role: 'manager', permissions: {} };
  const engineer = { role: 'engineer', permissions: {} };

  assert.deepEqual(primaryPages(manager, false).map(page => page.id),
    ['dashboard', 'projects', 'tasks', 'visits', 'activities', 'managedCustomers', 'approvals']);
  assert.deepEqual(primaryPages(engineer, false).map(page => page.id),
    ['dashboard', 'myWork', 'projects', 'tasks', 'visits']);
  assert.ok(primaryPages(engineer, true).some(page => page.id === 'activities'));
  assert.deepEqual(primaryPages(engineer,true,{ managedServiceOperations:true }).map(page => page.id),
    ['dashboard','myWork','activities','projects','tasks','visits']);
  assert.deepEqual(primaryPages(engineer,true,{ managedServiceOperations:false,projectDelivery:true }).map(page => page.id),
    ['dashboard','myWork','projects','tasks','visits','activities']);
  assert.ok(primaryPages(manager, false).every(page => canAccessPage(page, manager, false)));
});

test('detail paths inherit the parent page while unknown paths remain unknown', () => {
  assert.equal(pageForPath('/projects/42').id, 'projects');
  assert.equal(pageForPath('/settings/security').id, 'settings');
  assert.equal(pageForPath('/customers/42/service-profile').id, 'customers');
  assert.equal(pageForPath('/projectsevil'), undefined);
  assert.equal(pageForPath('/missing'), undefined);
  assert.equal(new Set(PAGES.map(page => page.id)).size, PAGES.length);
});
