// A customer's project name: a nickname, stored encrypted, shown with the name and found by search.
process.env.CUSTOMER_FIELD_KEY = process.env.CUSTOMER_FIELD_KEY || 'c'.repeat(64);
const { test, assert, api, db, ids } = require('./lib/activityFixture');

let id;
test('a customer can have a project name; it is checked, stored encrypted and returned with the customer', async () => {
  const tooLong = await api('/api/customers', { method: 'POST', token: ids.tokenManager, body: { name: 'Meridian Telecom', project_name: 'x'.repeat(121) } });
  assert.equal(tooLong.status, 400);
  const made = await api('/api/customers', { method: 'POST', token: ids.tokenManager, body: { name: 'Meridian Telecom', project_name: '  Project Atlas  ' } });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  id = Number(made.data.id);

  const stored = await db.prepare('SELECT project_name FROM customers WHERE id = ?').get(id);
  assert.doesNotMatch(stored.project_name, /Atlas/, 'stored encrypted');
  assert.equal((await api(`/api/customers/${id}`, { token: ids.tokenManager })).data.project_name, 'Project Atlas', 'trimmed');
  const listed = (await api('/api/customers', { token: ids.tokenManager })).data.find(c => Number(c.id) === id);
  assert.equal(listed.project_name, 'Project Atlas');
  assert.equal((await api('/api/customers/' + ids.customer, { token: ids.tokenManager })).data.project_name, null, 'none set');
});

test('search finds a customer by its project name: the customer list and the search box', async () => {
  const page = await api('/api/customers?paged=1&search=atlas', { token: ids.tokenManager });
  assert.equal(page.status, 200);
  assert.deepEqual(page.data.rows.map(c => Number(c.id)), [id]);
  const quick = await api('/api/search?q=atlas', { token: ids.tokenManager });
  assert.ok(quick.data.customers.some(c => Number(c.id) === id && c.project_name === 'Project Atlas'), JSON.stringify(quick.data.customers));
});

test('editing keeps the project name unless it is changed, and clears it when emptied', async () => {
  assert.equal((await api(`/api/customers/${id}`, { method: 'PUT', token: ids.tokenManager, body: { contact_name: 'Dana' } })).status, 200);
  assert.equal((await api(`/api/customers/${id}`, { token: ids.tokenManager })).data.project_name, 'Project Atlas', 'kept');
  await api(`/api/customers/${id}`, { method: 'PUT', token: ids.tokenManager, body: { project_name: 'Orion' } });
  assert.equal((await api('/api/customers?paged=1&search=atlas', { token: ids.tokenManager })).data.rows.length, 0, 'the old name no longer matches');
  assert.equal((await api('/api/customers?paged=1&search=orion', { token: ids.tokenManager })).data.rows.length, 1);
  await api(`/api/customers/${id}`, { method: 'PUT', token: ids.tokenManager, body: { project_name: '' } });
  assert.equal((await api(`/api/customers/${id}`, { token: ids.tokenManager })).data.project_name, null);
});

test('the customer import sets the project name: on new customers, and on existing ones when the cell is filled', async () => {
  const fixture = require('./lib/activityFixture');
  const send = async (csv, updateExisting = false) => {
    const form = new FormData();
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'customers.csv');
    if (updateExisting) form.append('update_existing', '1');
    const res = await fetch(`${fixture.baseUrl}/api/customers/import`, { method: 'POST', headers: { Authorization: `Bearer ${ids.tokenManager}`, 'X-SolutionsHub-Request': '1' }, body: form });
    return { status: res.status, data: await res.json() };
  };
  const named = async name => (await api('/api/customers', { token: ids.tokenManager })).data.find(c => c.name === name);

  const created = await send('name,project_name,location\nHarbour Freight,Project Lighthouse,Larnaca\nQuay Systems,,Paphos\n');
  assert.equal(created.data.imported, 2, JSON.stringify(created.data));
  assert.equal((await named('Harbour Freight')).project_name, 'Project Lighthouse');
  assert.equal((await named('Quay Systems')).project_name, null);
  assert.equal((await api('/api/customers?paged=1&search=lighthouse', { token: ids.tokenManager })).data.rows.length, 1, 'searchable');
  assert.equal((await send(`name,project_name\nToo Long Ltd,${'x'.repeat(121)}\n`)).data.skipped, 1, 'at most 120 characters');

  // Updating: a filled cell changes it; an empty cell leaves it, and it stays searchable.
  const preview = new FormData();
  preview.append('file', new Blob(['name,project_name\nQuay Systems,Project Keel\nHarbour Freight,\n'], { type: 'text/csv' }), 'customers.csv');
  const planned = await (await fetch(`${fixture.baseUrl}/api/customers/import/preview`, { method: 'POST', headers: { Authorization: `Bearer ${ids.tokenManager}`, 'X-SolutionsHub-Request': '1' }, body: preview })).json();
  assert.deepEqual(planned.rows.map(r => [r.name, r.action, (r.changes || []).map(c => `${c.field}:${c.to}`)]),
    [['Quay Systems', 'update', ['project_name:Project Keel']], ['Harbour Freight', 'unchanged', []]]);
  const updated = await send('name,project_name\nQuay Systems,Project Keel\nHarbour Freight,\n', true);
  assert.equal(updated.data.updated, 1, JSON.stringify(updated.data));
  assert.equal((await named('Quay Systems')).project_name, 'Project Keel');
  assert.equal((await named('Harbour Freight')).project_name, 'Project Lighthouse');
  assert.equal((await api('/api/customers?paged=1&search=lighthouse', { token: ids.tokenManager })).data.rows.length, 1);
  assert.equal((await api('/api/customers?paged=1&search=keel', { token: ids.tokenManager })).data.rows.length, 1);
});
