const { test, assert, api, db, ids } = require('./lib/activityFixture');
const appTime = require('../appTime');

const today = appTime.today(), day = n => appTime.addDays(today, n);
const addContract = async (customer, reference, start, end, extra = {}) => {
  const res = await api(`/api/customers/${customer}/contracts`, { method: 'POST', token: ids.tokenManager, body: { reference, start_date: start, end_date: end, ...extra } });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data.id;
};
const alerts = async (type, user = ids.manager) => db.prepare('SELECT title, body, link FROM notifications WHERE user_id = ? AND type = ? ORDER BY id').all(user, type);

test('managers configure the contract types; contracts and imports use only those', async () => {
  const types = await api('/api/settings/contract-types', { token: ids.tokenManager });
  assert.deepEqual(types.data.types.map(t => t.name), ['24x7', '12x5', '8x5']);
  assert.equal((await api('/api/settings/contract-types', { token: ids.tokenEnabled })).status, 403);
  assert.equal((await api('/api/settings/contract-types', { method: 'PUT', token: ids.tokenPlanner, body: { types: ['x'] } })).status, 403);
  for (const bad of [{}, { types: 'x' }, { types: [''] }, { types: ['a'.repeat(31)] }, { types: ['24x7', '24X7'] }])
    assert.equal((await api('/api/settings/contract-types', { method: 'PUT', token: ids.tokenManager, body: bad })).status, 400, JSON.stringify(bad));

  const used = await addContract(ids.customerUnassigned, 'TYPE-OLD', day(-100), day(200), { service_level: '12x5' });
  const saved = await api('/api/settings/contract-types', { method: 'PUT', token: ids.tokenManager, body: { types: [' 24x7 ', '8x5', 'Business hours'] } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.deepEqual(saved.data.types.map(t => t.name), ['24x7', '8x5', 'Business hours']);
  assert.deepEqual(saved.data.no_longer_offered, [{ name: '12x5', contracts: 1 }], 'a removed type still in use is shown');

  const page = await api(`/api/customers/${ids.customerUnassigned}/contracts`, { token: ids.tokenManager });
  assert.deepEqual(page.data.service_levels, ['24x7', '8x5', 'Business hours']);
  const refused = await api(`/api/customers/${ids.customerUnassigned}/contracts`, { method: 'POST', token: ids.tokenManager, body: { reference: 'T2', start_date: day(0), end_date: day(10), service_level: '12x5' } });
  assert.equal(refused.status, 400);
  const id = await addContract(ids.customerUnassigned, 'T3', day(0), day(300), { service_level: 'business HOURS' });
  assert.equal((await db.prepare('SELECT service_level FROM customer_contracts WHERE id = ?').get(id)).service_level, 'Business hours', 'stored as the configured name');
  // A contract keeps the type it has, though it is no longer offered.
  const kept = await api(`/api/customers/${ids.customerUnassigned}/contracts/${used}`, { method: 'PUT', token: ids.tokenManager, body: { notes: 'Still 12x5' } });
  assert.equal(kept.status, 200, JSON.stringify(kept.data));
  // Renaming a type renames it on its contracts.
  const renamed = await api('/api/settings/contract-types', { method: 'PUT', token: ids.tokenManager, body: { types: ['24x7', '8x5', 'Office hours'], renames: { 'Business hours': 'Office hours' } } });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.data));
  assert.equal((await db.prepare('SELECT service_level FROM customer_contracts WHERE id = ?').get(id)).service_level, 'Office hours');
  assert.equal((await api('/api/settings/contract-types', { method: 'PUT', token: ids.tokenManager, body: { types: ['24x7'], renames: { Unknown: '24x7' } } })).status, 400);

  const { importCustomers } = require('../customerImport');
  const result = await importCustomers([{ name: 'Type Import', contract_reference: 'IMP-1', contract_type: '12x5', contract_start: day(0), contract_end: day(30) }],
    { user: { id: ids.manager, role: 'manager' } });
  assert.match(result.errors[0]?.error || '', /not one of the contract types/);
  await db.prepare('DELETE FROM customer_contracts WHERE customer_id = ?').run(ids.customerUnassigned);
});

