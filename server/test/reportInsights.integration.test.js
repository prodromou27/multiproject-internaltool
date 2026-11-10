// The customer report's lifecycle and security advisory sections (reportInsights.js).
const { test, assert, db, ids } = require('./lib/activityFixture');
const insights = require('../reportInsights');

let customers = 0;
const newCustomer = async () => (await db.prepare('INSERT INTO customers (name, active, service_activity_enabled) VALUES (?, 1, 1)').run(`Lifecycle customer ${++customers}`)).lastInsertRowid;
const asset = (customer, name, fields = {}) => db.prepare(`INSERT INTO customer_assets (customer_id, name, asset_type, vendor, model, software_version, lifecycle_status, support_end_date, warranty_expiry_date, created_by)
  VALUES (?, ?, 'Firewall', ?, ?, ?, ?, ?, ?, ?)`).run(customer, name, fields.vendor || null, fields.model || null, fields.version || null, fields.lifecycle || 'active', fields.support || null, fields.warranty || null, ids.manager);
const licence = (customer, kind, name, expires, notRenewing = 0) => db.prepare('INSERT INTO customer_licences (customer_id, kind, name, expires_on, not_renewing) VALUES (?, ?, ?, ?, ?)').run(customer, kind, name, expires, notRenewing);
const contract = (customer, description, start, end, renewedFrom = null) => db.prepare('INSERT INTO customer_contracts (customer_id, description, start_date, end_date, renewed_from_id) VALUES (?, ?, ?, ?, ?)').run(customer, description, start, end, renewedFrom);
const AS_OF = '2026-10-31';

test('lifecycle groups what has expired or ends within 12 months, soonest first', async () => {
  const customer = await newCustomer();
  await asset(customer, 'FW-HQ-01', { support: '2026-10-01', warranty: '2028-01-01' });
  await asset(customer, 'ESX-02', { warranty: '2027-09-01' });
  await asset(customer, 'OLD-SW', { support: '2020-01-01', lifecycle: 'retired' });
  await licence(customer, 'licence', 'M365 E3', '2027-06-30', 1);
  await licence(customer, 'certificate', '*.example.com', '2026-12-02');
  await licence(customer, 'licence', 'Old AV', '2025-09-01');
  await contract(customer, 'Managed firewall', '2026-01-01', '2026-12-31');
  const renewed = (await contract(customer, 'Backup service', '2025-11-16', '2026-11-15')).lastInsertRowid;
  await contract(customer, 'Backup service', '2026-11-16', '2027-11-15', renewed);

  const result = await insights.getLifecycle(customer, AS_OF);
  assert.deepEqual(result.groups.map(g => g.title), ['Devices and firmware', 'Licences, subscriptions and certificates', 'Contracts']);
  assert.deepEqual(result.groups[0].rows.map(r => [r.item, r.type, r.ends, r.status]), [['FW-HQ-01', 'Support', '2026-10-01', 'Expired'], ['ESX-02', 'Warranty', '2027-09-01', 'Within 12 months']]);
  assert.deepEqual(result.groups[1].rows.map(r => [r.item, r.type, r.status]), [['*.example.com', 'Certificate', 'Within 90 days'], ['M365 E3', 'Licence', 'Within 12 months']]);
  assert.deepEqual(result.groups[2].rows.map(r => [r.item, r.ends]), [['Managed firewall', '2026-12-31']], 'the renewed one is gone; its renewal ends beyond 12 months');
  assert.equal(result.total, 5);
  assert.equal(result.summary, '5 items have expired or end within the next 12 months.');
});

test('a customer with nothing recorded gets no groups', async () => {
  assert.deepEqual(await insights.getLifecycle(await newCustomer(), AS_OF), { total: 0, summary: '', groups: [] });
});

test('odd dates are read by their day or skipped', async () => {
  const customer = await newCustomer();
  await asset(customer, 'SW-01', { support: '2027-01-15 00:00:00', warranty: 'n/a' });
  const result = await insights.getLifecycle(customer, AS_OF);
  assert.deepEqual(result.groups.flatMap(g => g.rows).map(r => [r.type, r.ends, r.status]), [['Support', '2027-01-15', 'Within 90 days']]);
  assert.equal(result.summary, '1 item has expired or ends within the next 12 months.');
});

