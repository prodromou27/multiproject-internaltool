// Asset import: reviewed before anything changes, row by row, bound to the file.
const { test, assert, db, ids } = require('./lib/activityFixture');
const suiteFixture = require('./lib/activityFixture');
const ExcelJS = require('exceljs');
const { encrypt } = require('../fieldCipher');

async function workbook(rows) {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Assets');
  sheet.addRow(['name*', 'asset_type*', 'asset_tag', 'hostname', 'serial_number', 'technology']);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await book.xlsx.writeBuffer());
}
async function send(path, buffer, extra = {}, token = ids.tokenManager) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'assets.xlsx');
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  const res = await fetch(`${suiteFixture.baseUrl}/api/customers/${ids.customer}/assets/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'X-SolutionsHub-Request': '1' }, body: form });
  return { status: res.status, data: await res.json() };
}
const count = async () => Number((await db.prepare('SELECT COUNT(*) AS n FROM customer_assets WHERE customer_id = ?').get(ids.customer)).n);

let file;
test('a review lists every row: new, already there, or not imported with the reason; nothing changes', async () => {
  await db.prepare("INSERT INTO customer_assets (customer_id, name, asset_type, hostname, created_by) VALUES (?, 'Existing firewall', 'firewall', ?, ?)").run(ids.customer, encrypt('fw-existing'), ids.manager);
  file = await workbook([
    ['New switch', 'switch', 'TAG-1', 'sw-new-1', 'SN-1', ''],
    ['Same as existing', 'firewall', '', 'FW-EXISTING', '', ''],
    ['Repeats a tag', 'switch', 'TAG-1', 'sw-new-2', '', ''],
    ['No type', '', '', '', '', ''],
    ['Bad technology', 'server', '', 'srv-1', '', 'NoSuchTech'],
    ['Second new', 'server', 'TAG-2', 'srv-2', '', ''],
  ]);
  const before = await count();
  const res = await send('import/preview', file);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.deepEqual(res.data.counts, { create: 2, exists: 1, errors: 3, duplicates: 1, total: 6, update: 0, unchanged: 1 });
  const byName = Object.fromEntries(res.data.rows.map(r => [r.name, r]));
  assert.equal(byName['Same as existing'].action, 'unchanged');
  assert.match(byName['Same as existing'].error, /Already there: Existing firewall/);
  assert.equal(byName['Repeats a tag'].kind, 'duplicate');
  assert.equal(byName['Bad technology'].error, 'technology is not an active configured value');
  assert.equal(byName['Bad technology'].values.technology, 'NoSuchTech', 'the row as given, for the correction file');
  assert.equal(await count(), before, 'nothing imported by a review');
  assert.equal((await send('import/preview', file, {}, ids.tokenEnabled)).status, 403);
});

test('the reviewed import adds the new rows only; a changed file or asset list needs a new review', async () => {
  const review = (await send('import/preview', file)).data;
  const other = await workbook([['Other', 'switch', '', 'other-1', '', '']]);
  assert.equal((await send('import', other, { preview_token: review.token })).data.code, 'IMPORT_CHANGED', 'another file');

  await db.prepare("INSERT INTO customer_assets (customer_id, name, asset_type, created_by) VALUES (?, 'Added meanwhile', 'server', ?)").run(ids.customer, ids.manager);
  const refused = await send('import', file, { preview_token: review.token });
  assert.equal(refused.status, 409);
  assert.equal(refused.data.preview.counts.create, 2, 'with a fresh review');

  const before = await count();
  const done = await send('import', file, { preview_token: refused.data.preview.token });
  assert.equal(done.status, 201, JSON.stringify(done.data));
  assert.deepEqual([done.data.imported, done.data.skipped], [2, 4]);
  assert.equal(await count(), before + 2);
  const again = (await send('import/preview', file)).data;
  assert.deepEqual([again.counts.create, again.counts.exists], [0, 4], 'importing the same file again adds nothing (the repeated tag now matches the imported asset)');
});

test('without a review (scripts), the import stays all or nothing', async () => {
  const bad = await workbook([['Fine', 'switch', '', 'fine-1', '', ''], ['No type', '', '', '', '', '']]);
  const res = await send('import', bad);
  assert.equal(res.status, 400);
  assert.equal(res.data.error, 'Row 3: Asset type must contain 1 to 100 characters');
});
