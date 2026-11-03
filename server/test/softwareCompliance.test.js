const test = require('node:test');
const assert = require('node:assert/strict');
const { assessVersion, productFor } = require('../softwareCompliance');

const fortios = { id: 1, source: 'fortinet', asset_vendor: 'Fortinet', releases: [
  { branch: '7.4', latest_version: '7.4.8' }, { branch: '7.2', latest_version: '7.2.11', eol: '2026-03-31' }, { branch: '7.6', latest_version: '7.6.3' }] };
const checkpoint = { id: 2, source: 'checkpoint', asset_vendor: 'Check Point', releases: [{ branch: 'R81.20', latest_version: 'Take 170', recommended_version: 'Take 161' }] };
const today = '2026-10-11';

test('numbered versions: behind by patches, current, end of life, unknown line', () => {
  assert.deepEqual(assessVersion('v7.4.3,build2573', fortios, today), { line: '7.4', latest: '7.4.8', recommended: null, status: 'behind', behind: 5, behind_unit: 'patch' });
  assert.equal(assessVersion('7.4.8', fortios, today).status, 'current');
  assert.equal(assessVersion('7.6.4', fortios, today).status, 'current', 'newer than we know is fine');
  assert.deepEqual([assessVersion('7.2.10', fortios, today).status, assessVersion('7.2.10', fortios, today).eol], ['end_of_life', '2026-03-31']);
  assert.deepEqual(assessVersion('7.0.15', fortios, today), { status: 'unknown_line', line: '7.0' });
  assert.equal(assessVersion('latest', fortios, today).status, 'unreadable');
});

test('Check Point: takes behind the latest, and below the recommended one', () => {
  const r = assessVersion('R81.20 Take 141', checkpoint, today);
  assert.deepEqual([r.status, r.behind, r.behind_unit, r.below_recommended], ['behind', 29, 'take', true]);
  assert.equal(assessVersion('R81.20 JHF T170', checkpoint, today).status, 'current');
  assert.equal(assessVersion('R82 Take 60', checkpoint, today).status, 'unknown_line');
});

test('assets match a product by vendor; a product naming a model wins', () => {
  const fortiManager = { id: 3, source: 'fortinet', asset_vendor: 'Fortinet', asset_model: 'FortiManager', releases: [] };
  assert.equal(productFor({ vendor: 'Fortinet', model: 'FortiGate 100F' }, [fortios, fortiManager]).id, 1);
  assert.equal(productFor({ vendor: 'Fortinet Inc.', model: 'FortiManager VM' }, [fortios, fortiManager]).id, 3);
  assert.equal(productFor({ vendor: 'Cisco', model: 'ASA' }, [fortios, checkpoint]), null);
  assert.equal(productFor({ vendor: '', model: 'x' }, [fortios]), null);
});
