const { test, assert, api, db, ids } = require('./lib/activityFixture');
const appTime = require('../appTime');

const newTask = body => api('/api/tasks', { method: 'POST', token: ids.tokenManager, body: { customer_id: ids.customer, title: 'Servers upgrades', ...body } });
const subtasksOf = async (id, token = ids.tokenManager) => { const res = await api(`/api/tasks/${id}/subtasks`, { token }); return { status: res.status, data: res.data.subtasks, task: res.data.task }; };
let asset;

test('a task is created with its subtasks, one per server to upgrade', async () => {
  asset = (await api(`/api/customers/${ids.customer}/assets`, { method: 'POST', token: ids.tokenManager, body: { name: 'SRV-01', asset_type: 'Server', software_version: '2019' } })).data;
  const options = await api(`/api/customers/${ids.customer}/assets/options`, { token: ids.tokenManager });
  assert.deepEqual(options.data.map(a => [a.name, a.software_version]), [['SRV-01', '2019']]);

  const made = await newTask({ assigned_to: ids.engineerEnabled, subtasks: ['Take a backup', { title: 'Upgrade SRV-01', asset_id: asset.id }] });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  const list = (await subtasksOf(made.data.id)).data;
  assert.deepEqual(list.map(s => [s.title, s.asset_name, s.done]), [['Take a backup', null, false], ['Upgrade SRV-01', 'SRV-01', false]]);

  for (const subtasks of [['x'.repeat(301)], [''], [{ title: 'Elsewhere', asset_id: 999999 }], 'not a list'])
    assert.equal((await newTask({ subtasks })).status, 400, JSON.stringify(subtasks));
  const otherCustomer = await api('/api/tasks', { method: 'POST', token: ids.tokenManager, body: { customer_id: ids.customerUnassigned, title: 'X', subtasks: [{ title: 'Y', asset_id: asset.id }] } });
  assert.equal(otherCustomer.status, 400, 'an asset of another customer');
});

test('the task cannot be completed, closed or sent for approval until every subtask is done', async () => {
  const id = (await newTask({ assigned_to: ids.engineerEnabled, subtasks: ['Server A', 'Server B'] })).data.id;
  const setStatus = (status, token = ids.tokenEnabled) => api(`/api/tasks/${id}`, { method: 'PUT', token, body: { status } });
  const blocked = await setStatus('completed');
  assert.equal(blocked.status, 409);
  assert.deepEqual([blocked.data.code, blocked.data.open_subtasks, blocked.data.error], ['OPEN_SUBTASKS', 2, 'Finish the 2 open subtasks first']);
  for (const status of ['closed', 'pending_approval']) assert.equal((await setStatus(status, ids.tokenManager)).status, 409, status);
  assert.equal((await setStatus('in_progress')).status, 200, 'other statuses are fine');

  const bulk = await api('/api/tasks/bulk', { method: 'POST', token: ids.tokenManager, body: { ids: [Number(id)], action: 'status', status: 'completed' } });
  assert.equal(bulk.status, 409);

  const [a, b] = (await subtasksOf(id, ids.tokenEnabled)).data;
  const ticked = await api(`/api/tasks/${id}/subtasks/${a.id}`, { method: 'PUT', token: ids.tokenEnabled, body: { done: true } });
  assert.equal(ticked.status, 200, JSON.stringify(ticked.data));
  assert.deepEqual([ticked.data.subtasks[0].done, ticked.data.subtasks[0].done_by_name, ticked.data.task.status], [true, 'Engineer Enabled', 'in_progress']);
  assert.equal((await setStatus('completed')).data.error, 'Finish the 1 open subtask first');
  // The last subtask done completes the task, with its completion time.
  const last = await api(`/api/tasks/${id}/subtasks/${b.id}`, { method: 'PUT', token: ids.tokenEnabled, body: { done: true } });
  assert.equal(last.data.task.status, 'completed');
  const stored = await db.prepare('SELECT status, completed_at FROM tasks WHERE id = ?').get(id);
  assert.equal(stored.status, 'completed'); assert.ok(stored.completed_at);
  // Opening one again puts it back in progress.
  const unticked = await api(`/api/tasks/${id}/subtasks/${b.id}`, { method: 'PUT', token: ids.tokenManager, body: { done: false } });
  assert.deepEqual([unticked.data.subtasks[1].done, unticked.data.subtasks[1].done_by_name, unticked.data.task.status], [false, null, 'in_progress']);
  assert.equal((await db.prepare('SELECT completed_at FROM tasks WHERE id = ?').get(id)).completed_at, null);
  // Removing the last open subtask completes it too; adding one reopens it.
  assert.equal((await api(`/api/tasks/${id}/subtasks/${b.id}`, { method: 'DELETE', token: ids.tokenManager })).data.task.status, 'completed');
  assert.equal((await api(`/api/tasks/${id}/subtasks`, { method: 'POST', token: ids.tokenManager, body: { title: 'One more' } })).data.task.status, 'in_progress');
});

