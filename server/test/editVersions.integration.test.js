// Edit versions: a save made against an old copy is refused, never silently overwrites (review I04).
const { test, assert, api, ids } = require('./lib/activityFixture');

const as = (method, path, body) => api(path, { method, token: ids.tokenManager, body });

async function bothEdit(path, opened, first, second) {
  const a = await as('PUT', path, { ...first, version: opened });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  const b = await as('PUT', path, { ...second, version: opened });
  assert.equal(b.status, 409, 'the second editor opened the same version');
  assert.equal(b.data.code, 'EDIT_CONFLICT');
  assert.equal(b.data.current.edit_version, opened + 1, 'the record as it is now, to compare against');
  return b.data.current;
}

test('customers: the second of two editors gets the current record instead of overwriting', async () => {
  const opened = (await as('GET', `/api/customers/${ids.customer}`)).data;
  assert.ok(Number.isInteger(opened.edit_version));
  const current = await bothEdit(`/api/customers/${ids.customer}`, opened.edit_version, { notes: 'First editor' }, { notes: 'Second editor' });
  assert.equal(current.notes, 'First editor', 'decrypted, as the form shows it');

  // "Keep my changes": save again against the version now saved.
  const kept = await as('PUT', `/api/customers/${ids.customer}`, { notes: 'Second editor', version: current.edit_version });
  assert.equal(kept.status, 200, JSON.stringify(kept.data));
  assert.equal((await as('GET', `/api/customers/${ids.customer}`)).data.notes, 'Second editor');

  // A save without a version (a quick change) still works and still moves the version on.
  const before = (await as('GET', `/api/customers/${ids.customer}`)).data.edit_version;
  assert.equal((await as('PUT', `/api/customers/${ids.customer}`, { notes: 'Quick' })).status, 200);
  assert.equal((await as('GET', `/api/customers/${ids.customer}`)).data.edit_version, before + 1);
  assert.equal((await as('PUT', `/api/customers/${ids.customer}`, { notes: 'x', version: 'abc' })).status, 400);
});

test('projects: the same, and quick status changes do not need a version', async () => {
  const made = await as('POST', '/api/projects', { title: 'Versioned project', customer_id: ids.customer });
  assert.ok([200, 201].includes(made.status), JSON.stringify(made.data));
  const id = made.data.id;
  const opened = (await as('GET', `/api/projects/${id}`)).data;
  const current = await bothEdit(`/api/projects/${id}`, opened.edit_version, { title: 'Renamed by A' }, { title: 'Renamed by B' });
  assert.equal(current.title, 'Renamed by A');
  assert.equal((await as('PUT', `/api/projects/${id}`, { priority: 'high' })).status, 200);
  assert.equal((await as('GET', `/api/projects/${id}`)).data.title, 'Renamed by A', 'nothing was overwritten');
});

test('visits: the same for managers and planners', async () => {
  const made = await as('POST', '/api/maintenance-visits', { customer_id: ids.customer, title: 'Versioned visit', scheduled_date: '2027-06-08', engineer_ids: [], confirm_warnings: true });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  const id = made.data.id;
  const opened = (await as('GET', `/api/maintenance-visits/${id}`)).data;
  const current = await bothEdit(`/api/maintenance-visits/${id}`, opened.edit_version,
    { title: 'Visit A', scheduled_date: '2027-06-08', confirm_warnings: true },
    { title: 'Visit B', scheduled_date: '2027-06-09', confirm_warnings: true });
  assert.equal(current.title, 'Visit A');
  assert.equal(String(current.scheduled_date).slice(0, 10), '2027-06-08');
});