test('firmware ending within the window is listed', async () => {
  const customer = await newCustomer();
  const product = (await db.prepare("INSERT INTO software_products (name, source, asset_vendor, enabled) VALUES ('FortiOS', 'manual', 'Lifecyclenet', 1)").run()).lastInsertRowid;
  await db.prepare("INSERT INTO software_releases (product_id, branch, eol) VALUES (?, '7.0', '2027-03-30')").run(product);
  await asset(customer, 'FW-EDGE', { vendor: 'Lifecyclenet', model: 'FortiGate 60F', version: '7.0.12' });
  const rows = (await insights.getLifecycle(customer, AS_OF)).groups.flatMap(g => g.rows);
  assert.deepEqual(rows.map(r => [r.item, r.type, r.ends, r.status]), [['FortiOS 7.0 on FW-EDGE', 'Firmware', '2027-03-30', 'Within 12 months']]);
});

// Advisories: php:php (PHP) and microsoft:windows_server_2022 (Windows Server) are flagged by the migration.
// Tests share one database, so each uses its own month.
const PHP = ' php:php ', WINDOWS = ' microsoft:windows_server_2022 ';
const cve = (id, products, score, published, severity = 'CRITICAL') => db.prepare('INSERT INTO cves (id, published, description, cvss_score, severity, products) VALUES (?, ?, ?, ?, ?, ?)')
  .run(id, `${published}T10:00:00.000`, `NVD text for ${id}.`, score, score == null ? null : severity, products);
const exploited = (id, added, text = null) => db.prepare('INSERT INTO cve_kev (cve_id, date_added, short_description) VALUES (?, ?, ?) RETURNING cve_id').get(id, added, text);

test('advisories list exploited then highest score, above 9 only, from flagged products', async () => {
  await cve('OCT-A', PHP, 9.8, '2026-10-05');
  await cve('OCT-B', WINDOWS, 9.1, '2025-05-01'); await exploited('OCT-B', '2026-10-20', 'CISA text.');
  await cve('OCT-C', PHP, 9.0, '2026-10-06'); await exploited('OCT-C', '2026-10-07');
  await cve('OCT-D', PHP, null, '2026-10-08'); await exploited('OCT-D', '2026-10-09');
  await cve('OCT-E', ' acme:widget ', 10.0, '2026-10-10');
  await cve('OCT-F', PHP, 9.9, '2026-09-15');
  const result = await insights.getAdvisories('2026-10-01', '2026-10-31');
  assert.deepEqual(result.rows.map(r => r.cve), ['OCT-B', 'OCT-A']);
  assert.deepEqual(result.rows[0], { cve: 'OCT-B', product: 'Windows Server', severity: 'Critical 9.1', exploited: true, description: 'CISA text.' });
  assert.deepEqual([result.rows[1].exploited, result.rows[1].description], [false, 'NVD text for OCT-A.']);
  assert.deepEqual([result.total, result.more], [2, '']);
});

test('no more than 3 per product and 10 in all, saying how many qualified', async () => {
  for (let n = 0; n < 5; n++) await cve(`NOV-P${n}`, PHP, 9.5, '2026-11-05');
  for (let n = 0; n < 12; n++) await cve(`NOV-W${n}`, WINDOWS, 9.5, '2026-11-06');
  let result = await insights.getAdvisories('2026-11-01', '2026-11-30');
  assert.deepEqual(result.rows.map(r => r.product).sort(), ['PHP', 'PHP', 'PHP', 'Windows Server', 'Windows Server', 'Windows Server']);
  assert.equal(result.total, 17);
  assert.equal(result.more, 'Showing the 6 most significant of 17.');
  for (let p = 0; p < 9; p++) {
    await db.prepare("INSERT INTO cve_watch (cpe_vendor, cpe_product, label, source, in_advisories) VALUES ('advisorytest', ?, ?, 'manual', 1)").run(`product${p}`, `Product ${p}`);
    for (let n = 0; n < 2; n++) await cve(`NOV-X${p}-${n}`, ` advisorytest:product${p} `, 9.6, '2026-11-07');
  }
  result = await insights.getAdvisories('2026-11-01', '2026-11-30');
  assert.equal(result.rows.length, 10);
  assert.equal(result.more, 'Showing the 10 most significant of 35.');
});

test('a CVE under two flagged products appears once', async () => {
  await cve('DEC-A', ' php:php microsoft:windows_server_2022 ', 9.8, '2026-12-03');
  const result = await insights.getAdvisories('2026-12-01', '2026-12-31');
  assert.deepEqual(result.rows.map(r => [r.cve, r.product]), [['DEC-A', 'PHP']]);
  assert.equal(result.total, 1);
});
