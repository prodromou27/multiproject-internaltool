const { test, assert, api, db, ids } = require('./lib/activityFixture');

// pg-mem cannot run the manager directory's correlated visit count; CI runs this on PostgreSQL.
test('Customers has a Managed view listing only managed-service customers', { skip: process.env.TEST_DATABASE_URL ? false : 'needs TEST_DATABASE_URL (a real PostgreSQL database)' }, async () => {
  const managed = (await db.prepare('INSERT INTO customers (name, active) VALUES (?, 1)').run('Managed View Customer')).lastInsertRowid;
  await db.prepare('INSERT INTO managed_customer_configurations (customer_id, managed_services_enabled) VALUES (?, 1)').run(managed);
  const off = (await db.prepare('INSERT INTO customers (name, active) VALUES (?, 1)').run('Switched Off Customer')).lastInsertRowid;
  await db.prepare('INSERT INTO managed_customer_configurations (customer_id, managed_services_enabled) VALUES (?, 0)').run(off);

  const view = await api('/api/customers?paged=1&page=1&page_size=100&view=managed', { token: ids.tokenManager });
  assert.equal(view.status, 200);
  const names = view.data.rows.map(row => row.name);
  assert.ok(names.includes('Managed View Customer'));
  assert.ok(!names.includes('Switched Off Customer'));
  assert.ok(view.data.rows.every(row => row.is_managed === true));
  assert.equal(view.data.counts.managed, view.data.total);
  const all = await api('/api/customers?paged=1&page=1&page_size=100&view=all', { token: ids.tokenManager });
  assert.ok(all.data.counts.all > all.data.counts.managed);
  assert.equal((await api('/api/customers?paged=1&view=bogus', { token: ids.tokenManager })).status, 400);
});