test('managers are alerted 30 and 7 days before a contract ends, and once it has expired without a renewal', async () => {
  const reminders = require('../reminders');
  await addContract(ids.customer, 'END-30', day(-300), day(30), { service_level: '24x7' });
  await addContract(ids.customer, 'END-7', day(-300), day(7));
  await addContract(ids.customer, 'GONE', day(-300), day(-1));
  await addContract(ids.customer, 'LATER', day(-300), day(31));
  const renewed = await addContract(ids.customer, 'RENEWED', day(-300), day(-1));
  assert.equal((await api(`/api/customers/${ids.customer}/contracts/${renewed}/renew`, { method: 'POST', token: ids.tokenManager, body: { start_date: day(0), end_date: day(364) } })).status, 201);

  const first = await reminders.sendAutomaticReminders();
  await reminders.sendAutomaticReminders();
  const got = await alerts('contract_ending');
  assert.equal(got.length, 3, JSON.stringify(got));
  assert.ok(first.contract_ending >= 3);
  assert.ok(got.some(n => /END-30 ending soon/.test(n.title)));
  assert.ok(got.some(n => /END-7 ending soon/.test(n.title)));
  assert.ok(got.some(n => /GONE expired/.test(n.title) && n.body === `Ended ${day(-1)}`));
  assert.ok(got.every(n => n.link === `/customers/${ids.customer}/service-profile?section=contracts`));
  assert.equal((await alerts('contract_ending', ids.engineerEnabled)).length, 0, 'engineers are not told');

  // A manager can turn it off; archived customers are not alerted about.
  await api('/api/reminders/settings', { method: 'PUT', token: ids.tokenManager, body: { contract_ending: false } });
  await addContract(ids.customerUnassigned, 'OFF', day(-300), day(30));
  await reminders.sendAutomaticReminders();
  assert.equal((await alerts('contract_ending')).length, 3);
  await api('/api/reminders/settings', { method: 'PUT', token: ids.tokenManager, body: { contract_ending: true } });
  await db.prepare('UPDATE customers SET active = 0 WHERE id = ?').run(ids.customerUnassigned);
  await reminders.sendAutomaticReminders();
  assert.equal((await alerts('contract_ending')).length, 3);
  await db.prepare('UPDATE customers SET active = 1 WHERE id = ?').run(ids.customerUnassigned);
});

test('managed-services engineers of the customer hear about contracts ending, expiring and renewed', async () => {
  const reminders = require('../reminders');
  const { signJwt } = require('./lib/activityFixture');
  const user = async (name, role) => (await db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
    .run(name, `${name.toLowerCase().replace(/\W/g, '')}@test.local`, 'x', role)).lastInsertRowid;
  const customer = (await db.prepare('INSERT INTO customers (name, active) VALUES (?, 1)').run('Contract MS Corp')).lastInsertRowid;
  const msTeam = (await db.prepare('INSERT INTO teams (name, managed_service_operations) VALUES (?, 1)').run('Contract MS Team')).lastInsertRowid;
  const otherMsTeam = (await db.prepare('INSERT INTO teams (name, managed_service_operations) VALUES (?, 1)').run('Contract MS Elsewhere')).lastInsertRowid;
  const plainTeam = (await db.prepare('INSERT INTO teams (name, managed_service_operations) VALUES (?, 0)').run('Contract Projects Team')).lastInsertRowid;
  const msEngineer = await user('Contract MS Engineer', 'engineer'), elsewhere = await user('Contract Elsewhere Engineer', 'engineer');
  const projectsEngineer = await user('Contract Projects Engineer', 'engineer'), gone = await user('Contract Gone Engineer', 'engineer');
  const otherManager = await user('Contract Other Manager', 'manager');
  await db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(gone);
  for (const [team, member] of [[msTeam, msEngineer], [msTeam, gone], [otherMsTeam, elsewhere], [plainTeam, projectsEngineer]])
    await db.prepare('INSERT INTO team_members (team_id, user_id) VALUES (?, ?)').run(team, member);
  for (const team of [msTeam, plainTeam]) await db.prepare('INSERT INTO customer_teams (customer_id, team_id) VALUES (?, ?)').run(customer, team);
  try {
    const ending = await addContract(customer, 'MS-END-30', day(-300), day(30));
    await reminders.sendAutomaticReminders();
    assert.deepEqual((await alerts('contract_ending', msEngineer)).map(n => n.title), ['Contract MS Corp: contract MS-END-30 ending soon']);
    assert.equal((await alerts('contract_ending', msEngineer))[0].link, `/customers/${customer}/service-profile?section=contracts`);
    assert.equal((await alerts('contract_ending', ids.manager)).filter(n => /MS-END-30/.test(n.title)).length, 1, 'managers still are');
    for (const other of [elsewhere, projectsEngineer, gone]) assert.equal((await alerts('contract_ending', other)).length, 0, `user ${other} is not on this customer's managed-services team`);

    // An engineer can turn the reminder off, as a manager can.
    assert.equal((await api('/api/reminders/settings', { method: 'PUT', token: signJwt({ id: msEngineer }), body: { contract_ending: false } })).status, 200);
    await addContract(customer, 'MS-END-7', day(-300), day(7));
    await reminders.sendAutomaticReminders();
    assert.equal((await alerts('contract_ending', msEngineer)).length, 1);

    // Renewed: the engineer and the other managers are told; the manager who renewed it is not.
    const renewed = await api(`/api/customers/${customer}/contracts/${ending}/renew`, { method: 'POST', token: ids.tokenManager, body: { start_date: day(31), end_date: day(395) } });
    assert.equal(renewed.status, 201, JSON.stringify(renewed.data));
    await require('../notifications').settled();
    const told = await alerts('contract_renewed', msEngineer);
    assert.deepEqual(told.map(n => [n.title, n.body]), [['Contract MS Corp: contract MS-END-30 renewed', `Until ${day(395)}`]]);
    assert.equal((await alerts('contract_renewed', otherManager)).length, 1);
    assert.equal((await alerts('contract_renewed', ids.manager)).length, 0, 'not the one who renewed it');
    for (const other of [elsewhere, projectsEngineer, gone]) assert.equal((await alerts('contract_renewed', other)).length, 0);
  } finally {
    await db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(otherManager);
    await db.prepare('UPDATE customers SET active = 0 WHERE id = ?').run(customer);
  }
});

