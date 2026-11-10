const test = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./lib/harness');

let h, manager, engineer, project;
test.before(async () => {
  h = await start({ '/api/kpis': require('../routes/kpis') });
  manager = await h.makeUser('KPI Manager', 'manager');
  engineer = await h.makeUser('KPI Engineer', 'engineer');
  project = (await h.db.prepare("INSERT INTO projects (title,status,completion_pct,created_by) VALUES ('Admin KPI project','in_progress',60,?)").run(manager.id)).lastInsertRowid;
});
test.after(async () => h?.stop());

const definition = () => ({
  name: 'Delivery confidence', description: 'Average active project completion', category: 'Delivery',
  data_source: 'project_completion', calculation_config: {}, target_value: 90,
  warning_threshold: 75, critical_threshold: 50, direction: 'higher', scope_type: 'project',
  project_id: project, team_id: null, enabled: true, display_order: 10, visualization_type: 'gauge',
});

test('authorized management can preview, manage, calculate and review KPI history', async () => {
  const preview = await h.api('/api/kpis/definitions/preview', { method: 'POST', token: manager.token, body: definition() });
  assert.equal(preview.status, 200);
  assert.equal(preview.data.value, 60);
  assert.equal(preview.data.status, 'warning');

  const created = await h.api('/api/kpis/definitions', { method: 'POST', token: manager.token, body: definition() });
  assert.equal(created.status, 201);
  const id = created.data.id;

  const listed = await h.api('/api/kpis/definitions?page=1&page_size=25&search=Delivery', { token: manager.token });
  assert.equal(listed.status, 200);
  assert.equal(listed.data.total, 1);
  assert.equal(listed.data.rows[0].calculation_config instanceof Object, true);

  const tested = await h.api(`/api/kpis/definitions/${id}/test`, { method: 'POST', token: manager.token, body: {} });
  assert.equal(tested.data.persisted, false);
  const calculated = await h.api(`/api/kpis/definitions/${id}/calculate`, { method: 'POST', token: manager.token, body: {} });
  assert.equal(calculated.status, 201);
  const history = await h.api(`/api/kpis/definitions/${id}/values?page=1&page_size=10`, { token: manager.token });
  assert.equal(history.data.total, 1);
  assert.equal(history.data.rows[0].status, 'warning');

  const updated = await h.api(`/api/kpis/definitions/${id}`, { method: 'PUT', token: manager.token, body: { ...definition(), name: 'Delivery progress', version: 1 } });
  assert.equal(updated.data.version, 2);
  assert.equal((await h.api(`/api/kpis/definitions/${id}`, { method: 'PUT', token: manager.token, body: { ...definition(), version: 1 } })).status, 409);
  const disabled = await h.api(`/api/kpis/definitions/${id}/state`, { method: 'POST', token: manager.token, body: { enabled: false, version: 2 } });
  assert.equal(disabled.data.enabled, false);
  assert.equal((await h.api(`/api/kpis/definitions/${id}/calculate`, { method: 'POST', token: manager.token, body: {} })).status, 409);
});

test('engineers cannot receive KPI administration data and filters are bounded', async () => {
  for (const path of ['/api/kpis/definitions', '/api/kpis/definitions/meta']) {
    assert.equal((await h.api(path, { token: engineer.token })).status, 403);
  }
  assert.equal((await h.api('/api/kpis/definitions/preview', { method: 'POST', token: engineer.token, body: definition() })).status, 403);
  assert.equal((await h.api('/api/kpis/definitions?page=0', { token: manager.token })).status, 400);
  assert.equal((await h.api('/api/kpis/definitions?unknown=1', { token: manager.token })).status, 400);
});
