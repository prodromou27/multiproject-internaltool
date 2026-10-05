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