test('a failed backup or off-server copy alerts the managers, unless the alert is switched off', async () => {
  const { alertBackupFailure, isFinalAttempt } = require('../backupAlerts');
  assert.equal(isFinalAttempt({ attempts: 1, max_attempts: 3 }, new Error('x')), false, 'it will be retried');
  assert.equal(isFinalAttempt({ attempts: 3, max_attempts: 3 }, new Error('x')), true);
  assert.equal(isFinalAttempt({ attempts: 1, max_attempts: 3 }, Object.assign(new Error('x'), { permanent: true })), true);

  const noEmail = { db_backup_failed: { enabled: true, email: false } };
  assert.equal((await api('/api/settings/admin-notifications', { method: 'PUT', token: ids.tokenManager, body: noEmail })).status, 200);
  await alertBackupFailure('offsite', { file: 'teamhub-x.sql.gz', error: 'Connection refused' });
  const got = await alerts('system_alert');
  assert.equal(got.length, 1);
  assert.match(got[0].title, /off-server backup copy \(SFTP\) failed/);
  assert.equal(got[0].body, 'Connection refused');
  assert.equal(got[0].link, '/settings/backups');
  assert.equal((await alerts('system_alert', ids.engineerEnabled)).length, 0);

  await api('/api/settings/admin-notifications', { method: 'PUT', token: ids.tokenManager, body: { db_backup_failed: { enabled: false, email: false } } });
  await alertBackupFailure('database', { error: 'pg_dump failed' });
  assert.equal((await alerts('system_alert')).length, 1, 'switched off: nothing');
});

test('engineers and managers add customer tasks, for themselves, a person or a team', async () => {
  const add = (token, body) => api('/api/tasks', { method: 'POST', token, body: { customer_id: ids.customer, title: 'Replace failed disk', ...body } });
  const task = async id => db.prepare('SELECT assigned_to, team_id, customer_id, created_by FROM tasks WHERE id = ?').get(id);

  // An engineer takes it, or gives it to a team they are in, never to someone else or another team.
  const mine = await add(ids.tokenEnabled, { assigned_to: ids.manager });
  assert.equal(mine.status, 200, JSON.stringify(mine.data));
  assert.deepEqual({ ...(await task(mine.data.id)) }, { assigned_to: Number(ids.engineerEnabled), team_id: null, customer_id: Number(ids.customer), created_by: Number(ids.engineerEnabled) });
  const forTeam = await add(ids.tokenEnabled, { team_id: ids.teamEnabled });
  assert.equal(forTeam.status, 200, JSON.stringify(forTeam.data));
  assert.deepEqual([(await task(forTeam.data.id)).assigned_to, Number((await task(forTeam.data.id)).team_id)], [null, Number(ids.teamEnabled)]);
  assert.equal((await add(ids.tokenEnabled, { team_id: ids.teamDisabled })).status, 403, 'not their team');
  assert.equal((await add(ids.tokenEnabled, { team_id: 999999 })).status, 400);
  assert.equal((await add(ids.tokenEnabled, { customer_id: ids.customerUnassigned })).status, 403, 'a customer they do not work with');

  // The team's task is in the engineer's list for this customer.
  const listed = await api(`/api/customers/${ids.customer}/operations/tasks?page=1&page_size=25&filter=all`, { token: ids.tokenEnabled });
  assert.equal(listed.status, 200, JSON.stringify(listed.data));
  assert.ok(listed.data.rows.some(row => row.id === Number(forTeam.data.id) && row.team_name === 'Security Team'));

  // A manager gives it to any engineer or team.
  const toEngineer = await add(ids.tokenManager, { assigned_to: ids.engineerDisabled });
  assert.equal((await task(toEngineer.data.id)).assigned_to, Number(ids.engineerDisabled));
  const toTeam = await add(ids.tokenManager, { team_id: ids.teamDisabled });
  assert.equal(Number((await task(toTeam.data.id)).team_id), Number(ids.teamDisabled));
  assert.equal((await add(ids.tokenPlanner, {})).status, 403);
  assert.equal((await add(ids.tokenManager, { team_id: 'x' })).status, 400);
});
