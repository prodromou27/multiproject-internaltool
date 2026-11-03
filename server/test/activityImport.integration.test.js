// Activity import: an engineer fills in the template made for them; the import is
// reviewed first, runs every row through the form's checks and skips what is already logged.
const { test, assert, api, db, ids } = require('./lib/activityFixture');
const suiteFixture = require('./lib/activityFixture');
const ExcelJS = require('exceljs');

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
async function template(token = ids.tokenEnabled) {
  const res = await fetch(`${suiteFixture.baseUrl}/api/service-activities/template/download`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, buffer: res.status === 200 ? Buffer.from(await res.arrayBuffer()) : null };
}
// Fills the downloaded template in, the way an engineer would.
async function filled(rows) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await template()).buffer);
  const sheet = book.getWorksheet('Activities');
  rows.forEach((row, i) => { if (row) row.forEach((value, c) => { sheet.getRow(i + 2).getCell(c + 1).value = value; }); });
  return Buffer.from(await book.xlsx.writeBuffer());
}
async function send(path, buffer, extra = {}, token = ids.tokenEnabled) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: XLSX }), 'activities.xlsx');
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  const res = await fetch(`${suiteFixture.baseUrl}/api/service-activities/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'X-SolutionsHub-Request': '1' }, body: form });
  return { status: res.status, data: await res.json() };
}
const mine = async () => db.prepare('SELECT * FROM service_activities WHERE engineer_id = ? ORDER BY id').all(ids.engineerEnabled);
const categoryName = async () => (await db.prepare('SELECT name FROM activity_categories WHERE id = ?').get(ids.category)).name;

test('the template lists only the customers and categories the engineer can log for, as drop-downs', async () => {
  const { status, buffer } = await template();
  assert.equal(status, 200);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer);
  assert.equal(book.worksheets[0].name, 'Activities');
  const headers = book.worksheets[0].getRow(1).values.slice(1);
  assert.deepEqual(headers.slice(0, 3), ['Customer*', 'Date*', 'Category*']);
  const customers = [];
  book.getWorksheet('Lists').getColumn(1).eachCell((cell, row) => { if (row > 1 && cell.value) customers.push(cell.value); });
  assert.deepEqual(customers, ['Acme Corp'], 'not Other Corp, which is not one of the engineer\'s customers');
  // Written as one range; ExcelJS reads it back cell by cell.
  const validations = book.worksheets[0].dataValidations.model;
  for (const cell of ['A2', 'A1001']) {
    assert.equal(validations[cell]?.type, 'list');
    assert.equal(validations[cell].formulae[0], 'Lists!$A$2:$A$2');
  }

  assert.equal((await template(ids.tokenDisabled)).status, 403, 'an engineer whose team does not track activity');
  assert.equal((await template(ids.tokenPlanner)).status, 403);
});

let file;
test('a review shows each row as new, already logged or not imported, and nothing is saved', async () => {
  const category = await categoryName();
  const before = (await mine()).length;
  file = await filled([
    ['Acme Corp', '2025-06-02', category, '', 'Firewall rule review', '09:00', '10:30'],
    // A real date and time cell, as Excel stores them when typed in.
    ['Acme Corp', new Date(Date.UTC(2025, 5, 3)), category, '', 'Patch window', new Date(Date.UTC(1899, 11, 30, 14, 0)), '15:15'],
    null,
    ['Acme Corp', '2025-06-02', category, '', 'Firewall rule review', '09:00', '10:30'],
    ['Other Corp', '2025-06-02', category, '', 'Not my customer'],
    ['Acme Corp', '2999-01-01', category, '', 'From the future'],
    ['Acme Corp', '2025-06-02', 'No such category'],
    ['', '2025-06-02', category],
  ]);
  const { status, data } = await send('import/preview', file);
  assert.equal(status, 200);
  assert.deepEqual({ ...data.counts }, { create: 2, update: 0, unchanged: 0, errors: 5, duplicates: 1, total: 7 });
  const byRow = Object.fromEntries(data.rows.map(r => [r.row, r]));
  assert.equal(byRow[5].kind, 'duplicate');
  assert.match(byRow[6].error, /cannot log activity for "Other Corp"/);
  assert.match(byRow[7].error, /future/);
  assert.match(byRow[8].error, /Unknown category/);
  assert.match(byRow[9].error, /Missing: Customer/);
  assert.equal(byRow[4], undefined, 'a blank row is left out, not reported');
  assert.equal((await mine()).length, before);
  file = { buffer: file, token: data.token };
});

test('importing saves the new rows with times worked out, then the same file is skipped as already logged', async () => {
  const before = (await mine()).length;
  const { status, data } = await send('import', file.buffer, { preview_token: file.token });
  assert.equal(status, 200);
  assert.equal(data.imported, 2);
  assert.equal(data.skipped, 5);
  const saved = (await mine()).slice(before);
  assert.equal(saved.length, 2);
  const review = saved.find(a => a.title === 'Firewall rule review');
  assert.equal(Number(review.duration_minutes), 90);
  assert.equal(String(review.start_time).slice(0, 5), '09:00');
  assert.equal(Number(review.customer_id), ids.customer);
  const patch = saved.find(a => a.title === 'Patch window');
  assert.equal(String(patch.activity_date).slice(0, 10) === '2025-06-03' || new Date(patch.activity_date).toISOString().slice(0, 10) === '2025-06-03', true);
  assert.equal(Number(patch.duration_minutes), 75);
  const audit = await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'activity_imported'").get();
  assert.equal(Number(audit.n), 2);

  // Both saved rows, and the row that repeated one of them, are now already logged.
  const again = await send('import/preview', file.buffer);
  assert.equal(again.data.counts.create, 0);
  assert.equal(again.data.counts.unchanged, 3);
  assert.match(again.data.rows.find(r => r.action === 'unchanged').error, /Already logged/);
});

test('an activity already logged from the form is recognised; a stale review is refused', async () => {
  const category = await categoryName();
  const created = await api('/api/service-activities', { method: 'POST', token: ids.tokenEnabled,
    body: { customer_id: ids.customer, activity_date: '2025-06-04', category_id: ids.category, title: 'Logged by hand', start_time: '08:00', duration_minutes: 30 } });
  assert.equal(created.status, 200);
  const buffer = await filled([
    ['Acme Corp', '2025-06-04', category, '', 'Logged by hand', '08:00', '', 30],
    ['Acme Corp', '2025-06-05', category, '', 'Only in the file'],
  ]);
  const review = await send('import/preview', buffer);
  assert.equal(review.data.counts.unchanged, 1);
  assert.equal(review.data.counts.create, 1);

  // Something logged after the review: the import asks for a new one instead of guessing.
  await api('/api/service-activities', { method: 'POST', token: ids.tokenEnabled,
    body: { customer_id: ids.customer, activity_date: '2025-06-06', category_id: ids.category, title: 'In between' } });
  const stale = await send('import', buffer, { preview_token: review.data.token });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.code, 'IMPORT_CHANGED');
  assert.equal(stale.data.preview.counts.create, 1);

  assert.equal((await send('import/preview', buffer, {}, ids.tokenDisabled)).status, 403);
  const notExcel = await send('import/preview', Buffer.from('name,date\nx,y'));
  assert.equal(notExcel.status, 400);
});
