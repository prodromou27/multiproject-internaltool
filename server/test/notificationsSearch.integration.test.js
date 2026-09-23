const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./lib/harness');

// Search runs correlated subqueries that pg-mem cannot execute; these run on the real database in CI.
const realDb = { skip: process.env.TEST_DATABASE_URL ? false : 'needs TEST_DATABASE_URL (pg-mem lacks correlated subqueries)' };

let h, manager, alice, bob;

test.before(async () => {
  h = await harness.start({
    '/api/notifications': require('../routes/notifications'),
    '/api/search': require('../routes/search'),
  });
  manager = await h.makeUser('Search Manager', 'manager');
  alice = await h.makeUser('Alice Engineer', 'engineer');
  bob = await h.makeUser('Bob Engineer', 'engineer');
});
test.after(() => h.stop());

async function seedNotification(userId, title) {
  return (await h.db.prepare('INSERT INTO notifications (user_id, type, title) VALUES (?, ?, ?)').run(userId, 'task.assigned', title)).lastInsertRowid;
}

test('notifications are private to their owner', async () => {
  const aliceNote = await seedNotification(alice.id, 'For Alice');
  await seedNotification(bob.id, 'For Bob');

  const list = await h.api('/api/notifications', { token: alice.token });
  assert.equal(list.status, 200);
  assert.deepEqual(list.data.notifications.map(n => n.title), ['For Alice']);
  assert.equal(list.data.unread, 1);

  // Bob cannot read-mark or delete Alice's notification by guessing its id.
  await h.api(`/api/notifications/${aliceNote}/read`, { method: 'PATCH', token: bob.token });
  await h.api(`/api/notifications/${aliceNote}`, { method: 'DELETE', token: bob.token });
  const after = await h.api('/api/notifications', { token: alice.token });
  assert.equal(after.data.notifications.length, 1);
  assert.equal(after.data.unread, 1);

  await h.api(`/api/notifications/${aliceNote}/read`, { method: 'PATCH', token: alice.token });
  assert.equal((await h.api('/api/notifications', { token: alice.token })).data.unread, 0);

  // "clear all" only clears the caller's own.
  await h.api('/api/notifications', { method: 'DELETE', token: alice.token });
  assert.equal((await h.api('/api/notifications', { token: alice.token })).data.notifications.length, 0);
  assert.equal((await h.api('/api/notifications', { token: bob.token })).data.notifications.length, 1);
  assert.equal((await h.api('/api/notifications')).status, 401);
});

test('notification filters, acknowledgements and pagination preserve actionable history',async () => {
  const high=(await h.db.prepare("INSERT INTO notifications (user_id,type,title,priority) VALUES (?,'managed_report.submitted','Review report','high')").run(alice.id)).lastInsertRowid;
  for (let index=1;index<=4;index++) await seedNotification(alice.id,`Routine ${index}`);
  assert.equal((await h.api('/api/notifications?status=bogus',{ token:alice.token })).status,400);
  assert.equal((await h.api('/api/notifications?page=0',{ token:alice.token })).status,400);
  const first=await h.api('/api/notifications?page_size=2',{ token:alice.token });
  assert.equal(first.status,200);assert.equal(first.data.notifications.length,2);assert.equal(first.data.total,5);assert.equal(first.data.pages,3);assert.equal(first.data.unread,5);assert.equal(first.data.action_required,1);
  const action=await h.api('/api/notifications?status=action_required',{ token:alice.token });
  assert.deepEqual(action.data.notifications.map(item => item.id),[high]);
  assert.equal((await h.api(`/api/notifications/${high}/acknowledge`,{ method:'PATCH',token:bob.token })).status,404);
  assert.equal((await h.api(`/api/notifications/${high}/acknowledge`,{ method:'PATCH',token:alice.token })).status,200);
  const acknowledged=await h.db.prepare('SELECT read,read_at,acknowledged_at FROM notifications WHERE id=?').get(high);
  assert.equal(acknowledged.read,1);assert.ok(acknowledged.read_at);assert.ok(acknowledged.acknowledged_at);
  assert.equal((await h.api('/api/notifications?status=action_required',{ token:alice.token })).data.total,0);
  await h.api(`/api/notifications/${high}`,{ method:'DELETE',token:alice.token });
  assert.ok((await h.db.prepare('SELECT dismissed_at FROM notifications WHERE id=?').get(high)).dismissed_at);
  assert.equal((await h.api('/api/notifications',{ token:alice.token })).data.total,4);
});

test('search treats % and _ literally and respects task visibility', realDb, async () => {
  const mk = (title, assignee) => h.db.prepare('INSERT INTO tasks (title, status, assigned_to, created_by) VALUES (?, ?, ?, ?)')
    .run(title, 'todo', assignee, manager.id);
  await mk('Rollout 100% complete', alice.id);
  await mk('Rollout 100 units', alice.id);
  await mk('Rollout_alpha', alice.id);
  await mk('RolloutXalpha', alice.id);
  await mk('Rollout secret', bob.id);

  const titles = async (q, user) => (await h.api(`/api/search?q=${encodeURIComponent(q)}`, { token: user.token }))
    .data.tasks.map(t => t.title).sort();

  assert.deepEqual(await titles('100%', alice), ['Rollout 100% complete']);
  assert.deepEqual(await titles('t_a', alice), ['Rollout_alpha']);
  assert.deepEqual(await titles('%%', alice), []);

  // Engineers only see their own tasks; managers see everything.
  assert.ok(!(await titles('Rollout', alice)).includes('Rollout secret'));
  assert.ok((await titles('Rollout', manager)).includes('Rollout secret'));

  assert.deepEqual((await h.api('/api/search?q=a', { token: alice.token })).data, { projects: [], tasks: [], customers: [] });
  assert.equal((await h.api(`/api/search?q=${'x'.repeat(201)}`, { token: alice.token })).status, 400);
  assert.equal((await h.api('/api/search/smart?entity=bogus', { token: alice.token })).status, 400);
  for (const query of ['page=0','page=1.5','page_size=0','page_size=51','page=9007199254740991&page_size=50'])
    assert.equal((await h.api(`/api/search/smart?entity=tasks&${query}`, { token:alice.token })).status,400);
});

test('smart search overdue filter uses the app date', realDb, async () => {
  const p = (title, deadline) => h.db.prepare("INSERT INTO projects (title, status, deadline, created_by) VALUES (?, 'in_progress', ?, ?)")
    .run(title, deadline, manager.id);
  await p('Old deadline project', '2000-01-01');
  await p('Far future project', '2999-01-01');
  const res = await h.api('/api/search/smart?entity=projects&overdue=1', { token: manager.token });
  assert.equal(res.status, 200);
  const names = (res.data.projects || []).map(x => x.title);
  assert.ok(names.includes('Old deadline project'));
  assert.ok(!names.includes('Far future project'));
  assert.deepEqual(res.data.pagination,{ page:1,page_size:25,has_more:{ projects:false,tasks:false,mv:false,customers:false } });
});
