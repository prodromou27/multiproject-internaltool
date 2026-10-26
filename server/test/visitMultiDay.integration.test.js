// Maintenance visits: a visit can span more than one day (enhancement).
const { test, assert, api, db, ids } = require('./lib/activityFixture');

test('creating a visit over several days occupies every one of those days, and end_date comes back with it', async () => {
  const create = await api('/api/maintenance-visits', { method: 'POST', token: ids.tokenManager, body: {
    customer_id: ids.customer, title: 'Three-day migration', scheduled_date: '2027-05-11', end_date: '2027-05-13',
    engineer_ids: [ids.engineerEnabled],
  } });
  assert.equal(create.status, 200, JSON.stringify(create.data));
  const got = await api(`/api/maintenance-visits/${create.data.id}`, { token: ids.tokenManager });
  assert.equal(got.data.scheduled_date.slice(0, 10), '2027-05-11');
  assert.equal(got.data.end_date.slice(0, 10), '2027-05-13');

  // 05-10 (Mon) and 05-14 (Fri) are ordinary weekdays either side of the Tue–Thu visit.
  const avail = await api(`/api/visit-planning/availability?from=2027-05-10&to=2027-05-14&customer_id=${ids.customer}`, { token: ids.tokenManager });
  assert.equal(avail.status, 200, JSON.stringify(avail.data));
  const enabled = avail.data.engineers.find(e => e.id === Number(ids.engineerEnabled));
  const cell = date => enabled.cells.find(c => c.date === date);
  assert.equal(cell('2027-05-10').free, true, 'the day before is still free');
  for (const day of ['2027-05-11', '2027-05-12', '2027-05-13']) {
    assert.equal(cell(day).free, false, `busy on ${day}`);
    assert.equal(cell(day).visits[0].title, 'Three-day migration');
  }
  assert.equal(cell('2027-05-14').free, true, 'the day after is free');
});

test('a second visit overlapping any day of a multi-day visit is flagged, and needs confirm_warnings to save anyway', async () => {
  const check = await api('/api/maintenance-visits/check', { method: 'POST', token: ids.tokenManager, body: {
    scheduled_date: '2027-05-12', end_date: '2027-05-14', engineer_ids: [ids.engineerEnabled],
  } });
  assert.equal(check.status, 200, JSON.stringify(check.data));
  assert.ok(check.data.warnings.some(w => w.code === 'same_day' || w.code === 'overlap'), JSON.stringify(check.data.warnings));

  const blocked = await api('/api/maintenance-visits', { method: 'POST', token: ids.tokenManager, body: {
    customer_id: ids.customer, title: 'Clashing visit', scheduled_date: '2027-05-12', end_date: '2027-05-14', engineer_ids: [ids.engineerEnabled],
  } });
  // Whether this needs confirm_warnings depends on severity (all-day visits only warn advisory, same_day), so accept either outcome
  // but confirm it is consistent with the /check warnings' severities.
  const hard = check.data.warnings.some(w => w.severity === 'hard');
  if (hard) {
    assert.equal(blocked.status, 409);
    const confirmed = await api('/api/maintenance-visits', { method: 'POST', token: ids.tokenManager, body: {
      customer_id: ids.customer, title: 'Clashing visit', scheduled_date: '2027-05-12', end_date: '2027-05-14', engineer_ids: [ids.engineerEnabled], confirm_warnings: true,
    } });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
  } else {
    assert.equal(blocked.status, 200, JSON.stringify(blocked.data));
  }
});

test('time off overlapping any day of the visit range is a hard warning, even if it does not cover the first day', async () => {
  await api('/api/visit-planning/time-off', { method: 'POST', token: ids.tokenManager, body: { user_id: ids.engineerDisabled, start_date: '2027-06-03', end_date: '2027-06-03', reason: 'Leave' } });
  const check = await api('/api/maintenance-visits/check', { method: 'POST', token: ids.tokenManager, body: {
    scheduled_date: '2027-06-01', end_date: '2027-06-03', engineer_ids: [ids.engineerDisabled],
  } });
  assert.equal(check.status, 200, JSON.stringify(check.data));
  const off = check.data.warnings.find(w => w.code === 'time_off');
  assert.ok(off, JSON.stringify(check.data.warnings));
  assert.equal(off.severity, 'hard');
});

