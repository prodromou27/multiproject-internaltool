const { test, assert, db, ids } = require('./lib/activityFixture');
const suite = require('./lib/activityFixture');
const appTime = require('../appTime');

const conversation = () => require('../activityBot/conversation');
const userRow = async id => db.prepare('SELECT id, name, email, role, token_version FROM users WHERE id = ?').get(id);
const say = async (userId, text) => {
  require('../activityBot/appApi').setBase(suite.baseUrl);
  return conversation().handleMessage({ user: await userRow(userId), channel: 'test', text, appUrl: 'https://teamhub.example' });
};

test('an engineer logs an activity by describing it, corrects it, and confirms', async () => {
  assert.match(await say(ids.engineerEnabled, 'help'), /Tell me what you did/);
  assert.match(await say(ids.engineerEnabled, 'yes'), /nothing waiting to be saved/);
  assert.match(await say(ids.engineerEnabled, 'the weather is lovely'), /didn't recognise a customer/);

  const draft = await say(ids.engineerEnabled, '45m support for Acme yesterday, ticket 4521, helped with the VPN client');
  assert.match(draft, /Customer: Acme Corp/);
  assert.match(draft, /Category: Support/);
  assert.match(draft, /Time: 45m/);
  assert.match(draft, /Ticket: 4521/);
  assert.match(draft, /Reply \*\*yes\*\* to save/);

  assert.match(await say(ids.engineerEnabled, 'make it 1h'), /Time: 1h\b/);
  assert.match(await say(ids.engineerEnabled, 'blah'), /didn't catch a change/);
  const saved = await say(ids.engineerEnabled, 'yes');
  assert.match(saved, /✅ Saved \*\*ACT-\d{4}-\d+\*\* for Acme Corp\.\nhttps:\/\/teamhub\.example\/activity-log\?activity=\d+/);
  const id = Number(saved.match(/activity=(\d+)/)[1]);
  const row = await db.prepare('SELECT customer_id, engineer_id, duration_minutes, ticket_reference, activity_date, description FROM service_activities WHERE id = ?').get(id);
  assert.deepEqual([row.customer_id, row.engineer_id, row.duration_minutes, row.ticket_reference, row.activity_date],
    [ids.customer, ids.engineerEnabled, 60, '4521', appTime.addDays(appTime.today(), -1)]);
  assert.match(row.description, /helped with the VPN client/);
  assert.match(await say(ids.engineerEnabled, 'yes'), /nothing waiting/, 'the draft is cleared once saved');
});

test('the bot asks when the customer is unclear, and offers numbered choices', async () => {
  const bank = (await db.prepare('INSERT INTO customers (name, active, service_activity_enabled) VALUES (?, 1, 1)').run('Contoso Bank')).lastInsertRowid;
  const hotels = (await db.prepare('INSERT INTO customers (name, active, service_activity_enabled) VALUES (?, 1, 1)').run('Contoso Hotels')).lastInsertRowid;
  for (const customer of [bank, hotels]) await db.prepare('INSERT INTO customer_teams (customer_id, team_id) VALUES (?, ?)').run(customer, ids.teamEnabled);

  const question = await say(ids.engineerEnabled, '30m support for Contoso');
  assert.match(question, /Which customer\?\n1\. Contoso (Bank|Hotels)\n2\. Contoso (Bank|Hotels)/);
  const pick = question.includes('2. Contoso Hotels') ? '2' : '1';
  assert.match(await say(ids.engineerEnabled, pick), /Customer: Contoso Hotels[\s\S]*Reply \*\*yes\*\*/);
  const saved = await say(ids.engineerEnabled, 'yes');
  const id = Number(saved.match(/activity=(\d+)/)[1]);
  assert.equal((await db.prepare('SELECT customer_id FROM service_activities WHERE id = ?').get(id)).customer_id, hotels);

  assert.match(await say(ids.engineerEnabled, '1h support for Contoso Bank'), /Customer: Contoso Bank/);
  assert.match(await say(ids.engineerEnabled, 'cancel'), /Discarded/);
  assert.match(await say(ids.engineerEnabled, 'yes'), /nothing waiting/);
});

test('the bot only works for people who may log activities, and only for their customers', async () => {
  assert.match(await say(ids.engineerDisabled, '1h support for Acme'), /can't log service activities/);
  // Other Corp is not assigned to the engineer's team: it is not even recognised.
  assert.match(await say(ids.engineerEnabled, '1h support for Other Corp'), /didn't recognise|Which customer/);
  await say(ids.engineerEnabled, 'cancel');
});
