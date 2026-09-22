const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./lib/harness');

let h, manager, customer;

test.before(async () => {
  h = await harness.start({ '/api/customers': require('../routes/customers') });
  manager = await h.makeUser('Writeback Config Manager', 'manager');
  customer = (await h.db.prepare("INSERT INTO customers (name, active) VALUES ('Writeback Config Co', 1)").run()).lastInsertRowid;
  // The customer-level "enable ticket integration" toggle requires the org-wide RT
  // integration itself to be enabled first — not what this test is about, so satisfy
  // it directly rather than going through the full RT settings validation/encryption.
  await h.db.prepare("INSERT INTO settings (key, value) VALUES ('ticketing_rt', ?)")
    .run(JSON.stringify({ enabled: true, base_url: 'https://rt.example.test', api_token: 'irrelevant-for-this-test', sync_interval_minutes: 60 }));
});
test.after(() => h.stop());

function baseBody(overrides) {
  return {
    managed_services_enabled: true, service_activity_tracking_enabled: false,
    task_reporting_enabled: true, project_reporting_enabled: true, maintenance_visit_reporting_enabled: true,
    recommendation_tracking_enabled: true, include_in_managed_services_reports: true,
    ticket_integration_enabled: false, ticket_include_in_reporting: true,
    ticket_write_back_enabled: false, ticket_write_back_status: '',
    external_queue_id: '', external_queue_name: '', version: 0, ...overrides,
  };
}

test('write-back cannot be enabled without ticket integration or a status value', async () => {
  const put = body => h.api(`/api/customers/${customer}/managed-services`, { method: 'PUT', token: manager.token, body });

  const noIntegration = await put(baseBody({ ticket_write_back_enabled: true, ticket_write_back_status: 'resolved' }));
  assert.equal(noIntegration.status, 400);
  assert.match(noIntegration.data.error, /ticket integration/i);

  const noStatus = await put(baseBody({
    ticket_integration_enabled: true, external_queue_id: '11', external_queue_name: 'Support',
    ticket_write_back_enabled: true, ticket_write_back_status: '',
  }));
  assert.equal(noStatus.status, 400);
  assert.match(noStatus.data.error, /status value/i);

  const tooLong = await put(baseBody({
    ticket_integration_enabled: true, external_queue_id: '11', external_queue_name: 'Support',
    ticket_write_back_enabled: true, ticket_write_back_status: 'x'.repeat(101),
  }));
  assert.equal(tooLong.status, 400);
});

test('a valid write-back configuration saves and round-trips', async () => {
  const saved = await h.api(`/api/customers/${customer}/managed-services`, { method: 'PUT', token: manager.token, body: baseBody({
    ticket_integration_enabled: true, external_queue_id: '11', external_queue_name: 'Support',
    ticket_write_back_enabled: true, ticket_write_back_status: 'resolved',
  }) });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.ticket_write_back_enabled, true);
  assert.equal(saved.data.ticket_write_back_status, 'resolved');

  const fetched = await h.api(`/api/customers/${customer}/managed-services`, { token: manager.token });
  assert.equal(fetched.data.ticket_write_back_enabled, true);
  assert.equal(fetched.data.ticket_write_back_status, 'resolved');

  // Turning integration off must be rejected while write-back is still enabled in the same payload...
  const conflicting = await h.api(`/api/customers/${customer}/managed-services`, { method: 'PUT', token: manager.token, body: baseBody({
    ticket_integration_enabled: false, ticket_write_back_enabled: true, ticket_write_back_status: 'resolved', version: fetched.data.version,
  }) });
  assert.equal(conflicting.status, 400);
});