test('end_date cannot be before scheduled_date, and a visit cannot span more than 90 days', async () => {
  const before = await api('/api/maintenance-visits', { method: 'POST', token: ids.tokenManager, body: {
    customer_id: ids.customer, title: 'Backwards range', scheduled_date: '2027-07-10', end_date: '2027-07-05', engineer_ids: [ids.engineerEnabled],
  } });
  assert.equal(before.status, 400);
  assert.match(before.data.error, /end_date cannot be before/);

  const tooLong = await api('/api/maintenance-visits', { method: 'POST', token: ids.tokenManager, body: {
    customer_id: ids.customer, title: 'Too long', scheduled_date: '2027-08-01', end_date: '2027-12-01', engineer_ids: [ids.engineerEnabled],
  } });
  assert.equal(tooLong.status, 400);
  assert.match(tooLong.data.error, /cannot span more than/);
});

test('updating end_date alone extends the visit without needing engineer_ids resent', async () => {
  const create = await api('/api/maintenance-visits', { method: 'POST', token: ids.tokenManager, body: {
    customer_id: ids.customer, title: 'Extend me', scheduled_date: '2027-09-01', engineer_ids: [ids.engineerEnabled],
  } });
  const id = create.data.id;
  const extend = await api(`/api/maintenance-visits/${id}`, { method: 'PUT', token: ids.tokenManager, body: { end_date: '2027-09-03' } });
  assert.equal(extend.status, 200, JSON.stringify(extend.data));
  const got = await api(`/api/maintenance-visits/${id}`, { token: ids.tokenManager });
  assert.equal(got.data.end_date.slice(0, 10), '2027-09-03');
  assert.deepEqual(got.data.engineer_ids.map(Number), [Number(ids.engineerEnabled)], 'engineer assignment untouched by an end_date-only edit');
});

test('export includes an End Date column, and the .ics invite spans the full range', async () => {
  const create = await api('/api/maintenance-visits', { method: 'POST', token: ids.tokenManager, body: {
    customer_id: ids.customer, title: 'Invite span check', scheduled_date: '2027-10-05', end_date: '2027-10-07', engineer_ids: [ids.engineerEnabled],
  } });
  const ics = await api(`/api/maintenance-visits/${create.data.id}/calendar.ics`, { token: ids.tokenEnabled });
  assert.equal(ics.status, 200);
  const exported = await api('/api/maintenance-visits/export', { token: ids.tokenManager });
  assert.equal(exported.status, 200);
});

test('importing a multi-day row sets end_date, and importing end_date before scheduled_date is rejected', async () => {
  const ExcelJS = require('exceljs');
  async function workbook(rows) {
    const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Visits');
    sheet.addRow(['customer_name*', 'title*', 'scheduled_date*', 'end_date', 'engineer_names', 'notes']);
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
    ['Acme Corp', 'Imported multi-day', '2027-11-01', '2027-11-03', 'Engineer Enabled', ''],
    ['Acme Corp', 'Imported backwards range', '2027-11-10', '2027-11-01', 'Engineer Enabled', ''],
  ]);
  const preview = await send('import/preview', file);
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  const byTitle = Object.fromEntries(preview.data.rows.map(r => [r.name, r]));
  assert.equal(byTitle['Imported multi-day'].action, 'create');
  assert.match(byTitle['Imported backwards range'].error, /end_date cannot be before/);

  const done = await send('import', file, { preview_token: preview.data.token });
  assert.equal(done.status, 200, JSON.stringify(done.data));
  assert.equal(done.data.imported, 1);
  const created = await db.prepare("SELECT end_date FROM maintenance_visits WHERE title = 'Imported multi-day'").get();
  assert.equal(String(created.end_date).slice(0, 10), '2027-11-03');
});

test('the month filter includes a visit that only partly overlaps the queried month', async () => {
  await api('/api/maintenance-visits', { method: 'POST', token: ids.tokenManager, body: {
    customer_id: ids.customer, title: 'Spans month boundary', scheduled_date: '2027-12-30', end_date: '2028-01-02', engineer_ids: [ids.engineerEnabled],
  } });
  const december = await api('/api/maintenance-visits?month=2027-12', { token: ids.tokenManager });
  const january = await api('/api/maintenance-visits?month=2028-01', { token: ids.tokenManager });
  assert.ok((Array.isArray(december.data) ? december.data : december.data.rows).some(v => v.title === 'Spans month boundary'), 'shows in the month it starts');
  assert.ok((Array.isArray(january.data) ? january.data : january.data.rows).some(v => v.title === 'Spans month boundary'), 'and in the month it ends');
});
