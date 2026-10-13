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

test('every report uses the company report template set in Settings', async () => {
  const templates = (await api('/api/managed-report-templates', { token: ids.tokenManager })).data;
  assert.equal(templates.wording_defaults.title, 'Service report');
  const template = templates.rows.find(row => row.id === templates.company_template_id);
  assert.ok(template, 'one company template');
  const wording = { title: 'Monthly value report', intro: 'Dear {customer}, here is our work.', show_overview: false, closing: 'Questions? Call us.',
    footer: 'Odyssey · {customer}', color: '#0b6e4f', sections: ['changes', 'tasks'], default_summary: 'Summary for {customer}',
    headings: { work: 'What we did', tasks: 'Finished tasks' }, figures: { hours: 'Hours' }, empty: { changes: 'Nothing changed.' } };
  const saved = await api(`/api/managed-report-templates/${template.id}`, { method: 'PUT', token: ids.tokenManager, body: { ...template, wording } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.wording.title, 'Monthly value report');

  const today = appTime.today();
  const r = (await api(`${base()}/customer-report/preview`, { method: 'POST', token: ids.tokenManager, body: { from: appTime.addDays(today, -5), to: today } })).data;
  assert.equal(r.template.id, template.id);
  assert.deepEqual(r.sections, ['changes', 'tasks'], 'the template chooses the sections ticked by default');
  assert.equal(r.wording.title, 'Monthly value report');
  assert.match(r.wording.intro, /^Dear .+, here is our work\.$/);
  assert.equal(r.wording.headings.work, 'What we did');
  assert.equal(r.wording.headings.summary, 'Summary', 'labels left blank keep the built-in wording');
  assert.equal(r.wording.figures.hours, 'Hours');
  assert.equal(r.wording.show_overview, false);
  assert.match(r.defaults.summary, /^Summary for /);
  const pdf = await download('pdf', { from: appTime.addDays(today, -5), to: today });
  assert.equal(pdf.status, 200);

  const bad = await api(`/api/managed-report-templates/${template.id}`, { method: 'PUT', token: ids.tokenManager, body: { ...saved.data, wording: { color: 'green' } } });
  assert.equal(bad.status, 400);
  assert.equal((await api(`/api/managed-report-templates/${template.id}`, { method: 'PUT', token: ids.tokenManager, body: { ...saved.data, wording: { headings: { nonsense: 'x' } } } })).status, 400);
  assert.equal((await api(`/api/managed-report-templates/${template.id}`, { method: 'PUT', token: ids.tokenEnabled, body: { ...saved.data, wording } })).status, 403);
});

test('the company Word template gets the report title, and its sections follow the parts ticked', async () => {
  const { Document, Packer, Paragraph } = require('docx');
  const PizZip = require('pizzip');
  const lines = ['{report_title} for {customer_name}', '{#include_changes}', 'CHANGES-SECTION', '{/include_changes}', '{#include_recommendations}', 'RECOMMENDATIONS-SECTION', '{/include_recommendations}', '{executive_summary}'];
  const file = await Packer.toBuffer(new Document({ sections: [{ children: lines.map(text => new Paragraph(text)) }] }));
  const { company_template_id: id } = (await api('/api/managed-report-templates', { token: ids.tokenManager })).data;
  const form = new FormData(); form.append('file', new Blob([file]), 'company.docx');
  const upload = await fetch(`${suiteFixture.baseUrl}/api/managed-report-templates/${id}/word-template`, { method: 'POST', headers: { Authorization: `Bearer ${ids.tokenManager}`, 'X-SolutionsHub-Request': '1' }, body: form });
  assert.equal(upload.status, 200, await upload.text());

  const today = appTime.today();
  const word = await download('docx', { from: appTime.addDays(today, -5), to: today, sections: ['recommendations'], summary: 'Quiet month.' });
  assert.equal(word.status, 200);
  const xml = new PizZip(Buffer.from(await word.arrayBuffer())).file('word/document.xml').asText();
  assert.match(xml, /Monthly value report for /, 'the title set in Settings');
  assert.match(xml, /RECOMMENDATIONS-SECTION/);
  assert.doesNotMatch(xml, /CHANGES-SECTION/, 'parts not ticked are left out');
  assert.match(xml, /Quiet month\./);
});
