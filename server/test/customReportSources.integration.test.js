const { test, assert, api, db, ids } = require('./lib/activityFixture');
const suiteFixture = require('./lib/activityFixture');
const { encrypt } = require('../fieldCipher');

// Running a report sets a read-only transaction, which pg-mem cannot parse.
const pgOnly = { skip: process.env.TEST_DATABASE_URL ? false : 'needs PostgreSQL' };

const preview = async definition => {
  const res = await api('/api/reports/custom/preview', { method: 'POST', token: ids.tokenManager, body: definition });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return res.data;
};

test('the report builder shows names, not IDs, and offers them as filter choices', pgOnly, async () => {
  await db.prepare('INSERT INTO tasks (title, status, customer_id, assigned_to, created_by) VALUES (?, ?, ?, ?, ?)').run('Rotate VPN keys', 'todo', ids.customer, ids.engineerEnabled, ids.manager);
  const sources = (await api('/api/reports/custom/sources', { token: ids.tokenManager })).data;
  assert.ok(sources.lookups.customer.some(row => row.name === 'Acme Corp'));
  assert.ok(sources.lookups.user.some(row => row.name === 'Engineer Enabled'));
  for (const key of ['tickets', 'assets', 'cves', 'time_logs']) assert.ok(sources.sources.some(source => source.key === key), key);

  const result = await preview({ source: 'tasks', fields: ['title', 'customer_id', 'engineer_id'], filters: [{ field: 'customer_id', operator: 'eq', value: Number(ids.customer) }] });
  assert.deepEqual(result.columns.map(c => c.label), ['Title', 'Customer', 'Assigned engineer']);
  const row = result.rows.find(r => r.title === 'Rotate VPN keys');
  assert.equal(row.customer_id, 'Acme Corp');
  assert.equal(row.engineer_id, 'Engineer Enabled');

  // Grouped by customer, sorted by its name.
  const grouped = await preview({ source: 'tasks', fields: ['customer_id'], group_by: ['customer_id'], aggregations: [{ field: '*', operation: 'count' }], sort: [{ field: 'customer_id', direction: 'asc' }] });
  assert.ok(grouped.rows.some(r => r.customer_id === 'Acme Corp' && Number(r.metric_0) >= 1));
});

test('tickets, assets, CVEs and time logs can be reported on', pgOnly, async () => {
  await db.prepare(`INSERT INTO external_tickets (customer_id, provider_type, external_queue_id, external_queue_name, external_ticket_id, ticket_number, subject, external_status, normalized_status, status_group, normalized_priority, created_at_external, sla_breached)
    VALUES (?, 'request_tracker', 'q1', 'Acme Support', 'rt-9001', '9001', 'Firewall rule request', 'open', 'open', 'open', 'high', '2026-10-02T08:00:00Z', 1)`).run(ids.customer);
  const tickets = await preview({ source: 'tickets', fields: ['ticket_number', 'subject', 'customer_id', 'created_date', 'sla_breached'], filters: [{ field: 'priority', operator: 'eq', value: 'high' }] });
  assert.deepEqual(tickets.rows.find(r => r.ticket_number === '9001'), { ticket_number: '9001', subject: 'Firewall rule request', customer_id: 'Acme Corp', created_date: '2026-10-02', sla_breached: 1 });

  for (const [name, vendor] of [['FW-B', 'Fortinet'], ['FW-A', 'Cisco']])
    await db.prepare(`INSERT INTO customer_assets (customer_id, name, asset_type, vendor, software_version, environment, criticality, lifecycle_status, coverage_type, created_by)
      VALUES (?, ?, 'Firewall', ?, ?, 'production', 'high', 'active', 'managed', ?)`).run(ids.customer, encrypt(name), encrypt(vendor), encrypt('7.4.3'), ids.manager);
  const assets = await preview({ source: 'assets', fields: ['name', 'vendor', 'version', 'customer_id'], sort: [{ field: 'name', direction: 'asc' }] });
  assert.deepEqual(assets.rows.map(r => r.name), ['FW-A', 'FW-B'], 'decrypted and sorted by the real name');
  assert.equal(assets.rows[0].vendor, 'Cisco');
  // Encrypted fields cannot be filtered or grouped in SQL.
  assert.equal((await api('/api/reports/custom/preview', { method: 'POST', token: ids.tokenManager, body: { source: 'assets', fields: ['name'], filters: [{ field: 'vendor', operator: 'eq', value: 'Cisco' }] } })).status, 400);
  assert.equal((await api('/api/reports/custom/preview', { method: 'POST', token: ids.tokenManager, body: { source: 'assets', fields: ['vendor'], group_by: ['vendor'], aggregations: [{ field: '*', operation: 'count' }] } })).status, 400);

  await db.exec("INSERT INTO cves (id, published, severity, cvss_score, description, products) VALUES ('CVE-2026-0001', '2026-09-30T10:00:00', 'CRITICAL', 9.8, 'Heap overflow', 'fortinet:fortios')");
  await db.exec("INSERT INTO cves (id, published, severity, cvss_score, description, products) VALUES ('CVE-2026-0002', '2026-09-29T10:00:00', 'MEDIUM', 5.1, 'Info leak', 'cisco:asa')");
  await db.exec("INSERT INTO cve_kev (cve_id, date_added) VALUES ('CVE-2026-0001', '2026-10-01')");
  const cves = await preview({ source: 'cves', fields: ['cve', 'cvss', 'known_exploited', 'kev_added'], filters: [{ field: 'cvss', operator: 'gte', value: 5 }], sort: [{ field: 'cvss', direction: 'desc' }] });
  assert.deepEqual(cves.rows.map(r => [r.cve, Number(r.known_exploited), r.kev_added]), [['CVE-2026-0001', 1, '2026-10-01'], ['CVE-2026-0002', 0, null]]);

  const task = (await db.prepare('INSERT INTO tasks (title, status, customer_id, created_by) VALUES (?, ?, ?, ?)').run('Patch firewalls', 'todo', ids.customer, ids.manager)).lastInsertRowid;
  await db.prepare("INSERT INTO time_logs (user_id, task_id, hours, description, logged_at) VALUES (?, ?, 2.5, 'Patching', '2026-10-03 10:00:00')").run(ids.engineerEnabled, task);
  const logs = await preview({ source: 'time_logs', fields: ['logged_date', 'user_id', 'hours', 'task', 'customer_id'] });
  assert.deepEqual(logs.rows.find(r => r.task === 'Patch firewalls'), { logged_date: '2026-10-03', user_id: 'Engineer Enabled', hours: 2.5, task: 'Patch firewalls', customer_id: 'Acme Corp' });
});

test('a report can be exported as PDF', async () => {
  const { pdf } = require('../reportExecution');
  const buffer = await pdf({ columns: [{ key: 'ticket', label: 'Ticket' }, { key: 'subject', label: 'Subject' }], rows: Array.from({ length: 80 }, (_, i) => ({ ticket: String(9000 + i), subject: `Request ${i}` })) }, 'Open tickets');
  assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
  assert.ok(suiteFixture.baseUrl);
});
