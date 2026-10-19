// Customer licences and certificates (with expiry reminders), vendor support cases, and Renewals & cases.
process.env.CUSTOMER_FIELD_KEY = process.env.CUSTOMER_FIELD_KEY || 'c'.repeat(64);
const { test, assert, api, db, ids } = require('./lib/activityFixture');
const reminders = require('../reminders');
const appTime = require('../appTime');

const base = id => `/api/customers/${id}/licences`;
const cases = id => `/api/customers/${id}/vendor-cases`;
const alerts = (type, user = ids.manager) => db.prepare('SELECT title, body, link FROM notifications WHERE user_id = ? AND type = ? ORDER BY id').all(user, type);
let today, licence, certificate;

test('licences: people who work with the customer see them; managers and its engineers add and change them', async () => {
  ({ today } = await db.prepare('SELECT app_today() AS today').get());
  const add = (token, body, customer = ids.customer) => api(base(customer), { method: 'POST', token, body });
  const good = { kind: 'subscription', name: 'FortiGuard UTP bundle', vendor: 'Fortinet', reference: 'FGT-SUB-1', quantity: 2, expires_on: appTime.addDays(today, 30) };

  for (const bad of [{ ...good, name: '' }, { ...good, kind: 'lease' }, { ...good, expires_on: '2026-02-30' }, { ...good, quantity: 0 }, { ...good, asset_id: 999999 }])
    assert.equal((await add(ids.tokenManager, bad)).status, 400, JSON.stringify(bad));
  const made = await add(ids.tokenManager, good);
  assert.equal(made.status, 201, JSON.stringify(made.data));
  licence = made.data.id;
  const byEngineer = await add(ids.tokenEnabled, { kind: 'certificate', name: 'vpn.acme.example', vendor: 'DigiCert', expires_on: appTime.addDays(today, 7) });
  assert.equal(byEngineer.status, 201, 'an engineer who works with the customer adds a certificate');
  certificate = byEngineer.data.id;
  assert.equal((await add(ids.tokenPlanner, good)).status, 403, 'planners only look');
  assert.equal((await add(ids.tokenEnabled, good, ids.customerUnassigned)).status, 403, 'not a customer the engineer works with');

  const listed = await api(base(ids.customer), { token: ids.tokenPlanner });
  assert.equal(listed.status, 200);
  const row = listed.data.licences.find(l => l.id === licence);
  assert.equal(row.status, 'expiring');
  assert.equal(row.days_left, 30);
  assert.equal(row.reference, 'FGT-SUB-1');
  assert.deepEqual(listed.data.assets, [], 'planners without asset access see no asset names');
  const stored = await db.prepare('SELECT name, reference FROM customer_licences WHERE id = ?').get(licence);
  assert.doesNotMatch(stored.name + stored.reference, /FortiGuard|FGT-SUB/, 'stored encrypted');

  const version = row.edit_version;
  assert.equal((await api(`${base(ids.customer)}/${licence}`, { method: 'PUT', token: ids.tokenEnabled, body: { notes: 'Two firewalls', version } })).status, 200);
  const stale = await api(`${base(ids.customer)}/${licence}`, { method: 'PUT', token: ids.tokenManager, body: { notes: 'Old view', version } });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.code, 'EDIT_CONFLICT');
  assert.equal((await api(`${base(ids.customer)}/${certificate}`, { method: 'DELETE', token: ids.tokenEnabled })).status, 403, 'only managers delete');
});

