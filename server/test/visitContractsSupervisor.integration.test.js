// Maintenance visits: a visit can combine more than one of the customer's contracts, and
// of its assigned engineers, exactly one can be flagged its supervisor (enhancement).
const { test, assert, api, db, ids } = require('./lib/activityFixture');

let contractA, contractB, otherCustomerContract;

test('creating a visit can combine two contracts and name a supervisor among its engineers', async () => {
  const mkContract = (customerId, reference) => db.prepare(
    "INSERT INTO customer_contracts (customer_id, reference, start_date, end_date, created_by) VALUES (?, ?, '2026-01-01', '2026-12-31', ?)"
  ).run(customerId, reference, ids.manager).then(r => r.lastInsertRowid);
  contractA = await mkContract(ids.customer, 'CTR-A');
  contractB = await mkContract(ids.customer, 'CTR-B');
  otherCustomerContract = await mkContract(ids.customerUnassigned, 'CTR-OTHER');

  const create = await api('/api/maintenance-visits', { method: 'POST', token: ids.tokenManager, body: {
    customer_id: ids.customer, title: 'Combined contract visit', scheduled_date: '2026-11-02',
    engineer_ids: [ids.engineerEnabled, ids.engineerDisabled], supervisor_id: ids.engineerDisabled,
    contract_ids: [contractA, contractB],
  } });
  assert.equal(create.status, 200, JSON.stringify(create.data));
  const got = await api(`/api/maintenance-visits/${create.data.id}`, { token: ids.tokenManager });
  assert.deepEqual(new Set(got.data.contract_ids), new Set([contractA, contractB]));
  assert.match(got.data.contract_references, /CTR-A/);
  assert.match(got.data.contract_references, /CTR-B/);
  assert.equal(got.data.supervisor_id, ids.engineerDisabled);
  assert.equal(got.data.supervisor_name, 'Engineer Disabled');

  // A contract belonging to a different customer is rejected.
  const badContract = await api('/api/maintenance-visits', { method: 'POST', token: ids.tokenManager, body: {
    customer_id: ids.customer, title: 'Bad contract', scheduled_date: '2026-11-03', contract_ids: [otherCustomerContract],
  } });
  assert.equal(badContract.status, 400);
  assert.match(badContract.data.error, /belong to the visit customer/);

  // A supervisor who isn't one of the assigned engineers is rejected.
  const badSupervisor = await api('/api/maintenance-visits', { method: 'POST', token: ids.tokenManager, body: {
    customer_id: ids.customer, title: 'Bad supervisor', scheduled_date: '2026-11-04',
    engineer_ids: [ids.engineerEnabled], supervisor_id: ids.engineerDisabled,
  } });
  assert.equal(badSupervisor.status, 400);
  assert.match(badSupervisor.data.error, /one of the assigned engineers/);
});

test('updating supervisor alone keeps the engineer and contract sets; reassigning engineers without a supervisor clears it', async () => {
  const create = await api('/api/maintenance-visits', { method: 'POST', token: ids.tokenManager, body: {
    customer_id: ids.customer, title: 'Supervisor update', scheduled_date: '2026-11-05',
    engineer_ids: [ids.engineerEnabled, ids.engineerDisabled], supervisor_id: ids.engineerEnabled, contract_ids: [contractA],
  } });
  const id = create.data.id;

  // Flip the supervisor without touching engineer_ids or contract_ids.
  const flip = await api(`/api/maintenance-visits/${id}`, { method: 'PUT', token: ids.tokenManager, body: { supervisor_id: ids.engineerDisabled } });
  assert.equal(flip.status, 200, JSON.stringify(flip.data));
  let got = await api(`/api/maintenance-visits/${id}`, { token: ids.tokenManager });
  assert.equal(got.data.supervisor_id, ids.engineerDisabled);
  assert.deepEqual(got.data.engineer_ids.sort(), [ids.engineerDisabled, ids.engineerEnabled].sort());
  assert.deepEqual(got.data.contract_ids, [contractA]);

  // Resending the engineer list without a supervisor_id keeps the still-assigned supervisor.
  const keep = await api(`/api/maintenance-visits/${id}`, { method: 'PUT', token: ids.tokenManager, body: { engineer_ids: [ids.engineerEnabled, ids.engineerDisabled] } });
  assert.equal(keep.status, 200, JSON.stringify(keep.data));
  got = await api(`/api/maintenance-visits/${id}`, { token: ids.tokenManager });
  assert.equal(got.data.supervisor_id, ids.engineerDisabled);

  // Dropping the supervisor from the engineer list clears the supervisor.
  const drop = await api(`/api/maintenance-visits/${id}`, { method: 'PUT', token: ids.tokenManager, body: { engineer_ids: [ids.engineerEnabled] } });
  assert.equal(drop.status, 200, JSON.stringify(drop.data));
  got = await api(`/api/maintenance-visits/${id}`, { token: ids.tokenManager });
  assert.equal(got.data.supervisor_id, null);
});

test('import resolves comma-separated contract numbers and a supervisor name, and rejects a supervisor not also listed as an engineer', async () => {
  const ExcelJS = require('exceljs');
  async function workbook(rows) {
    const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Visits');
    sheet.addRow(['customer_name*', 'title*', 'scheduled_date*', 'engineer_names', 'supervisor_name', 'contract_numbers', 'notes']);
    for (const row of rows) sheet.addRow(row);
    return Buffer.from(await book.xlsx.writeBuffer());
  }
  const suiteFixture = require('./lib/activityFixture');
  async function send(path, buffer, extra = {}) {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'visits.xlsx');
    for (const [key, value] of Object.entries(extra)) form.append(key, value);
    const res = await fetch(`${suiteFixture.baseUrl}/api/maintenance-visits/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${ids.tokenManager}`, 'X-SolutionsHub-Request': '1' }, body: form });
    return { status: res.status, data: await res.json() };
  }
  const file = await workbook([
    ['Acme Corp', 'Imported combined visit', '2026-11-10', 'Engineer Enabled, Engineer Disabled', 'Engineer Disabled', 'CTR-A, CTR-B', ''],
    ['Acme Corp', 'Imported bad supervisor', '2026-11-11', 'Engineer Enabled', 'Engineer Disabled', '', ''],
  ]);
  const preview = await send('import/preview', file);
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  const byTitle = Object.fromEntries(preview.data.rows.map(r => [r.name, r]));
  assert.equal(byTitle['Imported combined visit'].action, 'create');
  assert.match(byTitle['Imported bad supervisor'].error, /must also be one of the assigned engineers/);

  const done = await send('import', file, { preview_token: preview.data.token });
  assert.equal(done.status, 200, JSON.stringify(done.data));
  assert.equal(done.data.imported, 1);
  const visit = await db.prepare("SELECT id FROM maintenance_visits WHERE title = 'Imported combined visit'").get();
  const supervisorRow = await db.prepare('SELECT user_id FROM maintenance_visit_engineers WHERE visit_id = ? AND is_supervisor = 1').get(visit.id);
  assert.equal(Number(supervisorRow.user_id), Number(ids.engineerDisabled));
  const contractRows = await db.prepare('SELECT contract_id FROM maintenance_visit_contracts WHERE visit_id = ? ORDER BY contract_id').all(visit.id);
  assert.deepEqual(new Set(contractRows.map(r => Number(r.contract_id))), new Set([Number(contractA), Number(contractB)]));
});