test('people working on the task manage its subtasks; others cannot', async () => {
  const id = (await newTask({ team_id: ids.teamEnabled })).data.id;
  const add = (body, token = ids.tokenEnabled) => api(`/api/tasks/${id}/subtasks`, { method: 'POST', token, body });
  const one = await add({ title: 'Check the UPS' });
  assert.equal(one.status, 201, 'a team task: anyone in the team');
  const several = await add({ items: [{ title: 'Upgrade SRV-01', asset_id: asset.id }, 'Write the report'] });
  assert.deepEqual(several.data.subtasks.map(s => s.title), ['Check the UPS', 'Upgrade SRV-01', 'Write the report']);
  assert.equal((await add({ title: 'Nope' }, ids.tokenDisabled)).status, 403, 'not their team');
  assert.equal((await subtasksOf(id, ids.tokenDisabled)).status, 403);
  assert.equal((await add({ title: '' })).status, 400);
  const renamed = await api(`/api/tasks/${id}/subtasks/${several.data.subtasks[2].id}`, { method: 'PUT', token: ids.tokenEnabled, body: { title: 'Send the report' } });
  assert.equal(renamed.data.subtasks[2].title, 'Send the report');
  const removed = await api(`/api/tasks/${id}/subtasks/${several.data.subtasks[0].id}`, { method: 'DELETE', token: ids.tokenManager });
  assert.equal(removed.data.subtasks.length, 2);
  assert.equal((await api(`/api/tasks/${id}/subtasks/999999`, { method: 'DELETE', token: ids.tokenManager })).status, 404);

  const rows = (await api(`/api/customers/${ids.customer}/operations/tasks?filter=open`, { token: ids.tokenManager })).data.rows;
  assert.deepEqual([rows.find(r => r.id === Number(id)).subtasks_total, rows.find(r => r.id === Number(id)).subtasks_done], [2, 0]);
  const copy = await api(`/api/tasks/${id}/duplicate`, { method: 'POST', token: ids.tokenManager });
  assert.deepEqual((await subtasksOf(copy.data.id)).data.map(s => [s.title, s.done]), [['Upgrade SRV-01', false], ['Send the report', false]]);
});

test('a recurring task carries a checklist into each task it creates', async () => {
  const base = `/api/customers/${ids.customer}/recurring-tasks`;
  const bad = await api(base, { method: 'POST', token: ids.tokenManager, body: { title: 'Patch round', frequency: 'monthly', start_date: appTime.today(), lead_days: 3, assigned_to: ids.engineerEnabled, subtasks: ['ok', ''] } });
  assert.equal(bad.status, 400);
  const made = await api(base, { method: 'POST', token: ids.tokenManager, body: { title: 'Patch round', frequency: 'monthly', start_date: appTime.today(), lead_days: 3, assigned_to: ids.engineerEnabled, subtasks: ['Firewalls', 'Servers'] } });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.deepEqual(made.data.subtasks, ['Firewalls', 'Servers']);
  const task = await db.prepare('SELECT id FROM tasks WHERE recurring_task_id = ?').get(made.data.id);
  assert.deepEqual((await subtasksOf(task.id)).data.map(s => s.title), ['Firewalls', 'Servers']);
});

test('a task may name a ticket; a ticket of the same customer is linked', async () => {
  const ticket = (customer, number, subject) => db.prepare(`INSERT INTO external_tickets (customer_id, external_queue_id, external_queue_name, external_ticket_id, ticket_number, subject, external_status, normalized_status, status_group, external_url)
    VALUES (?, 'q1', 'Support', ?, ?, ?, 'open', 'open', 'open', ?)`).run(customer, `${customer}-${number}`, number, subject, `https://rt.example.com/Ticket/Display.html?id=${number}`);
  await ticket(ids.customer, '5001', 'Firewall upgrade request');
  await ticket(ids.customerUnassigned, '5002', 'Another customer');
  const made = await newTask({ assigned_to: ids.engineerEnabled, ticket_reference: 'RT#5001' });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  const plain = await newTask({ title: 'No ticket at all' });
  assert.equal(plain.status, 200, 'a ticket is never required');
  assert.equal((await newTask({ ticket_reference: 'x'.repeat(51) })).status, 400);

  const rows = (await api(`/api/customers/${ids.customer}/operations/tasks?filter=open&search=5001`, { token: ids.tokenManager })).data.rows;
  assert.deepEqual(rows.map(r => [r.id, r.ticket_reference, r.ticket?.subject, r.ticket?.url]),
    [[Number(made.data.id), 'RT#5001', 'Firewall upgrade request', 'https://rt.example.com/Ticket/Display.html?id=5001']]);

  // An engineer working on it changes the reference; another customer's ticket is not linked.
  assert.equal((await api(`/api/tasks/${made.data.id}`, { method: 'PUT', token: ids.tokenEnabled, body: { ticket_reference: '5002' } })).status, 200);
  const after = (await api(`/api/customers/${ids.customer}/operations/tasks?filter=open&search=5002`, { token: ids.tokenManager })).data.rows[0];
  assert.deepEqual([after.ticket_reference, after.ticket], ['5002', undefined]);
  // A status change alone keeps it; a manager clears it.
  await api(`/api/tasks/${made.data.id}`, { method: 'PUT', token: ids.tokenEnabled, body: { status: 'in_progress' } });
  assert.equal((await db.prepare('SELECT ticket_reference FROM tasks WHERE id = ?').get(made.data.id)).ticket_reference, '5002');
  await api(`/api/tasks/${made.data.id}`, { method: 'PUT', token: ids.tokenManager, body: { ticket_reference: null } });
  assert.equal((await db.prepare('SELECT ticket_reference FROM tasks WHERE id = ?').get(made.data.id)).ticket_reference, null);
});
