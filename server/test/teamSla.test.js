const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./lib/harness');
const { DEFAULT_SLA_TARGETS, validateSlaTargets, getTeamSlaTargets } = require('../teamSla');

test('validateSlaTargets rejects non-positive, absurd, or inverted targets', () => {
  assert.deepEqual(validateSlaTargets({ response_hours: 4, resolution_hours: 24 }).value, { response_hours: 4, resolution_hours: 24 });
  assert.ok(validateSlaTargets({ response_hours: 0, resolution_hours: 24 }).error);
  assert.ok(validateSlaTargets({ response_hours: -1, resolution_hours: 24 }).error);
  assert.ok(validateSlaTargets({ response_hours: 'x', resolution_hours: 24 }).error);
  assert.ok(validateSlaTargets({ response_hours: 100000, resolution_hours: 200000 }).error);
  assert.ok(validateSlaTargets({ response_hours: 48, resolution_hours: 4 }).error, 'response cannot exceed resolution');
  assert.ok(validateSlaTargets(null).error);
  assert.ok(validateSlaTargets({}).error);
});

let h, manager, engineer, teamWithTargets, teamWithoutTargets;

test.before(async () => {
  h = await harness.start({ '/api/teams': require('../routes/teams') });
  manager = await h.makeUser('SLA Manager', 'manager');
  engineer = await h.makeUser('SLA Engineer', 'engineer');
  teamWithTargets = (await h.db.prepare('INSERT INTO teams (name) VALUES (?)').run('SLA Team With Targets')).lastInsertRowid;
  teamWithoutTargets = (await h.db.prepare('INSERT INTO teams (name) VALUES (?)').run('SLA Team Without Targets')).lastInsertRowid;
});
test.after(() => h.stop());

test('a team with no configured SLA uses the app-wide defaults', async () => {
  const targets = await getTeamSlaTargets([teamWithoutTargets]);
  assert.deepEqual(targets[teamWithoutTargets], DEFAULT_SLA_TARGETS);
});

test('only managers can set per-team SLA targets, and invalid values are rejected', async () => {
  const body = { response_hours: 4, resolution_hours: 24 };
  assert.equal((await h.api(`/api/teams/${teamWithTargets}/sla`, { method: 'PUT', token: engineer.token, body })).status, 403);
  assert.equal((await h.api(`/api/teams/${teamWithTargets}/sla`, { method: 'PUT', token: manager.token, body: { response_hours: -1, resolution_hours: 24 } })).status, 400);
  assert.equal((await h.api(`/api/teams/${teamWithTargets}/sla`, { method: 'PUT', token: manager.token, body })).status, 200);
  assert.equal((await h.api('/api/teams/99999999/sla', { method: 'PUT', token: manager.token, body })).status, 404);

  const targets = await getTeamSlaTargets([teamWithTargets]);
  assert.deepEqual(targets[teamWithTargets], body);

  const fetched = await h.api(`/api/teams/${teamWithTargets}`, { token: manager.token });
  assert.deepEqual(fetched.data.sla, body);

  // Saving again (update, not insert) works too.
  const updated = { response_hours: 2, resolution_hours: 12 };
  assert.equal((await h.api(`/api/teams/${teamWithTargets}/sla`, { method: 'PUT', token: manager.token, body: updated })).status, 200);
  assert.deepEqual((await getTeamSlaTargets([teamWithTargets]))[teamWithTargets], updated);
});

test('team workflow capabilities combine across memberships without changing authorization', async () => {
  const managed=await h.api('/api/teams',{ method:'POST',token:manager.token,body:{ name:'Managed Operations',service_activity_enabled:true } });
  assert.equal(managed.status,200);
  assert.equal((await h.api(`/api/teams/${managed.data.id}`,{ method:'PUT',token:engineer.token,body:{ project_delivery_enabled:true } })).status,403);
  assert.equal((await h.api(`/api/teams/${managed.data.id}`,{ method:'PUT',token:manager.token,body:{ managed_service_operations:'yes' } })).status,400);
  await h.api(`/api/teams/${managed.data.id}/members`,{ method:'PUT',token:manager.token,body:{ user_ids:[engineer.id] } });
  let mine=await h.api('/api/teams/mine',{ token:engineer.token });
  assert.equal(mine.data.capabilities.profile,'managed_services');
  assert.equal(mine.data.capabilities.managedServiceOperations,true);
  assert.equal(mine.data.capabilities.projectDelivery,false);
  assert.equal(mine.data.capabilities.serviceActivityTracking,true);

  const delivery=await h.api('/api/teams',{ method:'POST',token:manager.token,body:{ name:'Delivery Operations',project_delivery_enabled:true,managed_service_operations:false } });
  await h.api(`/api/teams/${delivery.data.id}/members`,{ method:'PUT',token:manager.token,body:{ user_ids:[engineer.id] } });
  mine=await h.api('/api/teams/mine',{ token:engineer.token });
  assert.equal(mine.data.capabilities.profile,'mixed');
  assert.equal(mine.data.capabilities.managedServiceOperations,true);
  assert.equal(mine.data.capabilities.projectDelivery,true);
  assert.equal(mine.data.teams.length,2);
});
