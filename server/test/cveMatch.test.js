const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../cve/match');

test('versions compare the way vendors number them', () => {
  const cases = [
    ['7.2.10', '7.2.9', 1], ['7.2.0', '7.2', 0], ['7.2.0-beta', '7.2.0', -1], ['7.2.0-rc1', '7.2.0', -1], ['15.2(4)M7', '15.2(4)M10', -1],
    ['v7.4.3', '7.4.3', 0], ['17.9.4a', '17.9.4', 1], ['10.1.6-h3', '10.1.6', 1], ['10.1.6-h3', '10.1.6-h10', -1], ['6.4.15', '7.0.0', -1], ['2.0', '2.0.0.0', 0],
  ];
  for (const [a, b, want] of cases) assert.equal(m.compareVersions(a, b), want, `${a} vs ${b}`);
});

test('CPE names are read, including escaped characters', () => {
  assert.deepEqual(m.parseCpe('cpe:2.3:o:fortinet:fortios:7.2.5:*:*:*:*:*:*:*'), { vendor: 'fortinet', product: 'fortios', version: '7.2.5' });
  assert.deepEqual(m.parseCpe(String.raw`cpe:2.3:a:microsoft:.net\:framework:4.8:*:*:*:*:*:*:*`), { vendor: 'microsoft', product: '.net:framework', version: '4.8' });
  assert.equal(m.parseCpe('not a cpe'), null);
});

test('a version is checked against NVD ranges and exact versions', () => {
  const entries = m.vulnerableEntries([{ nodes: [{ cpeMatch: [
    { vulnerable: true, criteria: 'cpe:2.3:o:fortinet:fortios:*:*:*:*:*:*:*:*', versionStartIncluding: '7.2.0', versionEndExcluding: '7.2.8' },
    { vulnerable: true, criteria: 'cpe:2.3:o:fortinet:fortios:7.4.1:*:*:*:*:*:*:*' },
    { vulnerable: false, criteria: 'cpe:2.3:h:fortinet:fortigate-60f:-:*:*:*:*:*:*:*' },
  ] }] }]);
  assert.equal(entries.length, 2, 'platform entries (not vulnerable) are ignored');
  assert.equal(m.affects(entries, 'fortinet', 'fortios', '7.2.5'), 'yes');
  assert.equal(m.affects(entries, 'fortinet', 'fortios', '7.2.8'), 'no', 'the fixed version');
  assert.equal(m.affects(entries, 'fortinet', 'fortios', '7.4.1'), 'yes');
  assert.equal(m.affects(entries, 'fortinet', 'fortios', '7.0.15'), 'no');
  assert.equal(m.affects(entries, 'fortinet', 'fortiproxy', '7.2.5'), null, 'another product');
  assert.equal(m.affects(m.vulnerableEntries([{ nodes: [{ cpeMatch: [{ vulnerable: true, criteria: 'cpe:2.3:a:veeam:backup:*:*:*:*:*:*:*:*' }] }] }]), 'veeam', 'backup', '12.1'), 'unknown', 'no versions named: check it');
  assert.equal(m.affects(entries, 'fortinet', 'fortios', ''), 'unknown', 'an asset without a recorded version');
});

test('CVSS comes from the newest version NVD has, and asset vendors map to NVD names', () => {
  assert.deepEqual(m.cvssOf({ cvssMetricV31: [{ type: 'Primary', cvssData: { baseScore: 9.8, baseSeverity: 'CRITICAL', vectorString: 'CVSS:3.1/AV:N', version: '3.1' } }] }), { score: 9.8, severity: 'critical', vector: 'CVSS:3.1/AV:N', version: '3.1' });
  assert.equal(m.cvssOf({ cvssMetricV2: [{ baseSeverity: 'HIGH', cvssData: { baseScore: 7.5 } }] }).severity, 'high');
  assert.equal(m.cvssOf({}).score, null);
  assert.equal(m.cpeVendorFor('Palo Alto Networks'), 'paloaltonetworks');
  assert.equal(m.cpeVendorFor(' Fortinet '), 'fortinet');
  assert.equal(m.cpeVendorFor('Some Vendor'), 'some_vendor');
});
