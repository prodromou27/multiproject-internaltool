// Guided visit completion: reusable checklists, kept on each visit (enhancement E03).
const { test, assert, api, db, ids } = require('./lib/activityFixture');

let template, visit;
test('managers keep reusable visit checklists; everyone can read them', async () => {
  const add = (body, token = ids.tokenManager) => api('/api/visit-checklists', { method: 'POST', token, body });
  assert.equal((await add({ name: 'Firewall health', items: ['Check HA'] }, ids.tokenEnabled)).status, 403);
  assert.equal((await add({ name: 'Firewall health', items: [] })).status, 400);
  const made = await add({ name: 'Firewall health', items: ['Check HA status', '  ', 'Review logs for errors', 'Confirm backup taken'] });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.deepEqual(made.data.items, ['Check HA status', 'Review logs for errors', 'Confirm backup taken'], 'blank lines dropped');
  template = made.data;
  const read = await api('/api/visit-checklists', { token: ids.tokenEnabled });
  assert.deepEqual(read.data.rows.map(r => r.name), ['Firewall health']);
  assert.equal(read.data.can_edit, false);
});

test('the engineers on a visit record the checklist; others cannot; it comes back with the visit', async () => {
  visit = (await db.prepare("INSERT INTO maintenance_visits (customer_id, title, scheduled_date, status, created_by) VALUES (?, 'Quarterly check', '2026-10-15', 'scheduled', ?)").run(ids.customer, ids.manager)).lastInsertRowid;
  await db.prepare('INSERT INTO maintenance_visit_engineers (visit_id, user_id) VALUES (?, ?)').run(visit, ids.engineerEnabled);
  const checklist = { name: template.name, items: [
    { text: 'Check HA status', result: 'ok' },
    { text: 'Review logs for errors', result: 'issue', note: 'Disk warnings on node 2' },
    { text: 'Confirm backup taken', result: 'open' },
  ] };
  const put = (body, token) => api(`/api/maintenance-visits/${visit}/checklist`, { method: 'PUT', token, body });
  const saved = await put({ checklist }, ids.tokenEnabled);
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.checklist.updated_by, 'Engineer Enabled');
  assert.equal((await put({ checklist: { ...checklist, items: [{ text: 'x', result: 'maybe' }] } }, ids.tokenEnabled)).status, 400);
  assert.equal((await put({ checklist: { name: '', items: [] } }, ids.tokenManager)).status, 400);

  const opened = await api(`/api/maintenance-visits/${visit}`, { token: ids.tokenEnabled });
  assert.deepEqual(opened.data.checklist.items.map(i => i.result), ['ok', 'issue', 'open']);
  assert.equal(opened.data.checklist.items[1].note, 'Disk warnings on node 2');

  // Changing the template later does not rewrite a visit that used it.
  assert.equal((await api(`/api/visit-checklists/${template.id}`, { method: 'PUT', token: ids.tokenManager, body: { name: 'Firewall health v2', items: ['Only this'] } })).status, 200);
  assert.equal((await api(`/api/maintenance-visits/${visit}`, { token: ids.tokenManager })).data.checklist.name, 'Firewall health');
});

test('an engineer who is not on the visit cannot fill it in; a cancelled visit takes no checklist', async () => {
  const other = (await db.prepare("INSERT INTO users (name, email, password, role) VALUES ('Other Engineer', 'other.checklist@test.local', 'x', 'engineer') RETURNING id").get()).id;
  const otherToken = require('./lib/activityFixture').signJwt({ id: other });
  const body = { checklist: { name: 'X', items: [{ text: 'Y' }] } };
  assert.equal((await api(`/api/maintenance-visits/${visit}/checklist`, { method: 'PUT', token: otherToken, body })).status, 403);
  await db.prepare("UPDATE maintenance_visits SET status = 'cancelled' WHERE id = ?").run(visit);
  assert.equal((await api(`/api/maintenance-visits/${visit}/checklist`, { method: 'PUT', token: ids.tokenManager, body })).status, 400);
});
