// Managers delete projects, customers (with their history), tasks, visits and activities for good.
const fs = require('fs');
const path = require('path');
const { test, assert, api, db, ids } = require('./lib/activityFixture');
const fixture = require('./lib/activityFixture');
const { uploadDir } = require('../uploadUtils');

const pdf = Buffer.from('%PDF-1.4\n%test\n');
async function attach(url, token) {
  const form = new FormData();
  form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'notes.pdf');
  const res = await fetch(`${fixture.baseUrl}${url}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'X-SolutionsHub-Request': '1' }, body: form });
  const data = await res.json();
  assert.ok([200, 201].includes(res.status), JSON.stringify(data));
  const stored = (await db.prepare('SELECT stored_name FROM attachments WHERE id = ?').get(data.id)).stored_name;
  return path.join(uploadDir, stored);
}
const count = async (sql, ...params) => Number((await db.prepare(sql).get(...params)).n);

test('a project is deleted for good with its tasks and files; a recommendation that pointed at it stays', async () => {
  const project = await api('/api/projects', { method: 'POST', token: ids.tokenManager, body: {
    project_code: 'PRJ-DELETE-1', title: 'Short-lived project', description: 'To delete', start_date: '2026-10-01', member_ids: [ids.engineerEnabled], customer_id: ids.customer } });
  assert.equal(project.status, 200, JSON.stringify(project.data));
  const projectId = Number(project.data.id);
  const task = await api('/api/tasks', { method: 'POST', token: ids.tokenManager, body: { project_id: projectId, title: 'Project task', assigned_to: ids.engineerEnabled } });
  const taskId = Number(task.data.id);
  await api(`/api/tasks/${taskId}/comments`, { method: 'POST', token: ids.tokenManager, body: { message: 'Started' } });
  const projectFile = await attach(`/api/attachments/${projectId}`, ids.tokenManager);
  const taskFile = await attach(`/api/tasks/${taskId}/attachments`, ids.tokenManager);
  const rec = await api(`/api/customers/${ids.customer}/recommendations`, { method: 'POST', token: ids.tokenManager,
    body: { finding: 'Old switches', recommendation: 'Replace them', owner_id: ids.manager, due_date: '2026-12-01', risk_level: 'low' } });
  await db.prepare('UPDATE customer_recommendations SET related_project_id = ?, related_task_id = ? WHERE id = ?').run(projectId, taskId, rec.data.id);

  assert.equal((await api(`/api/projects/${projectId}`, { method: 'DELETE', token: ids.tokenEnabled })).status, 403, 'managers only');
  assert.equal((await api(`/api/projects/${projectId}`, { method: 'DELETE', token: ids.tokenManager })).status, 200);
  assert.equal(await count('SELECT COUNT(*) AS n FROM projects WHERE id = ?', projectId), 0);
  assert.equal(await count('SELECT COUNT(*) AS n FROM tasks WHERE id = ?', taskId), 0);
  assert.equal(await count('SELECT COUNT(*) AS n FROM task_comments WHERE task_id = ?', taskId), 0);
  assert.equal(await count('SELECT COUNT(*) AS n FROM attachments WHERE project_id = ? OR task_id = ?', projectId, taskId), 0);
  assert.ok(!fs.existsSync(projectFile) && !fs.existsSync(taskFile), 'the stored files are gone');
  const kept = await db.prepare('SELECT related_project_id, related_task_id FROM customer_recommendations WHERE id = ?').get(rec.data.id);
  assert.deepEqual([kept.related_project_id, kept.related_task_id], [null, null]);
  assert.equal(await count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'project_deleted' AND entity_id = ?", projectId), 1, 'the deletion is in the audit log');
});

test('an archived customer is deleted for good with all its history; an active one must be archived first', async () => {
  const made = await api('/api/customers', { method: 'POST', token: ids.tokenManager, body: { name: 'Delete Me Ltd', service_activity_enabled: true } });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  const customerId = Number(made.data.id);
  await db.prepare('INSERT INTO customer_teams (customer_id, team_id) VALUES (?, ?)').run(customerId, ids.teamEnabled);
  const asset = await api(`/api/customers/${customerId}/assets`, { method: 'POST', token: ids.tokenManager, body: { name: 'DEL-FW-01', asset_type: 'Firewall' } });
  assert.ok([200, 201].includes(asset.status), JSON.stringify(asset.data));
  const assetFile = await attach(`/api/customers/${customerId}/assets/${asset.data.id}/attachments`, ids.tokenManager);
  const activity = await api('/api/service-activities', { method: 'POST', token: ids.tokenEnabled,
    body: { customer_id: customerId, activity_date: '2026-10-01', category_id: ids.category, title: 'Firmware upgrade', asset_ids: [asset.data.id] } });
  assert.equal(activity.status, 200, JSON.stringify(activity.data));
  const visit = (await db.prepare('INSERT INTO maintenance_visits (title, customer_id, scheduled_date, status, created_by) VALUES (?, ?, ?, ?, ?)').run('Yearly visit', customerId, '2026-09-10', 'completed', ids.manager)).lastInsertRowid;
  const rec = await api(`/api/customers/${customerId}/recommendations`, { method: 'POST', token: ids.tokenManager,
    body: { finding: 'EOL firewall', recommendation: 'Replace it', owner_id: ids.manager, due_date: '2026-12-01', risk_level: 'high' } });
  await db.prepare('UPDATE customer_recommendations SET source_visit_id = ? WHERE id = ?').run(visit, rec.data.id);
  const task = await api('/api/tasks', { method: 'POST', token: ids.tokenManager, body: { customer_id: customerId, title: 'Customer task', assigned_to: ids.engineerEnabled } });

  assert.equal((await api(`/api/customers/${customerId}`, { method: 'DELETE', token: ids.tokenManager })).status, 409, 'archive first');
  assert.equal((await api(`/api/customers/${customerId}/archive`, { method: 'POST', token: ids.tokenManager })).status, 200);
  assert.equal((await api(`/api/customers/${customerId}`, { method: 'DELETE', token: ids.tokenEnabled })).status, 403);
  const gone = await api(`/api/customers/${customerId}`, { method: 'DELETE', token: ids.tokenManager });
  assert.equal(gone.status, 200, JSON.stringify(gone.data));
  for (const [table, column] of [['customers', 'id'], ['customer_assets', 'customer_id'], ['service_activities', 'customer_id'], ['maintenance_visits', 'customer_id'],
    ['customer_recommendations', 'customer_id'], ['tasks', 'customer_id'], ['customer_teams', 'customer_id']])
    assert.equal(await count(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`, customerId), 0, table);
  assert.equal(await count('SELECT COUNT(*) AS n FROM tasks WHERE id = ?', task.data.id), 0);
  assert.ok(!fs.existsSync(assetFile), 'the asset file is gone');
});

