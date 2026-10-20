// A task can have engineers besides its assignee (the lead), and files attached.
const { test, assert, api, db, ids, baseUrl } = require('./lib/activityFixture');
const fixture = require('./lib/activityFixture');

const newTask = body => api('/api/tasks', { method: 'POST', token: ids.tokenManager, body: { customer_id: ids.customer, title: 'Firewall migration', ...body } });
const myTaskIds = async token => {
  const res = await api("/api/tasks", { token });
  if (res.status !== 200) throw new Error(`${res.status} ${JSON.stringify(res.data)}`);
  return (Array.isArray(res.data) ? res.data : res.data.rows).map(task => Number(task.id));
};
const pdf = Buffer.from('%PDF-1.4\n%test\n');
const upload = async (taskId, token, bytes = pdf, type = 'application/pdf', name = 'design.pdf') => {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), name);
  const res = await fetch(`${fixture.baseUrl || baseUrl}/api/tasks/${taskId}/attachments`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'X-SolutionsHub-Request': '1' }, body: form });
  return { status: res.status, data: await res.json() };
};

test('a task is created with other engineers; they see it as theirs, may update it, and leave when removed', async () => {
  // Engineer Disabled does not work with this customer: without the task they cannot see it.
  const bad = await newTask({ assigned_to: ids.engineerEnabled, engineer_ids: [ids.manager] });
  assert.equal(bad.status, 400, 'only engineers');
  assert.equal((await newTask({ engineer_ids: 'everyone' })).status, 400);

  const made = await newTask({ assigned_to: ids.engineerEnabled, engineer_ids: [ids.engineerDisabled, ids.engineerEnabled] });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  const id = Number(made.data.id);
  const stored = await db.prepare('SELECT user_id FROM task_engineers WHERE task_id = ?').all(id);
  assert.deepEqual(stored.map(row => Number(row.user_id)), [Number(ids.engineerDisabled)], 'the lead is not listed twice');

  assert.ok((await myTaskIds(ids.tokenDisabled)).includes(id), 'in the other engineer\'s task list');
  const listed = (await api('/api/tasks', { token: ids.tokenManager })).data;
  const row = (Array.isArray(listed) ? listed : listed.rows).find(task => Number(task.id) === id);
  assert.deepEqual(row.engineers.map(person => person.name), ['Engineer Disabled']);

  const update = await api(`/api/tasks/${id}`, { method: 'PUT', token: ids.tokenDisabled, body: { status: 'in_progress' } });
  assert.equal(update.status, 200, JSON.stringify(update.data));
  const after = await db.prepare('SELECT status, assigned_to FROM tasks WHERE id = ?').get(id);
  assert.deepEqual([after.status, Number(after.assigned_to)], ['in_progress', Number(ids.engineerEnabled)], 'the lead stays the assignee');
  assert.equal((await api(`/api/tasks/${id}/comments`, { method: 'POST', token: ids.tokenDisabled, body: { message: 'Rules exported' } })).status, 200);

  // The lead takes them off: the task is no longer theirs.
  assert.equal((await api(`/api/tasks/${id}`, { method: 'PUT', token: ids.tokenEnabled, body: { engineer_ids: [] } })).status, 200);
  assert.ok(!(await myTaskIds(ids.tokenDisabled)).includes(id));
  assert.equal((await api(`/api/tasks/${id}`, { method: 'PUT', token: ids.tokenDisabled, body: { status: 'open' } })).status, 403);

  // A manager adds them back, then makes them the lead: listed once, as the lead.
  assert.equal((await api(`/api/tasks/${id}`, { method: 'PUT', token: ids.tokenManager, body: { engineer_ids: [ids.engineerDisabled] } })).status, 200);
  assert.equal((await api(`/api/tasks/${id}`, { method: 'PUT', token: ids.tokenManager, body: { assigned_to: ids.engineerDisabled } })).status, 200);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM task_engineers WHERE task_id = ?').get(id)).n, 0);
});

test('files are attached by those working on the task, read by those who may see it, and removed by whoever added them or a manager', async () => {
  const id = Number((await newTask({ assigned_to: ids.engineerEnabled })).data.id);
  const added = await upload(id, ids.tokenEnabled);
  assert.equal(added.status, 201, JSON.stringify(added.data));
  assert.equal((await upload(id, ids.tokenEnabled, Buffer.from('<html></html>'))).status, 400, 'content must match the type');
  assert.equal((await upload(id, ids.tokenDisabled)).status, 403, 'not working on it');

  const files = await api(`/api/tasks/${id}/attachments`, { token: ids.tokenEnabled });
  assert.deepEqual(files.data.map(file => [file.original_name, file.uploaded_by_name]), [['design.pdf', 'Engineer Enabled']]);
  assert.equal((await api(`/api/tasks/${id}/attachments`, { token: ids.tokenDisabled })).status, 403);

  const download = await fetch(`${fixture.baseUrl}/api/tasks/${id}/attachments/${added.data.id}/download`, { headers: { Authorization: `Bearer ${ids.tokenManager}` } });
  assert.equal(download.status, 200);
  assert.equal(Buffer.from(await download.arrayBuffer()).toString(), pdf.toString());

  // Added to the task, another engineer may attach too, but not remove someone else's file.
  await api(`/api/tasks/${id}`, { method: 'PUT', token: ids.tokenManager, body: { engineer_ids: [ids.engineerDisabled] } });
  const theirs = await upload(id, ids.tokenDisabled, pdf, 'application/pdf', 'notes.pdf');
  assert.equal(theirs.status, 201);
  assert.equal((await api(`/api/tasks/${id}/attachments/${added.data.id}`, { method: 'DELETE', token: ids.tokenDisabled })).status, 403);
  assert.equal((await api(`/api/tasks/${id}/attachments/${theirs.data.id}`, { method: 'DELETE', token: ids.tokenDisabled })).status, 200);
  assert.equal((await api(`/api/tasks/${id}/attachments/${added.data.id}`, { method: 'DELETE', token: ids.tokenManager })).status, 200);
  assert.equal((await api(`/api/tasks/${id}/attachments`, { token: ids.tokenManager })).data.length, 0);

  // Deleting the task removes its files.
  const last = await upload(id, ids.tokenEnabled);
  const stored = (await db.prepare('SELECT stored_name FROM attachments WHERE id = ?').get(last.data.id)).stored_name;
  const file = require('path').join(require('../uploadUtils').uploadDir, stored);
  assert.ok(require('fs').existsSync(file));
  assert.equal((await api(`/api/tasks/${id}`, { method: 'DELETE', token: ids.tokenManager })).status, 200);
  assert.ok(!require('fs').existsSync(file), 'the stored file is gone');
});
