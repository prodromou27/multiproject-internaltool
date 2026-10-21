// A customer has any number of contacts, one primary; customers export with their contacts.
const { test, assert, api, db, ids } = require('./lib/activityFixture');
const fixture = require('./lib/activityFixture');

const contactsOf = id => api(`/api/customers/${id}/contacts`, { token: ids.tokenManager });
const add = (id, body, token = ids.tokenManager) => api(`/api/customers/${id}/contacts`, { method: 'POST', token, body });
const download = async (query, token = ids.tokenManager) => {
  const res = await fetch(`${fixture.baseUrl}/api/customers/export?${query}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, type: res.headers.get('content-type'), body: Buffer.from(await res.arrayBuffer()) };
};

test('the customer form\'s contact is the primary contact; more contacts are added, one is primary, and the customer follows it', async () => {
  const made = await api('/api/customers', { method: 'POST', token: ids.tokenManager, body: { name: 'Contoso Logistics', contact_name: 'Maria Ioannou', contact_email: 'maria@contoso.example', contact_phone: '+357 22 000001' } });
  const id = made.data.id;
  let list = (await contactsOf(id)).data;
  assert.deepEqual(list.map(c => [c.name, c.email, c.is_primary]), [['Maria Ioannou', 'maria@contoso.example', true]]);

  assert.equal((await add(id, { role: 'IT' })).status, 400, 'a name or an email');
  assert.equal((await add(id, { name: 'Nick', email: 'not-an-email' })).status, 400);
  assert.equal((await add(id, { name: 'Nick' }, ids.tokenEnabled)).status, 403, 'engineers do not change contacts');
  const second = await add(id, { name: 'Nick Georgiou', role: 'IT manager', email: 'nick@contoso.example', phone: '+357 22 000002' });
  assert.equal(second.status, 201, JSON.stringify(second.data));
  assert.deepEqual(second.data.contacts.map(c => [c.name, c.is_primary]), [['Maria Ioannou', true], ['Nick Georgiou', false]]);

  // Nick becomes the primary: the customer's own contact follows (reports, search, visits use it).
  const promoted = await api(`/api/customers/${id}/contacts/${second.data.id}`, { method: 'PUT', token: ids.tokenManager, body: { is_primary: true } });
  assert.equal(promoted.status, 200, JSON.stringify(promoted.data));
  assert.deepEqual(promoted.data.contacts.map(c => [c.name, c.is_primary]), [['Nick Georgiou', true], ['Maria Ioannou', false]]);
  const customer = (await api(`/api/customers/${id}`, { token: ids.tokenManager })).data;
  assert.deepEqual([customer.contact_name, customer.contact_email, customer.contact_phone], ['Nick Georgiou', 'nick@contoso.example', '+357 22 000002']);
  const stored = await db.prepare('SELECT name FROM customer_contacts WHERE id = ?').get(second.data.id);
  if (process.env.CUSTOMER_FIELD_KEY) assert.match(stored.name, /^enc:/, 'stored encrypted');

  // The customer form edits the primary contact.
  const edited = await api(`/api/customers/${id}`, { method: 'PUT', token: ids.tokenManager, body: { contact_email: 'nick.g@contoso.example', version: customer.edit_version } });
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  list = (await contactsOf(id)).data;
  assert.equal(list.find(c => c.is_primary).email, 'nick.g@contoso.example');

  // Removing the primary makes the oldest remaining one primary.
  const removed = await api(`/api/customers/${id}/contacts/${second.data.id}`, { method: 'DELETE', token: ids.tokenManager });
  assert.deepEqual(removed.data.contacts.map(c => [c.name, c.is_primary]), [['Maria Ioannou', true]]);
  assert.equal((await api(`/api/customers/${id}`, { token: ids.tokenManager })).data.contact_name, 'Maria Ioannou');

  // An engineer who works with the customer reads its contacts.
  assert.equal((await api(`/api/customers/${ids.customer}/contacts`, { token: ids.tokenEnabled })).status, 200);
  assert.equal((await api(`/api/customers/${ids.customer}/contacts`, { token: ids.tokenDisabled })).status, 403);
});

test('customers export to CSV or Excel, with the primary contact or every contact, for managers and planners only', async () => {
  const made = await api('/api/customers', { method: 'POST', token: ids.tokenManager, body: { name: 'Export Test Ltd', project_name: 'Atlas', location: 'Nicosia', contact_name: 'Anna', contact_email: 'anna@export.example' } });
  await add(made.data.id, { name: '=HYPERLINK("http://evil")', email: 'two@export.example', role: 'Finance' });

  const csv = await download('format=csv&contacts=primary');
  assert.equal(csv.status, 200);
  assert.match(csv.type, /text\/csv/);
  const text = csv.body.toString('utf8');
  assert.ok(text.startsWith('﻿Customer,Project name,Status,In-house,Teams,Location,Address,Primary contact,Role,Email,Phone,Other contacts'), text.slice(0, 120));
  assert.match(text, /Export Test Ltd,Atlas,Active,No,,Nicosia,,Anna,,anna@export\.example,,1\r\n/);

  const all = (await download('format=csv&contacts=all')).body.toString('utf8');
  const lines = all.split('\r\n').filter(line => line.startsWith('Export Test Ltd'));
  assert.equal(lines.length, 2, 'one row per contact');
  assert.ok(lines.some(line => line.includes(`"'=HYPERLINK(""http://evil"")"`)), 'a formula is written as text');

  const xlsx = await download('format=xlsx&contacts=all');
  assert.equal(xlsx.status, 200);
  assert.equal(xlsx.body.subarray(0, 2).toString(), 'PK', 'an Excel workbook');

  assert.equal((await download('format=pdf')).status, 400);
  assert.equal((await download('format=csv', ids.tokenEnabled)).status, 403, 'engineers cannot export customer contacts');

  // Archived customers only when asked.
  await api(`/api/customers/${made.data.id}/archive`, { method: 'POST', token: ids.tokenManager });
  assert.ok(!(await download('format=csv')).body.toString('utf8').includes('Export Test Ltd'));
  assert.match((await download('format=csv&archived=1')).body.toString('utf8'), /Export Test Ltd,Atlas,Archived/);
  assert.ok(Number((await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'customers_exported'").get()).n) >= 5, 'each export is audited');
});
