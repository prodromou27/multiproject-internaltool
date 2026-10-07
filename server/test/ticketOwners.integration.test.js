const { test, assert, api, db, ids, bcrypt } = require('./lib/activityFixture');
const appTime = require('../appTime');
const { monthsBack } = require('../ticketOwners');

const today = appTime.today();
const ago = days => `${appTime.addDays(today, -days)}T10:00:00Z`;
const ticket = (id, owner, status, resolvedDaysAgo, tookDays = 2) => ({
  id: String(id), Subject: `Ticket ${id}`, Status: status, Priority: 'Normal', Owner: owner,
  Created: resolvedDaysAgo === null ? ago(5) : ago(resolvedDaysAgo + tookDays), LastUpdated: ago(1),
  ...(resolvedDaysAgo === null ? {} : { Resolved: ago(resolvedDaysAgo) }),
});

test('RT users are linked to TeamHub users, and engineers see the tickets they resolved', async () => {
  const nick = (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)').run('Nick Network', 'nick@odyssey.example', bcrypt.hashSync('pw', 4), 'engineer')).lastInsertRowid;
  await db.prepare("INSERT INTO settings (key,value) VALUES ('ticketing_rt',?) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value").run(JSON.stringify({ enabled: true, base_url: 'https://rt.example.test/rt', sync_interval_minutes: 60 }));
  await db.prepare("INSERT INTO customer_ticketing_configurations (customer_id,provider_type,external_queue_id,external_queue_name,enabled,include_in_reporting) VALUES (?,'request_tracker','77','Acme Support',1,1)").run(ids.customer);
  const nickRt = { id: 'nnetwork', Name: 'nnetwork', EmailAddress: 'Nick@Odyssey.example' };
  const mariaRt = { id: 'mstavrou', Name: 'mstavrou', EmailAddress: 'maria@personal.example' };
  const tickets = [
    ticket(1, nickRt, 'resolved', 10, 1), ticket(2, nickRt, 'resolved', 20, 3), ticket(3, nickRt, 'rejected', 15),
    ticket(4, nickRt, 'resolved', 120), ticket(5, nickRt, 'open', null),
    ticket(6, mariaRt, 'resolved', 12), ticket(7, { id: 'Nobody', Name: 'Nobody' }, 'resolved', 12),
  ];
  const { syncCustomer } = require('../ticketSync');
  await syncCustomer(ids.customer, { provider: { getTickets: async () => tickets } });

  // Nick is found by email; Maria's RT email is not her TeamHub one, so she needs linking.
  const owners = await api('/api/ticketing/owners', { token: ids.tokenManager });
  assert.equal(owners.status, 200);
  assert.equal((await api('/api/ticketing/owners', { token: ids.tokenEnabled })).status, 403);
  const nickRow = owners.data.rows.find(row => row.username === 'nnetwork');
  assert.deepEqual([nickRow.user_id, nickRow.linked_by, nickRow.tickets, nickRow.open_tickets], [Number(nick), 'email', 5, 1]);
  assert.equal(owners.data.rows.find(row => row.username === 'mstavrou').user_id, null);
  assert.ok(!owners.data.rows.some(row => row.username === 'Nobody'), 'unowned tickets are nobody');

  const linked = await api('/api/ticketing/owners', { method: 'PUT', token: ids.tokenManager, body: { username: 'mstavrou', user_id: Number(ids.engineerEnabled) } });
  assert.equal(linked.status, 200, JSON.stringify(linked.data));
  assert.equal(linked.data.rows.find(row => row.username === 'mstavrou').linked_by, 'chosen');
  assert.equal((await api('/api/ticketing/owners', { method: 'PUT', token: ids.tokenManager, body: { username: 'Nobody', user_id: Number(nick) } })).status, 400);

  const three = await api('/api/workload/tickets?months=3', { token: ids.tokenManager });
  assert.equal(three.status, 200, JSON.stringify(three.data));
  const nickWork = three.data.engineers.find(e => e.id === Number(nick));
  assert.equal(nickWork.resolved, 2, 'rejected and older tickets are not counted');
  assert.equal(nickWork.open_now, 1);
  assert.equal(nickWork.avg_days_to_resolve, 2);
  assert.equal(nickWork.customers[0].name, 'Acme Corp');
  assert.equal(nickWork.by_month.reduce((sum, m) => sum + m.count, 0), 2);
  assert.equal(three.data.engineers.find(e => e.id === Number(ids.engineerEnabled)).resolved, 1);
  assert.equal(three.data.unlinked.resolved, 0);
  assert.equal((await api('/api/workload/tickets?months=6', { token: ids.tokenManager })).data.engineers.find(e => e.id === Number(nick)).resolved, 3);
  assert.equal((await api(`/api/workload/tickets?months=12&user_id=${nick}`, { token: ids.tokenManager })).data.engineers.length, 1);
  assert.equal((await api('/api/workload/tickets?months=5', { token: ids.tokenManager })).status, 400);
  assert.equal((await api('/api/workload/tickets', { token: ids.tokenEnabled })).status, 403);

  // Unlinking Maria's choice puts her tickets back as unlinked.
  await api('/api/ticketing/owners', { method: 'PUT', token: ids.tokenManager, body: { username: 'mstavrou', user_id: null } });
  assert.equal((await api('/api/workload/tickets?months=3', { token: ids.tokenManager })).data.unlinked.resolved, 1);
});

test('periods are counted back in calendar months', () => {
  assert.equal(monthsBack('2026-10-07', 3), '2026-07-07');
  assert.equal(monthsBack('2026-05-31', 3), '2026-02-28');
  assert.equal(monthsBack('2026-01-15', 12), '2025-01-15');
});
