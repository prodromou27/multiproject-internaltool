const { test, assert, api, db, ids, bcrypt } = require('./lib/activityFixture');
const appTime = require('../appTime');
const owners = require('../ticketOwners');
const { RequestTrackerProvider } = require('../ticketing/requestTrackerProvider');

const today = appTime.today();
const ago = days => `${appTime.addDays(today, -days)}T10:00:00Z`;
const ticket = (id, queue, status, resolvedDaysAgo, tookDays = 2) => ({
  id: String(id), Subject: `Ticket ${id}`, Status: status, Queue: { id: '9', Name: queue },
  Created: resolvedDaysAgo === null ? ago(5) : ago(resolvedDaysAgo + tookDays),
  ...(resolvedDaysAgo === null ? {} : { Resolved: ago(resolvedDaysAgo) }),
});

test('TeamHub users are linked to RT users, and their tickets from every queue count', async () => {
  const nick = Number((await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)').run('Nick Network', 'nick@odyssey.example', bcrypt.hashSync('pw', 4), 'engineer')).lastInsertRowid);
  // A customer queue ticket, so its customer is named in the workload.
  await db.prepare(`INSERT INTO external_tickets (customer_id, provider_type, external_queue_id, external_queue_name, external_ticket_id, ticket_number, subject, external_status, normalized_status, status_group, owner_external_id)
    VALUES (?, 'request_tracker', '9', 'Acme Support', '1', '1', 'Ticket 1', 'resolved', 'Resolved', 'closed', 'nnetwork')`).run(ids.customer);

  // Every active user can be linked, customer or not.
  const links = await api('/api/ticketing/user-links', { token: ids.tokenManager });
  assert.equal(links.status, 200);
  assert.ok(links.data.rows.some(row => row.id === nick && row.rt_username === null));
  assert.equal((await api('/api/ticketing/user-links', { token: ids.tokenEnabled })).status, 403);

  const linked = await api(`/api/ticketing/user-links/${nick}`, { method: 'PUT', token: ids.tokenManager, body: { rt_username: 'nnetwork' } });
  assert.equal(linked.status, 200, JSON.stringify(linked.data));
  assert.equal(linked.data.rows.find(row => row.id === nick).rt_username, 'nnetwork');
  assert.equal(Number((await db.prepare("SELECT owner_user_id FROM external_tickets WHERE external_ticket_id='1'").get()).owner_user_id), nick, 'customer-queue tickets get the engineer too');
  assert.equal((await api(`/api/ticketing/user-links/${ids.engineerEnabled}`, { method: 'PUT', token: ids.tokenManager, body: { rt_username: 'NNetwork' } })).status, 409, 'one RT user, one TeamHub user');
  assert.equal((await api(`/api/ticketing/user-links/${nick}`, { method: 'PUT', token: ids.tokenManager, body: { rt_username: 'Nobody' } })).status, 400);
  assert.ok((await db.prepare("SELECT id FROM background_jobs WHERE type='engineer_ticket_sync'").get()), 'linking starts reading their tickets');

  // Their tickets come from RT by owner, in any queue.
  const asked = [];
  const provider = { getOwnedTickets: async (username, options) => { asked.push([username, options.since]); return [
    ticket(1, 'Acme Support', 'resolved', 10, 1), ticket(2, 'Internal IT', 'resolved', 20, 3), ticket(3, 'Internal IT', 'rejected', 15),
    ticket(4, 'Internal IT', 'resolved', 120), ticket(5, 'Internal IT', 'open', null),
  ]; } };
  assert.deepEqual(await owners.syncEngineer(nick, { provider }), { tickets: 5 });
  assert.deepEqual(asked, [['nnetwork', owners.monthsBack(today, 13)]]);

  const three = await api('/api/workload/tickets?months=3', { token: ids.tokenManager });
  assert.equal(three.status, 200, JSON.stringify(three.data));
  const work = three.data.engineers.find(e => e.id === nick);
  assert.equal(work.resolved, 2, 'rejected and older tickets are not counted');
  assert.equal(work.open_now, 1);
  assert.equal(work.avg_days_to_resolve, 2);
  assert.deepEqual(work.customers.map(c => c.name).sort(), ['Acme Corp', 'Internal IT'], 'the customer for its queue, the RT queue otherwise');
  assert.ok(work.synced_at);
  assert.ok(three.data.unlinked_engineers >= 1);
  assert.equal((await api('/api/workload/tickets?months=6', { token: ids.tokenManager })).data.engineers.find(e => e.id === nick).resolved, 3);
  assert.equal((await api('/api/workload/tickets?months=5', { token: ids.tokenManager })).status, 400);
  assert.equal((await api('/api/workload/tickets', { token: ids.tokenEnabled })).status, 403);

  // A failed read is shown, and keeps what was read before.
  await assert.rejects(owners.syncEngineer(nick, { provider: { getOwnedTickets: async () => { throw Object.assign(new Error('Request Tracker returned HTTP 401'), { status: 502 }); } } }));
  const after = (await api('/api/ticketing/user-links', { token: ids.tokenManager })).data.rows.find(row => row.id === nick);
  assert.equal(after.sync_error, 'Request Tracker returned HTTP 401');
  assert.equal(after.resolved_3m, 2);

  // Unlinking removes them from the ticket workload.
  await api(`/api/ticketing/user-links/${nick}`, { method: 'PUT', token: ids.tokenManager, body: { rt_username: null } });
  assert.ok(!(await api('/api/workload/tickets?months=3', { token: ids.tokenManager })).data.engineers.some(e => e.id === nick));
});

test('RT lists its staff users and finds tickets by owner in every queue', async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    const body = url.pathname.endsWith('/users/privileged')
      ? { items: [{ id: 'mstavrou', Name: 'mstavrou', EmailAddress: 'Maria@Odyssey.example', RealName: 'Maria S' }, { id: 'old', Name: 'old', Disabled: 1 }, { id: 'Nobody', Name: 'Nobody' }], pages: 1 }
      : { items: [{ id: 5 }], pages: 1 };
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  };
  const rt = new RequestTrackerProvider({ base_url: 'https://rt.example', api_token: 'token' }, { fetchImpl, validateUrl: async () => {} });
  assert.deepEqual(await rt.getUsers(), [{ username: 'mstavrou', email: 'maria@odyssey.example', real_name: 'Maria S' }]);
  assert.equal((await rt.getOwnedTickets('mstavrou', { since: '2025-09-07' })).length, 1);
  assert.equal(calls[1].searchParams.get('query'), "Owner = 'mstavrou' AND (Status = '__Active__' OR Resolved >= '2025-09-07')");
  await assert.rejects(rt.getOwnedTickets("x' OR 1=1", { since: '2025-09-07' }), /Invalid/);
});

