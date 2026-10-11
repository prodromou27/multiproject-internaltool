const { test, assert, db, ids } = require('./lib/activityFixture');
const suiteFixture = require('./lib/activityFixture');
const ExcelJS = require('exceljs');
const { decryptCustomer } = require('../fieldCipher');

async function upload(content, name, { token = ids.tokenManager, updateExisting = false, type = 'text/csv' } = {}) {
  const form = new FormData();
  form.append('file', new Blob([content], { type }), name);
  if (updateExisting) form.append('update_existing', '1');
  const res = await fetch(`${suiteFixture.baseUrl}/api/customers/import`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'X-SolutionsHub-Request': '1' }, body: form });
  return { status: res.status, data: await res.json() };
}
const customerNamed = async name => (await db.prepare('SELECT * FROM customers').all()).map(decryptCustomer).find(c => c.name === name);
const managedConfig = async id => db.prepare('SELECT managed_services_enabled, responsible_team_id FROM managed_customer_configurations WHERE customer_id = ?').get(id);

test('a CSV marks customers as managed and links their team', async () => {
  const csv = 'name*;customer_code;contact_email;location;managed;team\n'
    + 'Import Alpha;ALPHA;ops@alpha.example;Nicosia;yes;Security Team\n'
    + 'Import Beta;;;Limassol;no;\n'
    + 'Import Gamma;;not-an-email;;;\n'
    + 'Import Delta;;;;maybe;\n'
    + 'Import Epsilon;;;;yes;No Such Team\n'
    + 'Import Alpha;;;;;\n';
  const res = await upload(csv, 'customers.csv');
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.deepEqual([res.data.imported, res.data.managed, res.data.skipped], [2, 1, 4]);
  assert.deepEqual(res.data.errors.map(e => e.row), [4, 5, 6, 7]);

  const alpha = await customerNamed('Import Alpha');
  assert.deepEqual([alpha.customer_code, alpha.contact_email, alpha.location, alpha.service_activity_enabled], ['ALPHA', 'ops@alpha.example', 'Nicosia', 1]);
  assert.deepEqual(await managedConfig(alpha.id), { managed_services_enabled: 1, responsible_team_id: ids.teamEnabled });
  assert.ok(await db.prepare('SELECT 1 FROM customer_teams WHERE customer_id = ? AND team_id = ?').get(alpha.id, ids.teamEnabled));
  const beta = await customerNamed('Import Beta');
  assert.equal(await managedConfig(beta.id), undefined, 'not managed');
  const audit = await db.prepare("SELECT detail FROM audit_log WHERE action = 'customers_imported' ORDER BY id DESC LIMIT 1").get();
  assert.match(audit.detail, /imported=2; updated=0; managed=1; skipped=4/);
});

test('existing customers are skipped, or updated and marked managed when asked', async () => {
  const csv = 'name,contact_name,managed\nImport Beta,Bob Jones,yes\n';
  const skipped = await upload(csv, 'again.csv');
  assert.deepEqual([skipped.data.imported, skipped.data.skipped], [0, 1]);
  const updated = await upload(csv, 'again.csv', { updateExisting: true });
  assert.deepEqual([updated.data.imported, updated.data.updated, updated.data.managed], [0, 1, 1]);
  const beta = await customerNamed('Import Beta');
  assert.deepEqual([beta.contact_name, beta.location], ['Bob Jones', 'Limassol'], 'empty columns leave values alone');
  assert.equal((await managedConfig(beta.id)).managed_services_enabled, 1);
});

test('Excel works too; planners may import but not mark customers as managed', async () => {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Customers');
  sheet.addRow(['name*', 'managed', 'team']);
  sheet.addRow(['Import Zeta', 'no', 'Security Team']);
  sheet.addRow(['Import Eta', 'yes', '']);
  const res = await upload(await book.xlsx.writeBuffer(), 'customers.xlsx', { token: ids.tokenPlanner, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.deepEqual([res.data.imported, res.data.skipped], [1, 1]);
  assert.match(res.data.errors[0].error, /Only managers/);
  assert.equal((await upload('name\nX\n', 'x.csv', { token: ids.tokenEnabled })).status, 403);
  assert.equal((await upload('', 'empty.csv')).status, 400);
});
