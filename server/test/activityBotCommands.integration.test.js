// The bot's quick commands: tasks, today, what was logged, visits, and changing or adding a task.
const { test, assert, api, db, ids } = require('./lib/activityFixture');
const suite = require('./lib/activityFixture');
const appTime = require('../appTime');

const userRow = async id => db.prepare('SELECT id, name, email, role, token_version FROM users WHERE id = ?').get(id);
const say = async (userId, text) => {
  require('../activityBot/appApi').setBase(suite.baseUrl);
  return require('../activityBot/conversation').handleMessage({ user: await userRow(userId), channel: 'test-commands', text, appUrl: 'https://teamhub.example' });
};
const today = () => appTime.today();

// Engineers' task lists use a query pg-mem cannot run: PostgreSQL only (CI runs this suite there).
test('help lists the commands; tasks, overdue, today and a task\'s details are shown', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const help = await say(ids.engineerEnabled, 'help');
  assert.match(help, /\*\*tasks\*\*/);
  assert.match(help, /done 123/);

  const due = await api('/api/tasks', { method: 'POST', token: ids.tokenManager, body: { customer_id: ids.customer, title: 'Renew the SSL certificate', assigned_to: ids.engineerEnabled, deadline: today(), subtasks: ['Order it', 'Install it'] } });
  const late = await api('/api/tasks', { method: 'POST', token: ids.tokenManager, body: { customer_id: ids.customer, title: 'Replace the UPS battery', assigned_to: ids.engineerEnabled, deadline: appTime.addDays(today(), -3) } });
  const tasks = await say(ids.engineerEnabled, 'my tasks');
  assert.match(tasks, /Your open tasks/);
  assert.ok(tasks.includes(`#${due.data.id}** Renew the SSL certificate · Acme Corp`), tasks);
  const overdue = await say(ids.engineerEnabled, 'overdue');
  assert.ok(overdue.includes(`#${late.data.id}** Replace the UPS battery`) && overdue.includes('⚠️'), overdue);

  const detail = await say(ids.engineerEnabled, `task ${due.data.id}`);
  assert.match(detail, /Status: Open/);
  assert.match(detail, /Who: Engineer Enabled/);
  assert.match(detail, /Subtasks: 0 of 2 done/);
  assert.ok(detail.includes(`https://teamhub.example/customers/${ids.customer}/service-profile?section=tasks&task=${due.data.id}`), detail);
  assert.match(await say(ids.engineerEnabled, '#999999'), /can't find that task/);
  assert.match(await say(ids.engineerDisabled, `task ${due.data.id}`), /can't do that|can't find/, 'not their customer');

  assert.match(await say(ids.engineerEnabled, 'visits'), /visits/i);
  const day = await say(ids.engineerEnabled, 'today');
  assert.match(day, /Due today \(\d+\)/);
  assert.match(day, /Overdue/);
});

test('a task is started, put on hold for the customer, updated and completed from the chat; subtasks still rule', async () => {
  const made = await api('/api/tasks', { method: 'POST', token: ids.tokenManager, body: { customer_id: ids.customer, title: 'Firewall migration', assigned_to: ids.engineerEnabled, subtasks: ['Export rules'] } });
  const id = made.data.id;
  assert.match(await say(ids.engineerEnabled, `start ${id}`), /is now in progress/);
  assert.match(await say(ids.engineerEnabled, `waiting ${id} the customer sends the change window`), /waiting for the customer: the customer sends the change window/);
  let row = await db.prepare('SELECT status, pending_from_customer FROM tasks WHERE id = ?').get(id);
  assert.deepEqual([row.status, row.pending_from_customer], ['waiting_customer', 'the customer sends the change window']);
  assert.match(await say(ids.engineerEnabled, `waiting ${id}`), /What are you waiting for/);

  assert.match(await say(ids.engineerEnabled, `update ${id}: rules exported, migrating tonight`), /Update posted on \*\*#/);
  assert.equal((await db.prepare('SELECT message FROM task_comments WHERE task_id = ? ORDER BY id DESC').get(id)).message, 'rules exported, migrating tonight');

  assert.match(await say(ids.engineerEnabled, `done ${id}`), /couldn't do that: Finish the 1 open subtask first/);
  await db.prepare('UPDATE task_subtasks SET done = 1 WHERE task_id = ?').run(id);
  assert.match(await say(ids.engineerEnabled, `done ${id}`), /is now completed/);
  assert.equal((await db.prepare('SELECT status FROM tasks WHERE id = ?').get(id)).status, 'completed');

  // Someone else's task cannot be changed.
  const theirs = await api('/api/tasks', { method: 'POST', token: ids.tokenManager, body: { customer_id: ids.customer, title: 'Not mine', assigned_to: ids.engineerDisabled } });
  assert.match(await say(ids.engineerEnabled, `done ${theirs.data.id}`), /isn't one you work on/);
});

test('a new task is added for a customer with a due date in plain words', async () => {
  const reply = await say(ids.engineerEnabled, 'new task Renew the support contract for Acme due tomorrow');
  assert.match(reply, /✅ Task \*\*#\d+ Renew the support contract\*\* added for Acme Corp, due .*, assigned to you/);
  const id = Number(reply.match(/#(\d+)/)[1]);
  const row = await db.prepare('SELECT title, customer_id, assigned_to, deadline FROM tasks WHERE id = ?').get(id);
  assert.deepEqual([row.title, row.customer_id, row.assigned_to, row.deadline], ['Renew the support contract', ids.customer, ids.engineerEnabled, appTime.addDays(today(), 1)]);
  assert.match(await say(ids.engineerEnabled, 'new task Check the backups due someday'), /didn't understand the due date "someday"/);
  assert.match(await say(ids.engineerEnabled, 'new task Check the backups'), /Which customer is it for/);
});

test('logged and week show what the person logged, with the hours', async () => {
  const body = { customer_id: ids.customer, activity_date: today(), category_id: ids.category, title: 'Patched the firewall', duration_minutes: 90 };
  assert.equal((await api('/api/service-activities', { method: 'POST', token: ids.tokenEnabled, body })).status, 200);
  const logged = await say(ids.engineerEnabled, 'logged');
  assert.match(logged, /Logged today\*\*: \d+ activit/);
  assert.match(logged, /Acme Corp/);
  assert.match(await say(ids.engineerEnabled, 'week'), /This week\*\*: \d+ activit/);
});