test('expiry reminders: once per step, to the managers; a renewal starts them again; "not renewing" stops them', async () => {
  await reminders.sendAutomaticReminders();
  await reminders.sendAutomaticReminders();
  const sent = await alerts('licence_expiring');
  assert.equal(sent.filter(a => /FortiGuard/.test(a.title)).length, 1, 'the 30-day reminder, once');
  assert.equal(sent.filter(a => /vpn\.acme/.test(a.title)).length, 1, 'the 7-day reminder for the certificate');
  assert.match(sent[0].link, new RegExp(`/customers/${ids.customer}/service-profile\\?section=contracts`));

  // Renewed: a new expiry date. Within 60 days of it the reminders start over.
  const renewed = await api(`${base(ids.customer)}/${licence}`, { method: 'PUT', token: ids.tokenManager, body: { expires_on: appTime.addDays(today, 45) } });
  assert.equal(renewed.data.renewed, true);
  await reminders.sendAutomaticReminders();
  assert.equal((await alerts('licence_expiring')).filter(a => /FortiGuard/.test(a.title)).length, 2, 'the 60-day reminder of the new date');

  // The customer lets the certificate go: no more reminders, even when it expires.
  await api(`${base(ids.customer)}/${certificate}`, { method: 'PUT', token: ids.tokenManager, body: { not_renewing: true } });
  await db.prepare('UPDATE customer_licences SET expires_on = ? WHERE id = ?').run(appTime.addDays(today, -1), certificate);
  await reminders.sendAutomaticReminders();
  assert.equal((await alerts('licence_expiring')).filter(a => /vpn\.acme/.test(a.title)).length, 1);
});

let vendorCase;
test('vendor cases: open one, record updates, follow-ups and status; no duplicate case numbers', async () => {
  const open = body => api(cases(ids.customer), { method: 'POST', token: ids.tokenEnabled, body });
  const good = { vendor: 'Check Point', case_number: '6-0003456789', subject: 'Cluster failover loops after Jumbo take 99', severity: 'high', rt_ticket: '#4521', next_follow_up: appTime.addDays(today, 2) };
  for (const bad of [{ ...good, case_number: '' }, { ...good, severity: 'urgent' }, { ...good, rt_ticket: 'abc' }, { ...good, owner_id: ids.pm }, { ...good, next_follow_up: 'soon' }])
    assert.equal((await open(bad)).status, 400, JSON.stringify(bad));
  const made = await open(good);
  assert.equal(made.status, 201, JSON.stringify(made.data));
  vendorCase = made.data.id;
  assert.equal((await open({ ...good, vendor: 'check point' })).status, 409, 'the same case twice');
  assert.equal((await api(cases(ids.customer), { method: 'POST', token: ids.tokenPlanner, body: { ...good, case_number: 'X1' } })).status, 403);
  assert.equal((await api(cases(ids.customerUnassigned), { token: ids.tokenEnabled })).status, 403);

  const listed = (await api(cases(ids.customer), { token: ids.tokenPlanner })).data;
  const row = listed.cases.find(c => c.id === vendorCase);
  assert.equal(row.owner_id, ids.engineerEnabled, 'whoever opens it owns it unless someone else is chosen');
  assert.equal(row.rt_ticket, '4521');
  assert.equal(row.open, true);
  assert.equal(row.attention, null);
  const stored = await db.prepare('SELECT subject FROM vendor_cases WHERE id = ?').get(vendorCase);
  assert.doesNotMatch(stored.subject, /failover/, 'stored encrypted');

  assert.equal((await api(`${cases(ids.customer)}/${vendorCase}/updates`, { method: 'POST', token: ids.tokenEnabled, body: { note: '' } })).status, 400);
  const update = await api(`${cases(ids.customer)}/${vendorCase}/updates`, { method: 'POST', token: ids.tokenEnabled,
    body: { note: 'TAC asked for cpinfo; uploaded.', status: 'waiting_vendor', next_follow_up: appTime.addDays(today, 3) } });
  assert.equal(update.status, 201, JSON.stringify(update.data));
  assert.equal(update.data.case.status, 'waiting_vendor');
  assert.deepEqual(update.data.updates.map(u => [u.note, u.status_from, u.status_to]),
    [['TAC asked for cpinfo; uploaded.', 'open', 'waiting_vendor'], ['Case recorded', null, 'open']]);
  const detail = await api(`${cases(ids.customer)}/${vendorCase}`, { token: ids.tokenPlanner });
  assert.equal(detail.data.updates.length, 2);
});

