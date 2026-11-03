const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./lib/harness');

let h, manager, planner, assignedEngineer, otherEngineer, project;

test.before(async () => {
  h = await harness.start({
    '/api/kpis': require('../routes/kpis'),
    '/api/milestones': require('../routes/milestones'),
    '/api/reports': require('../routes/reports'),
  });
  manager = await h.makeUser('Kpi Manager', 'manager');
  planner = await h.makeUser('Kpi Planner', 'planner');
  assignedEngineer = await h.makeUser('Kpi Assigned', 'engineer');
  otherEngineer = await h.makeUser('Kpi Other', 'engineer');
  project = (await h.db.prepare("INSERT INTO projects (title, status, created_by) VALUES ('KPI project', 'in_progress', ?)").run(manager.id)).lastInsertRowid;
  await h.db.prepare('INSERT INTO project_assignments (project_id, user_id) VALUES (?, ?)').run(project, assignedEngineer.id);
});
test.after(() => h.stop());

test('KPI permissions never expose management data to engineers', async () => {
  const body = { name: 'Uptime', target_value: 99.9, current_value: 98, unit: '%' };
  assert.equal((await h.api(`/api/kpis/${project}`, { method: 'POST', token: assignedEngineer.token, body })).status, 403);
  assert.equal((await h.api(`/api/kpis/${project}`, { method: 'POST', token: planner.token, body })).status, 403);
  assert.equal((await h.api(`/api/kpis/${project}`, { method: 'POST', token: manager.token, body })).status, 200);

  assert.equal((await h.api(`/api/kpis/${project}`, { token: manager.token })).data.length, 1);
  assert.equal((await h.api(`/api/kpis/${project}`, { token: assignedEngineer.token })).status, 403);
  assert.equal((await h.api(`/api/kpis/${project}`, { token: otherEngineer.token })).status, 403);
  assert.equal((await h.api(`/api/kpis/${project}`, { token: planner.token })).status, 403);

  await h.db.prepare("INSERT INTO user_permission_overrides (user_id,permission_key,allowed,updated_by) VALUES (?,'kpis.view',1,?),(?,'kpis.manage',1,?)").run(planner.id,manager.id,planner.id,manager.id);
  assert.equal((await h.api(`/api/kpis/${project}`, { token: planner.token })).status,200,'authorized management can view KPIs');
  assert.equal((await h.api(`/api/kpis/${project}`, { method:'POST',token:planner.token,body:{ name:'Risk',target_value:5 } })).status,200,'authorized management can manage KPIs');

  await h.db.prepare("INSERT INTO user_permission_overrides (user_id,permission_key,allowed,updated_by) VALUES (?,'kpis.view',1,?)").run(assignedEngineer.id,manager.id);
  assert.equal((await h.api(`/api/kpis/${project}`, { token: assignedEngineer.token })).status,403,'a forged engineer override remains denied');
});

test('report summaries omit KPI fields when KPI viewing is denied',async () => {
  if (process.env.TEST_DATABASE_URL) {
    const allowed=await h.api('/api/reports/summary',{ token:manager.token });
    assert.equal(allowed.status,200);
    assert.ok(Array.isArray(allowed.data.kpiHealth));
  }
  await h.db.prepare("INSERT INTO user_permission_overrides (user_id,permission_key,allowed,updated_by) VALUES (?,'kpis.view',0,?)").run(manager.id,manager.id);
  const denied=await h.api('/api/reports/summary',{ token:manager.token });
  assert.equal(denied.status,200);
  assert.equal(Object.hasOwn(denied.data,'kpiHealth'),false);
});

