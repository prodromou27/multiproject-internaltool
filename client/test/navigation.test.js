import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGES, canAccessPage, visiblePages, menuGroups, quickCreateActions, pageForPath } from '../src/navigation.js';

test('navigation and create actions respect existing role and feature boundaries', () => {
  const ids = role => visiblePages(role).map(page => page.id);
  for (const role of ['engineer', 'planner', 'pm']) {
    for (const id of [...(role === 'engineer' ? [] : ['customers']), 'reports', 'workload', 'users', 'settings', 'scorecards', 'approvals']) {
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
  assert.deepEqual(quickCreateActions('manager', true).map(action => action.id), ['task', 'project', 'visit', 'activity']);
  assert.deepEqual(quickCreateActions('manager', true, { managedServiceOperations: true }).map(action => action.id), ['activity', 'task', 'project', 'visit'],
    'a manager on a managed-services team also starts with Log Activity');
  const delegatedReviewer={ role:'planner',permissions:{ 'managed_reports.review':true,'managed_customers.view':false } };
  assert.equal(visiblePages(delegatedReviewer).some(page => page.id==='approvals'),true);
  assert.equal(visiblePages(delegatedReviewer).some(page => page.id==='customers'),false);
  assert.equal(visiblePages({ role:'manager',permissions:{ 'projects.access':false } }).some(page => page.id==='projects'),false);
  assert.equal(visiblePages({ role:'planner',permissions:{ 'customers.access':true } }).some(page => page.id==='customers'),true);
  assert.equal(visiblePages({ role:'manager',permissions:{ 'reports.access':false } }).some(page => ['reports','serviceOperations'].includes(page.id)),false);
  assert.equal(visiblePages({ role:'planner',permissions:{ 'reports.access':true } }).some(page => page.id==='reports'),true);
  assert.equal(canAccessPage(activity,{ role:'engineer',permissions:{ 'service_activities.access':false } },true),false);
  assert.deepEqual(quickCreateActions({ role:'engineer',permissions:{ 'service_activities.access':false } },true).map(action => action.id),['task']);
  const kpiManagement=PAGES.find(page => page.id==='kpiManagement');
  assert.equal(canAccessPage(kpiManagement,{ role:'manager',permissions:{ 'kpis.manage':true } }),true);
  assert.equal(canAccessPage(kpiManagement,{ role:'manager',permissions:{ 'kpis.manage':false } }),false);
  assert.equal(canAccessPage(kpiManagement,{ role:'planner',permissions:{ 'kpis.manage':true } }),true);
  assert.equal(canAccessPage(kpiManagement,{ role:'planner',permissions:{ 'kpis.manage':false } }),false);
});

test('the menu shows every page a person can open, in a few groups', () => {
  const menu = user => menuGroups(user, true).map(group => [group.section, group.pages.map(page => page.id)]);
  assert.deepEqual(menu({ role: 'manager', permissions: {} }), [
    ['Home', ['dashboard', 'calendar', 'myTime', 'reminders']],
    ['Work', ['projects', 'tasks', 'visits', 'activities', 'approvals']],
    ['Customers', ['customers', 'renewals', 'dataQuality']],
    ['Advisories', ['vulnerabilities', 'softwareVersions']],
    ['Team & performance', ['workload', 'skills', 'reports', 'kpiManagement', 'scorecards', 'sla']],
    ['More', ['responses', 'notes', 'settings']],
  ]);
  assert.deepEqual(menu({ role: 'engineer', permissions: {} }), [
    ['Home', ['dashboard', 'myWork', 'calendar', 'myTime', 'reminders']],
    ['Work', ['projects', 'tasks', 'visits', 'activities']],
    ['Customers', ['customers', 'renewals']],
    ['Advisories', ['vulnerabilities', 'softwareVersions']],
    ['More', ['responses', 'notes']],
  ]);
  // Every reachable page is in the menu, or lights up a parent that is.
  for (const role of ['manager', 'engineer', 'planner', 'pm']) {
    const inMenu = new Set(menuGroups(role, true).flatMap(group => group.pages.map(page => page.id)));
    for (const page of visiblePages(role, true).filter(page => !page.hidden))
      assert.ok(inMenu.has(page.id) || inMenu.has(page.parent), `${role}: ${page.id} is reachable from the menu`);
  }
  assert.deepEqual(menuGroups('engineer', false).find(group => group.section === 'Work').pages.map(page => page.id), ['projects', 'tasks', 'visits']);
  assert.equal(menuGroups('manager').find(group => group.section === 'Home').titled, false);
  assert.equal(pageForPath('/settings/users').parent, 'settings');
  assert.equal(pageForPath('/service-operations').parent, 'reports');
});

test('detail paths inherit the parent page while unknown paths remain unknown', () => {
  assert.equal(pageForPath('/projects/42').id, 'projects');
  assert.equal(pageForPath('/settings/security').id, 'settings');
  assert.equal(pageForPath('/customers/42/service-profile').id, 'customers');
  assert.equal(pageForPath('/projectsevil'), undefined);
  assert.equal(pageForPath('/missing'), undefined);
  assert.equal(new Set(PAGES.map(page => page.id)).size, PAGES.length);
});