test('vendor case reminders: a follow-up that is due, and a case gone quiet, reach the owner once', async () => {
  await db.prepare('UPDATE vendor_cases SET next_follow_up = ? WHERE id = ?').run(today, vendorCase);
  await reminders.sendAutomaticReminders();
  await reminders.sendAutomaticReminders();
  let sent = await alerts('vendor_case_follow_up', ids.engineerEnabled);
  assert.equal(sent.length, 1);
  assert.match(sent[0].title, /6-0003456789 follow-up due/);
  assert.match(sent[0].link, new RegExp(`section=vendor-cases&case=${vendorCase}`));

  await db.prepare('UPDATE vendor_cases SET next_follow_up = NULL, last_update_at = ? WHERE id = ?').run(`${appTime.addDays(today, -8)}T09:00:00.000Z`, vendorCase);
  const quiet = (await api(cases(ids.customer), { token: ids.tokenManager })).data.cases.find(c => c.id === vendorCase);
  assert.equal(quiet.attention, 'quiet');
  await reminders.sendAutomaticReminders();
  await reminders.sendAutomaticReminders();
  sent = await alerts('vendor_case_follow_up', ids.engineerEnabled);
  assert.equal(sent.length, 2);
  assert.match(sent[1].title, /gone quiet/);

  // Resolved: no more reminders, and it closes on the day.
  const done = await api(`${cases(ids.customer)}/${vendorCase}/updates`, { method: 'POST', token: ids.tokenManager, body: { note: 'Fixed in take 102.', status: 'resolved' } });
  assert.equal(done.data.case.closed_on, today);
  assert.equal(done.data.case.attention, null);
});

test('Renewals & cases: what expires across the customers a person may see, and open vendor cases', async () => {
  const other = await api(base(ids.customerUnassigned), { method: 'POST', token: ids.tokenManager, body: { kind: 'licence', name: 'Other Corp SmartEvent', expires_on: appTime.addDays(today, 20) } });
  assert.equal(other.status, 201);
  await api(cases(ids.customer), { method: 'POST', token: ids.tokenManager, body: { vendor: 'Fortinet', case_number: '7712345', subject: 'HA sync errors' } });

  const manager = await api('/api/renewals?days=60', { token: ids.tokenManager });
  assert.equal(manager.status, 200);
  assert.equal(manager.data.days, 60);
  const names = manager.data.expiring.map(item => item.name);
  assert.ok(names.includes('FortiGuard UTP bundle') && names.includes('Other Corp SmartEvent'));
  assert.ok(names.includes('vpn.acme.example'), 'expired in the last 30 days');
  const dates = manager.data.expiring.map(item => item.date);
  assert.deepEqual(dates, [...dates].sort(), 'soonest first');
  assert.deepEqual(manager.data.vendor_cases.map(c => c.case_number), ['7712345'], 'open cases only');
  assert.equal(manager.data.vendor_cases[0].customer_name, 'Acme Corp');

  const engineer = (await api('/api/renewals', { token: ids.tokenEnabled })).data;
  assert.ok(!engineer.expiring.some(item => item.name === 'Other Corp SmartEvent'), 'engineers see the customers they work with');
  assert.equal((await api('/api/renewals', { token: ids.tokenPm })).status, 403);
  const asset = (await db.prepare("INSERT INTO customer_assets (customer_id, name, asset_type, lifecycle_status, created_by) VALUES (?, 'FW-SECRET-01', 'firewall', 'active', ?) RETURNING id").get(ids.customer, ids.manager)).id;
  await db.prepare('UPDATE vendor_cases SET asset_id = ? WHERE case_number = ?').run(asset, '7712345');
  assert.equal((await api('/api/renewals', { token: ids.tokenManager })).data.vendor_cases[0].asset_name, 'FW-SECRET-01');
  const planner = (await api('/api/renewals', { token: ids.tokenPlanner })).data;
  assert.equal(planner.vendor_cases[0].asset_name, null, 'no device names without asset access');
});

test('the customer report lists renewals due under "Coming next"', async () => {
  const report = require('../customerValueReport');
  await db.prepare('INSERT INTO managed_customer_configurations (customer_id, managed_services_enabled) VALUES (?, 1) ON CONFLICT (customer_id) DO UPDATE SET managed_services_enabled = 1').run(ids.customer);
  const built = await report.buildValueReport({ customerId: ids.customer, from: appTime.addDays(today, -30), to: today });
  assert.ok(built.upcoming.some(item => /^Renewal due: FortiGuard UTP bundle \(subscription\), expires \d{2}\/\d{2}\/\d{4}$/.test(item.title)), JSON.stringify(built.upcoming));
  assert.ok(!built.upcoming.some(item => /vpn\.acme/.test(item.title)), 'not one the customer is letting go');
});