test('periods are counted back in calendar months', () => {
  assert.equal(owners.monthsBack('2026-10-07', 3), '2026-07-07');
  assert.equal(owners.monthsBack('2026-05-31', 3), '2026-02-28');
  assert.equal(owners.monthsBack('2026-01-15', 12), '2025-01-15');
});

test('the engineer summary adds up tickets, tasks, visits, activities and time for the period', async () => {
  const eng = Number(ids.engineerEnabled), day = appTime.addDays(today, -3), old = appTime.addDays(today, -200);
  await db.prepare("INSERT INTO tasks (title, status, customer_id, assigned_to, created_by, updated_at) VALUES ('Done task', 'completed', ?, ?, ?, ?)").run(ids.customer, eng, ids.manager, `${day} 10:00:00`);
  await db.prepare("INSERT INTO tasks (title, status, customer_id, assigned_to, created_by, updated_at) VALUES ('Old task', 'completed', ?, ?, ?, ?)").run(ids.customer, eng, ids.manager, `${old} 10:00:00`);
  await db.prepare("INSERT INTO tasks (title, status, assigned_to, created_by, deadline) VALUES ('Late task', 'open', ?, ?, ?)").run(eng, ids.manager, appTime.addDays(today, -1));
  const visit = (await db.prepare("INSERT INTO maintenance_visits (customer_id, title, scheduled_date, status, created_by) VALUES (?, 'Quarterly check', ?, 'completed', ?)").run(ids.customer, day, ids.manager)).lastInsertRowid;
  await db.prepare('INSERT INTO maintenance_visit_engineers (visit_id, user_id) VALUES (?, ?)').run(visit, eng);
  await db.prepare("INSERT INTO time_logs (user_id, hours, logged_at) VALUES (?, 1.5, ?)").run(eng, `${day} 09:00:00`);
  const res = await api('/api/workload/engineers?months=3', { token: ids.tokenManager });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const row = res.data.engineers.find(e => e.id === eng);
  assert.deepEqual(row.tasks, { done: 1, open: 1, overdue: 1 });
  assert.deepEqual(row.visits, { completed: 1, upcoming: 0 });
  assert.equal(row.logged_hours, 1.5);
  assert.equal(row.tickets.linked, false);
  assert.equal(row.customers[0].name, 'Acme Corp');
  assert.equal(row.by_month.reduce((sum, m) => sum + m.tasks, 0), 1);
  assert.equal((await api('/api/workload/engineers?months=2', { token: ids.tokenManager })).status, 400);
  assert.equal((await api('/api/workload/engineers', { token: ids.tokenEnabled })).status, 403);
});
