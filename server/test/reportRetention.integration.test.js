// Customer report files are removed after the retention period; the history stays and can be generated again.
// A field key, so the stored request is encrypted as in production.
process.env.CUSTOMER_FIELD_KEY = process.env.CUSTOMER_FIELD_KEY || 'c'.repeat(64);
const fs = require('fs');
const path = require('path');
const { test, assert, api, db, ids } = require('./lib/activityFixture');
const reportHistory = require('../managedReportHistoryService');
const retention = require('../reportRetention');
const { uploadDir } = require('../uploadUtils');

let oldReport, inReview, recent;
const archive = (from, request) => reportHistory.archive({ customerId: ids.customer, templateId: null, from, to: from.replace(/-01$/, '-28'), format: 'pdf', status: 'draft',
  filename: `report_${from}.pdf`, sections: ['changes'], userId: ids.manager, buffer: Buffer.from(`%PDF report ${from}`), request });
const fileOf = async id => path.join(uploadDir, (await db.prepare('SELECT stored_name FROM managed_report_history WHERE id = ?').get(id)).stored_name);

test('settings: managers choose how long report files are kept and see what is stored', async () => {
  await db.prepare('INSERT INTO managed_customer_configurations (customer_id, managed_services_enabled) VALUES (?, 1) ON CONFLICT (customer_id) DO UPDATE SET managed_services_enabled = 1').run(ids.customer);
  oldReport = (await archive('2026-01-01', { from: '2026-01-01', to: '2026-01-31', sections: ['changes'], summary: 'A quiet month', coming_next: '' })).id;
  inReview = (await archive('2026-02-01')).id;
  recent = (await archive('2026-09-01')).id;
  await db.prepare("UPDATE managed_report_history SET generated_at = '2026-02-05 10:00:00' WHERE id IN (?, ?)").run(oldReport, inReview);
  await db.prepare("UPDATE managed_report_history SET workflow_status = 'in_review' WHERE id = ?").run(inReview);

  const get = await api('/api/settings/report-retention', { token: ids.tokenManager });
  assert.equal(get.status, 200, JSON.stringify(get.data));
  assert.equal(get.data.days, 90, 'three months unless changed');
  assert.ok(get.data.usage.report_files >= 3);
  assert.equal((await api('/api/settings/report-retention', { token: ids.tokenEnabled })).status, 403);
  const put = days => api('/api/settings/report-retention', { method: 'PUT', token: ids.tokenManager, body: { days } });
  assert.equal((await put(10)).status, 400, 'at least 30 days');
  assert.equal((await put(-1)).status, 400);
  assert.equal((await put(0)).status, 200, '0 keeps them always');
  assert.deepEqual(await retention.purge({ today: '2026-10-15' }), { removed: 0, bytes: 0 });
  assert.equal((await put(90)).status, 200);
});

test('old files are removed (not those in review); the history stays and says how to make it again', async () => {
  const oldFile = await fileOf(oldReport);
  assert.ok(fs.existsSync(oldFile));
  const result = await retention.purge({ today: '2026-10-15' });
  assert.equal(result.removed, 1);
  assert.ok(result.bytes > 0);
  assert.equal(fs.existsSync(oldFile), false, 'the file is gone');
  assert.ok(fs.existsSync(await fileOf(inReview)), 'a report in review keeps its file');
  assert.ok(fs.existsSync(await fileOf(recent)), 'a recent report keeps its file');

  const download = await fetch(`${require('./lib/activityFixture').baseUrl}/api/managed-customers/${ids.customer}/reports/${oldReport}/download`, { headers: { Authorization: `Bearer ${ids.tokenManager}` } });
  assert.equal(download.status, 410);
  assert.equal((await download.json()).code, 'FILE_REMOVED');

  const history = (await api(`/api/managed-customers/${ids.customer}/reports`, { token: ids.tokenManager })).data.rows;
  const row = history.find(r => r.id === oldReport);
  assert.ok(row.file_removed_at);
  assert.deepEqual(row.request, { from: '2026-01-01', to: '2026-01-31', sections: ['changes'], summary: 'A quiet month', coming_next: '' }, 'what it was made from, to make it again');
  const stored = (await db.prepare('SELECT request FROM managed_report_history WHERE id = ?').get(oldReport)).request;
  assert.doesNotMatch(stored, /A quiet month/, 'kept encrypted');
  assert.equal(history.find(r => r.id === recent).file_removed_at, null);
  assert.equal((await retention.purge({ today: '2026-10-15' })).removed, 0, 'once only');
});
