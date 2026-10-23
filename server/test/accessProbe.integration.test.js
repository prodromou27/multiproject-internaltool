const { test, assert, api, db, ids } = require('./lib/activityFixture');

// An engineer must not read another customer's records by changing the id in a URL.
test('an engineer cannot reach a customer they are not assigned to through any customer endpoint', async () => {
  const other = ids.customerUnassigned;
  const project = (await db.prepare('INSERT INTO projects (title, customer_id, created_by) VALUES (?, ?, ?)').run('Other Corp rollout', other, ids.manager)).lastInsertRowid;
  const visit = (await db.prepare("INSERT INTO maintenance_visits (customer_id, title, scheduled_date, status, created_by) VALUES (?, 'Other Corp visit', '2026-10-20', 'scheduled', ?)").run(other, ids.manager)).lastInsertRowid;
  const paths = [
    `/api/customers/${other}`,
    `/api/customers/${other}/assets`,
    `/api/customers/${other}/operations/summary`,
    `/api/customers/${other}/operations/timeline`,
    `/api/customers/${other}/recommendations`,
    `/api/customers/${other}/overview`,
    `/api/service-activities/assets?customer_id=${other}`,
    `/api/reminders/customer/${other}`,
    `/api/projects/${project}`,
    `/api/maintenance-visits/${visit}`,
    `/api/managed-customers/${other}/overview`,
  ];
  const leaks = [], wrongPaths = [];
  for (const path of paths) {
    // The path must exist (a manager can open it), so a refusal really is a refusal.
    const allowed = await api(path, { token: ids.tokenManager });
    if (allowed.status >= 400 && !path.includes('/managed-customers/')) wrongPaths.push(`${path} -> ${allowed.status} for a manager`);
    const response = await api(path, { token: ids.tokenEnabled });
    if (response.status < 400) leaks.push(`${path} -> ${response.status}`);
  }
  assert.deepEqual(wrongPaths, [], `probe paths that do not exist:\n${wrongPaths.join('\n')}`);
  assert.deepEqual(leaks, [], `reachable without access:\n${leaks.join('\n')}`);
});
