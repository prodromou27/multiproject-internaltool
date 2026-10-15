// Visit import: reviewed first; re-importing the same file adds nothing.
const { test, assert, db, ids } = require('./lib/activityFixture');
const suiteFixture = require('./lib/activityFixture');
const ExcelJS = require('exceljs');

async function workbook(rows) {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Visits');
  sheet.addRow(['customer_name*', 'title*', 'scheduled_date*', 'engineer_names', 'notes']);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await book.xlsx.writeBuffer());
}
async function send(path, buffer, extra = {}, token = ids.tokenManager) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'visits.xlsx');
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  const res = await fetch(`${suiteFixture.baseUrl}/api/maintenance-visits/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'X-SolutionsHub-Request': '1' }, body: form });
  return { status: res.status, data: await res.json() };
}
const visits = async () => Number((await db.prepare('SELECT COUNT(*) AS n FROM maintenance_visits').get()).n);

let file;
test('a review lists new visits, ones already planned, and rows that cannot go in; nothing changes', async () => {
  await db.prepare("INSERT INTO maintenance_visits (customer_id, title, scheduled_date, status, created_by) VALUES (?, 'Quarterly check', '2027-03-08', 'scheduled', ?)").run(ids.customer, ids.manager);
  await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value')
    .run('business_calendar', JSON.stringify({ working_days: [1, 2, 3, 4, 5], holidays: [{ date: '2027-03-25', name: 'Independence Day' }] }));
  file = await workbook([
    ['Acme Corp', 'Firewall upgrade', '2027-03-09', 'Engineer Enabled', ''],
    ['Acme Corp', 'Quarterly check', '08/03/2027', '', ''],
    ['Acme Corp', 'Firewall upgrade', '2027-03-09', '', 'same again'],
    ['Nobody Ltd', 'Check', '2027-03-10', '', ''],
    ['Acme Corp', 'Bad date', 'next week', '', ''],
    ['Acme Corp', 'Ghost engineer', '2027-03-11', 'No Such Person', ''],
    ['Acme Corp', 'Holiday visit', '2027-03-25', '', ''],
  ]);
  const before = await visits();
  const res = await send('import/preview', file);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.deepEqual(res.data.counts, { create: 2, update: 0, unchanged: 1, errors: 4, duplicates: 1, total: 7 });
  const byTitle = Object.fromEntries(res.data.rows.map(r => [`${r.row}:${r.name}`, r]));
  assert.equal(byTitle['3:Quarterly check'].action, 'unchanged', 'DD/MM/YYYY is read too');
  assert.equal(byTitle['4:Firewall upgrade'].kind, 'duplicate');
  assert.match(byTitle['6:Bad date'].error, /must be a date/);
  assert.match(byTitle['7:Ghost engineer'].error, /Engineer not found/);
  assert.equal(byTitle['8:Holiday visit'].action, 'create');
  assert.equal(byTitle['8:Holiday visit'].error, 'Public holiday: Independence Day', 'flagged, still planned');
  assert.equal(await visits(), before);
  assert.equal((await send('import/preview', file, {}, ids.tokenEnabled)).status, 403);
});

test('the reviewed import adds the new visits with their engineers; doing it again adds nothing', async () => {
  const review = (await send('import/preview', file)).data;
  const before = await visits();
  const done = await send('import', file, { preview_token: review.token });
  assert.equal(done.status, 200, JSON.stringify(done.data));
  assert.deepEqual([done.data.imported, done.data.skipped], [2, 5]);
  assert.equal(await visits(), before + 2);
  const upgrade = await db.prepare("SELECT id FROM maintenance_visits WHERE title = 'Firewall upgrade'").get();
  assert.ok(await db.prepare('SELECT 1 FROM maintenance_visit_engineers WHERE visit_id = ? AND user_id = ?').get(upgrade.id, ids.engineerEnabled));
  assert.equal((await send('import', file, { preview_token: review.token })).data.code, 'IMPORT_CHANGED', 'the old review no longer fits');
  const again = await send('import', file);
  assert.equal(again.data.imported, 0, 'no review (scripts): the same file adds nothing');
});
