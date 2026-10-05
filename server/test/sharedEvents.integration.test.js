const { test, assert, api, db, ids } = require('./lib/activityFixture');
const notifications = require('../notifications');

const posts = [];
async function shareTo(notifyOn = {}) {
  await db.prepare("INSERT INTO settings (key,value) VALUES ('integrations',?) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value")
    .run(JSON.stringify({ webex: { enabled: true, bot_token: 'shared-token', mode: 'space', space_id: 'team-space' }, notify_on: notifyOn }));
}
// Shared posts are fire-and-forget; give them a moment to land.
async function settle(count) {
  for (let i = 0; i < 50 && posts.length < count; i++) await new Promise(resolve => setTimeout(resolve, 20));
  await new Promise(resolve => setTimeout(resolve, 30));
}

test.beforeEach(() => {
  posts.length = 0;
  notifications._setTransport(async (url, data) => { posts.push(JSON.parse(data)); return { status: 200, body: '{}', headers: {} }; });
});
test.after(() => notifications._setTransport());

test('shared events respect each switch and its default', async () => {
  await shareTo();
  const base = { customer_id: ids.customer, activity_date: '2026-10-01', category_id: ids.category, title: 'Firewall check' };
  assert.equal((await api('/api/service-activities', { method: 'POST', token: ids.tokenEnabled, body: base })).status, 200);
  await settle(1);
  assert.equal(posts.length, 0, 'a logged activity is off by default');

  await shareTo({ activity_logged: true });
  assert.equal((await api('/api/service-activities', { method: 'POST', token: ids.tokenEnabled, body: { ...base, title: 'Switch upgrade' } })).status, 200);
  await settle(1);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].roomId, 'team-space');
  assert.match(posts[0].markdown, /Switch upgrade/);

  posts.length = 0;
  const path = `/api/customers/${ids.customer}/recommendations`;
  const recommendation = { finding: 'Unsupported firmware', recommendation: 'Upgrade the firmware', owner_id: ids.manager, due_date: '2026-11-01' };
  assert.equal((await api(path, { method: 'POST', token: ids.tokenManager, body: { ...recommendation, risk_level: 'low' } })).status, 201);
  assert.equal((await api(path, { method: 'POST', token: ids.tokenManager, body: { ...recommendation, risk_level: 'critical' } })).status, 201);
  await settle(1);
  assert.equal(posts.length, 1, 'only high and critical recommendations are posted');
  assert.match(posts[0].markdown, /Critical-risk recommendation/);

  posts.length = 0;
  await shareTo({ recommendation_created: false });
  assert.equal((await api(path, { method: 'POST', token: ids.tokenManager, body: { ...recommendation, risk_level: 'high' } })).status, 201);
  await settle(1);
  assert.equal(posts.length, 0, 'a switched-off event is not posted');
});

test('scheduled shared events are posted once per occasion and never throw', async () => {
  await shareTo();
  const msg = { title: 'Report due', body: 'The September report is due.' };
  assert.equal(await notifications.notifyShared('customer_report_due', msg, { dedupeKey: '1:2026-09:due' }), true);
  assert.equal(await notifications.notifyShared('customer_report_due', msg, { dedupeKey: '1:2026-09:due' }), false);
  assert.equal(await notifications.notifyShared('customer_report_due', msg, { dedupeKey: '1:2026-09:overdue' }), true);
  assert.equal(posts.length, 2);
  assert.equal(await notifications.notifyShared('not_an_event', msg), false);
  notifications._setTransport(async () => { throw new Error('network down'); });
  assert.equal(await notifications.notifyShared('ticket_sync_failed', msg), false);
});

test('ticket sync alerts when a customer starts failing and when it recovers, not on every failed run', async () => {
  await shareTo();
  await db.prepare("INSERT INTO settings (key,value) VALUES ('ticketing_rt',?) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value").run(JSON.stringify({ enabled: true, base_url: 'https://rt.example.test/rt', sync_interval_minutes: 5 }));
  const customer = (await db.prepare('INSERT INTO customers (name) VALUES (?)').run('Sync alert customer')).lastInsertRowid;
  await db.prepare(`INSERT INTO customer_ticketing_configurations (customer_id,provider_type,external_queue_id,external_queue_name,enabled,include_in_reporting)
    VALUES (?,'request_tracker','77','Alert queue',1,1)`).run(customer);
  const { syncCustomer } = require('../ticketSync');
  const broken = { getTickets: async () => { throw Object.assign(new Error('RT unreachable'), { status: 502 }); } };
  const count = async () => Number((await db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND type='ticket_sync_failed'").get(ids.manager)).n);
  // Bell entries are written in the background too; wait for the expected number.
  const bell = async expected => { for (let i = 0; i < 100 && await count() < expected; i++) await new Promise(resolve => setTimeout(resolve, 20)); return count(); };
  await assert.rejects(syncCustomer(customer, { provider: broken }));
  await settle(1);
  assert.equal(posts.length, 1);
  assert.match(posts[0].markdown, /could not be synchronised[\s\S]*RT unreachable/);
  assert.equal(await bell(1), 1, 'managers get it on their bell too');
  posts.length = 0;
  await assert.rejects(syncCustomer(customer, { provider: broken }));
  await assert.rejects(syncCustomer(customer, { provider: broken }));
  await settle(1);
  assert.equal(posts.length, 0, 'retries while still failing stay quiet');
  await syncCustomer(customer, { provider: { getTickets: async () => [] } });
  await settle(1);
  assert.equal(posts.length, 1);
  assert.match(posts[0].markdown, /working again/);
  assert.equal(await bell(2), 2);
});

test('people can choose the new alerts for their own channels', async () => {
  const { eventPreferences } = require('../notifications');
  const manager = Object.keys(eventPreferences(null, 'manager'));
  const engineer = Object.keys(eventPreferences(null, 'engineer'));
  for (const key of ['project_closure', 'managed_report_review', 'recommendation_assigned', 'visit_report_approved', 'ticket_sync_failed']) assert.ok(manager.includes(key), key);
  assert.ok(!engineer.includes('ticket_sync_failed'));
  // A high-risk recommendation assigned to someone else reaches them.
  await shareTo({ recommendation_created: false });
  const before = (await db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND type='recommendation_assigned'").get(ids.engineerEnabled)).n;
  assert.equal((await api(`/api/customers/${ids.customer}/recommendations`, { method: 'POST', token: ids.tokenManager,
    body: { finding: 'Expired certificate', recommendation: 'Renew it', owner_id: ids.engineerEnabled, risk_level: 'high', due_date: '2026-11-01' } })).status, 201);
  await new Promise(resolve => setTimeout(resolve, 100));
  const after = (await db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND type='recommendation_assigned'").get(ids.engineerEnabled)).n;
  assert.equal(Number(after), Number(before) + 1);
});
