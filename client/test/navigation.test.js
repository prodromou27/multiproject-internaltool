import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGES, canAccessPage, visiblePages, quickCreateActions, pageForPath } from '../src/navigation.js';

test('navigation and create actions respect existing role and feature boundaries', () => {
  const ids = role => visiblePages(role).map(page => page.id);
  for (const role of ['engineer', 'planner', 'pm']) {
    for (const id of ['customers', 'reports', 'workload', 'users', 'settings', 'scorecards']) {
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
  assert.deepEqual(quickCreateActions('planner', true).map(action => action.id), ['visit']);
  assert.deepEqual(quickCreateActions('pm', true).map(action => action.id), ['activity']);
  assert.equal(quickCreateActions('manager').length, 4);
});

test('detail paths inherit the parent page while unknown paths remain unknown', () => {
  assert.equal(pageForPath('/projects/42').id, 'projects');
  assert.equal(pageForPath('/settings/security').id, 'settings');
  assert.equal(pageForPath('/customers/42/service-profile').id, 'customers');
  assert.equal(pageForPath('/projectsevil'), undefined);
  assert.equal(pageForPath('/missing'), undefined);
  assert.equal(new Set(PAGES.map(page => page.id)).size, PAGES.length);
});