test('a visit with a recommendation raised on it, an activity with a file, and tasks in bulk are deleted for good', async () => {
  const visit = (await db.prepare('INSERT INTO maintenance_visits (title, customer_id, scheduled_date, status, created_by) VALUES (?, ?, ?, ?, ?)').run('Visit to delete', ids.customer, '2026-09-11', 'completed', ids.manager)).lastInsertRowid;
  const rec = await api(`/api/customers/${ids.customer}/recommendations`, { method: 'POST', token: ids.tokenManager,
    body: { finding: 'Weak Wi-Fi', recommendation: 'Add an access point', owner_id: ids.manager, due_date: '2026-12-01', risk_level: 'low' } });
  await db.prepare('UPDATE customer_recommendations SET source_visit_id = ? WHERE id = ?').run(visit, rec.data.id);
  assert.equal((await api(`/api/maintenance-visits/${visit}`, { method: 'DELETE', token: ids.tokenManager })).status, 200);
  assert.equal(await count('SELECT COUNT(*) AS n FROM maintenance_visits WHERE id = ?', visit), 0);
  assert.equal((await db.prepare('SELECT source_visit_id FROM customer_recommendations WHERE id = ?').get(rec.data.id)).source_visit_id, null, 'the recommendation stays');

  const activity = await api('/api/service-activities', { method: 'POST', token: ids.tokenEnabled, body: { customer_id: ids.customer, activity_date: '2026-10-02', category_id: ids.category, title: 'To delete' } });
  await db.prepare("INSERT INTO settings (key, value) VALUES ('service_activity_settings', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").run(JSON.stringify({ allow_attachments: true }));
  const file = await attach(`/api/service-activities/${activity.data.id}/attachments`, ids.tokenEnabled);
  assert.equal((await api(`/api/service-activities/${activity.data.id}`, { method: 'DELETE', token: ids.tokenManager })).status, 200);
  assert.ok(!fs.existsSync(file));

  const one = (await api('/api/tasks', { method: 'POST', token: ids.tokenManager, body: { customer_id: ids.customer, title: 'Bulk 1' } })).data.id;
  const two = (await api('/api/tasks', { method: 'POST', token: ids.tokenManager, body: { customer_id: ids.customer, title: 'Bulk 2' } })).data.id;
  const rec2 = await api(`/api/customers/${ids.customer}/recommendations`, { method: 'POST', token: ids.tokenManager,
    body: { finding: 'x', recommendation: 'y', owner_id: ids.manager, due_date: '2026-12-01', risk_level: 'low' } });
  await db.prepare('UPDATE customer_recommendations SET related_task_id = ? WHERE id = ?').run(one, rec2.data.id);
  const bulk = await api('/api/tasks/bulk', { method: 'POST', token: ids.tokenManager, body: { ids: [Number(one), Number(two)], action: 'delete' } });
  assert.equal(bulk.status, 200, JSON.stringify(bulk.data));
  assert.equal(await count('SELECT COUNT(*) AS n FROM tasks WHERE id IN (?, ?)', one, two), 0);
});