test('KPI validation rejects bad numbers, empty names and missing rows', async () => {
  const post = body => h.api(`/api/kpis/${project}`, { method: 'POST', token: manager.token, body });
  assert.equal((await post({ name: '', target_value: 1 })).status, 400);
  assert.equal((await post({ name: 'x'.repeat(121), target_value: 1 })).status, 400);
  assert.equal((await post({ name: 'Zero target', target_value: 0 })).status, 400);
  assert.equal((await post({ name: 'Negative', target_value: 5, current_value: -1 })).status, 400);
  assert.equal((await post({ name: 'NaN', target_value: 'abc' })).status, 400);
  assert.equal((await h.api('/api/kpis/99999999', { method: 'POST', token: manager.token, body: { name: 'n', target_value: 1 } })).status, 404);
  assert.equal((await h.api(`/api/kpis/${project}/99999999`, { method: 'PUT', token: manager.token, body: { name: 'n' } })).status, 404);
  assert.equal((await h.api(`/api/kpis/${project}/99999999`, { method: 'DELETE', token: manager.token })).status, 404);
});

test('a KPI cannot be edited through another project id', async () => {
  const other = (await h.db.prepare("INSERT INTO projects (title, status, created_by) VALUES ('Other', 'in_progress', ?)").run(manager.id)).lastInsertRowid;
  const kpi = (await h.api(`/api/kpis/${project}`, { method: 'POST', token: manager.token, body: { name: 'Scoped', target_value: 10 } })).data.id;
  assert.equal((await h.api(`/api/kpis/${other}/${kpi}`, { method: 'PUT', token: manager.token, body: { current_value: 5 } })).status, 404);
  assert.equal((await h.api(`/api/kpis/${other}/${kpi}`, { method: 'DELETE', token: manager.token })).status, 404);
  assert.equal((await h.api(`/api/kpis/${project}/${kpi}`, { method: 'PUT', token: manager.token, body: { current_value: 0 } })).status, 200);
});

test('milestones: planners need assignment, engineers cannot write, completion is idempotent', async () => {
  const create = (user, extra = {}) => h.api('/api/milestones', { method: 'POST', token: user.token, body: { project_id: project, title: 'Go live', ...extra } });
  assert.equal((await create(assignedEngineer)).status, 403);
  assert.equal((await create(planner)).status, 403);            // planner not assigned yet
  assert.equal((await h.api('/api/milestones', { method: 'POST', token: manager.token, body: { project_id: project, title: '  ' } })).status, 400);

  await h.db.prepare('INSERT INTO project_assignments (project_id, user_id) VALUES (?, ?)').run(project, planner.id);
  const made = await create(planner);
  assert.equal(made.status, 200);
  const id = made.data.id;

  assert.equal((await h.api(`/api/milestones?project_id=${project}`, { token: otherEngineer.token })).status, 403);
  assert.equal((await h.api(`/api/milestones?project_id=${project}`, { token: assignedEngineer.token })).data.length, 1);
  assert.equal((await h.api('/api/milestones', { token: manager.token })).status, 400);

  assert.equal((await h.api(`/api/milestones/${id}/complete`, { method: 'POST', token: assignedEngineer.token })).status, 403);
  assert.equal((await h.api(`/api/milestones/${id}/complete`, { method: 'POST', token: planner.token })).status, 200);
  const list = async () => (await h.api(`/api/milestones?project_id=${project}`, { token: manager.token })).data[0];
  assert.ok((await list()).completed_at);
  assert.equal((await list()).completed_by, planner.id);
  assert.equal((await h.api(`/api/milestones/${id}/complete`, { method: 'POST', token: manager.token })).status, 200);
  assert.equal((await list()).completed_by, planner.id);       // a second completion does not overwrite

  assert.equal((await h.api(`/api/milestones/${id}/reopen`, { method: 'POST', token: manager.token })).status, 200);
  assert.equal((await list()).completed_at, null);
  assert.equal((await h.api('/api/milestones/99999999', { method: 'DELETE', token: manager.token })).status, 404);
  assert.equal((await h.api(`/api/milestones/${id}`, { method: 'DELETE', token: planner.token })).status, 200);
});
