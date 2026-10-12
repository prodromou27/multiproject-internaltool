const { test, assert, api, db, ids } = require('./lib/activityFixture');
const suiteFixture = require('./lib/activityFixture');
const appTime = require('../appTime');

const base = () => `/api/managed-customers/${ids.customer}`;
const download = (format, body) => fetch(`${suiteFixture.baseUrl}${base()}/customer-report.${format}`, { method: 'POST',
  headers: { Authorization: `Bearer ${ids.tokenManager}`, 'Content-Type': 'application/json', 'X-SolutionsHub-Request': '1' }, body: JSON.stringify(body) });

test('the customer report shows the work, changes and completed tasks of the period, and downloads as PDF or Word', async () => {
  const today = appTime.today(), from = appTime.addDays(today, -20), to = today;
  await db.prepare(`INSERT INTO managed_customer_configurations (customer_id, managed_services_enabled, include_in_managed_services_reports, version, updated_by)
    VALUES (?, 1, 1, 1, ?) ON CONFLICT (customer_id) DO UPDATE SET managed_services_enabled = 1, include_in_managed_services_reports = 1`).run(ids.customer, ids.manager);
  await db.prepare(`INSERT INTO service_activities (activity_reference, customer_id, team_id, engineer_id, activity_date, category_id, title, created_by, duration_minutes, status)
    VALUES ('VR-1', ?, ?, ?, ?, ?, 'Reviewed firewall policies', ?, 90, 'completed')`).run(ids.customer, ids.teamEnabled, ids.engineerEnabled, appTime.addDays(today, -3), ids.category, ids.manager);
  await db.prepare(`INSERT INTO tasks (title, status, customer_id, assigned_to, created_by, completed_at) VALUES ('Imperva upgrade', 'completed', ?, ?, ?, ?)`)
    .run(ids.customer, ids.engineerEnabled, ids.manager, `${appTime.addDays(today, -2)} 10:00:00`);
  const asset = (await api(`/api/customers/${ids.customer}/assets`, { method: 'POST', token: ids.tokenManager, body: { name: 'WAF-01', asset_type: 'WAF', software_version: '14.1' } })).data;
  await api(`/api/customers/${ids.customer}/assets/${asset.id}/review`, { method: 'POST', token: ids.tokenManager, body: { version: asset.version, software_version: '14.2' } });

  const body = { from, to, summary: 'A quiet, stable month.', coming_next: 'Plan the WAF failover test.' };
  const preview = await api(`${base()}/customer-report/preview`, { method: 'POST', token: ids.tokenManager, body });
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  const r = preview.data;
  assert.ok(r.figures.hours >= 1.5 && r.figures.activities >= 1 && r.figures.tasks_completed >= 1, JSON.stringify(r.figures));
  assert.ok(r.categories.length >= 1);
  assert.ok(r.changes.some(c => c.device === 'WAF-01' && c.from === '14.1' && c.to === '14.2'), JSON.stringify(r.changes));
  assert.ok(r.tasks.some(t => t.title === 'Imperva upgrade'));
  assert.deepEqual([r.summary, r.coming_next], ['A quiet, stable month.', 'Plan the WAF failover test.']);
  assert.equal(r.assets, null, 'devices are optional, off by default');

  const pdf = await download('pdf', body);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
  const word = await download('docx', { ...body, sections: ['changes', 'assets'] });
  assert.equal(word.status, 200);
  assert.equal(Buffer.from(await word.arrayBuffer()).subarray(0, 2).toString(), 'PK');
  const history = (await api(`/api/managed-customers/${ids.customer}/reports`, { token: ids.tokenManager })).data.rows;
  assert.deepEqual(history.slice(0, 2).map(h => h.output_format).sort(), ['docx', 'pdf']);

  assert.equal((await api(`${base()}/customer-report/preview`, { method: 'POST', token: ids.tokenManager, body: { ...body, sections: ['nonsense'] } })).status, 400);
  assert.equal((await api(`${base()}/customer-report.xlsx`, { method: 'POST', token: ids.tokenManager, body })).status, 400);
  assert.equal((await api(`${base()}/customer-report.pdf`, { method: 'POST', token: ids.tokenEnabled, body })).status, 403);
});

test('a report made for the period owed counts as done', async () => {
  await db.prepare("UPDATE managed_customer_configurations SET reporting_frequency = 'monthly', created_at = '2020-01-01 00:00:00' WHERE customer_id = ?").run(ids.customer);
  const { periodFor } = require('../managedReportObligations');
  const owed = periodFor('monthly', appTime.today());
  const before = (await api(`/api/managed-customers/${ids.customer}/overview?from=${owed.from}&to=${owed.to}`, { token: ids.tokenManager })).data.report_due;
  assert.equal(before.status, 'not_started');
  assert.equal((await download('pdf', { from: owed.from, to: owed.to })).status, 200);
  const after = (await api(`/api/managed-customers/${ids.customer}/overview?from=${owed.from}&to=${owed.to}`, { token: ids.tokenManager })).data.report_due;
  assert.deepEqual([after.status, after.overdue], ['sent', false]);
});
