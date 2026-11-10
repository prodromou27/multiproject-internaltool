const test = require('node:test');
const assert = require('node:assert/strict');
const { assertPublicHttpUrl, isPrivateIp } = require('../security');

test('identifies private and loopback addresses', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fe80::1']) {
    assert.equal(isPrivateIp(ip), true, `${ip} should be private`);
  }

  assert.equal(isPrivateIp('8.8.8.8'), false);
  assert.equal(isPrivateIp('2606:4700:4700::1111'), false);
});

test('IPv4-mapped IPv6 literals are checked against the same private ranges as IPv4', () => {
  for (const ip of ['::ffff:172.16.0.5', '::ffff:100.64.0.1', '::ffff:127.0.0.1', '::ffff:198.18.0.1']) {
    assert.equal(isPrivateIp(ip), true, `${ip} should be private`);
  }
  assert.equal(isPrivateIp('::ffff:8.8.8.8'), false);
});

test('every spelling of an internal IPv6 address is private, including embedded IPv4 targets', () => {
  for (const ip of [
    '::ffff:7f00:1', '0:0:0:0:0:ffff:7f00:1', '0000:0000:0000:0000:0000:0000:0000:0001', '::', '::127.0.0.1',
    'fe80::1%eth0', 'febf::1', 'fec0::1', 'fd12:3456::1', 'ff02::1',
    '64:ff9b::7f00:1', '64:ff9b::10.0.0.1', '64:ff9b:1::1', '2002:7f00:1::1', '2002:a9fe:a9fe::', '2001:0:4136:e378::1', '2001:db8::1',
  ]) assert.equal(isPrivateIp(ip), true, `${ip} should be private`);
  for (const ip of ['::ffff:808:808', '64:ff9b::808:808', '2002:808:808::1', '2a00:1450:4001::200e', 'fe00::1']) {
    assert.equal(isPrivateIp(ip), false, `${ip} should be public`);
  }
  assert.equal(isPrivateIp('not-an-ip'), true);
});

test('rejects non-https and credentialed outbound URLs', async () => {
  await assert.rejects(
    () => assertPublicHttpUrl('http://example.com/hook', { label: 'Webhook URL' }),
    /must use https/
  );

  await assert.rejects(
    () => assertPublicHttpUrl('https://user:pass@example.com/hook', { label: 'Webhook URL' }),
    /must not include credentials/
  );
});

test('rejects private literal outbound URLs without DNS lookup', async () => {
  await assert.rejects(
    () => assertPublicHttpUrl('https://127.0.0.1/hook', { label: 'Webhook URL' }),
    /private\/internal/
  );

  await assert.rejects(
    () => assertPublicHttpUrl('https://169.254.169.254/latest/meta-data', { label: 'Webhook URL' }),
    /private\/internal/
  );
});

test('private integration destinations require an explicit opt-in while localhost stays blocked',async () => {
  await assert.doesNotReject(() => assertPublicHttpUrl('https://10.0.0.20/rt',{ label:'RT base URL',allowPrivate:true }));
  await assert.rejects(() => assertPublicHttpUrl('https://localhost/rt',{ label:'RT base URL',allowPrivate:true }),/local\/internal/);
});

test('validated addresses are pinned so a later DNS answer cannot redirect the connection', async () => {
  const { assertPublicHttpUrl, pinnedLookup } = require('../security');
  const url = await assertPublicHttpUrl('https://8.8.8.8/hook');
  assert.deepEqual(url.validatedAddresses, ['8.8.8.8']);
  const lookup = pinnedLookup(url);
  const single = await new Promise(resolve => lookup('evil.example', {}, (err, address, family) => resolve({ address, family })));
  assert.deepEqual(single, { address: '8.8.8.8', family: 4 });
  const all = await new Promise(resolve => lookup('evil.example', { all: true }, (err, list) => resolve(list)));
  assert.deepEqual(all, [{ address: '8.8.8.8', family: 4 }]);
  assert.equal(pinnedLookup(new URL('https://example.com')), undefined);
});

test('an IPv6 literal in a URL is checked as an address, not looked up', async () => {
  for (const url of ['https://[::1]/x', 'https://[::ffff:7f00:1]/x', 'https://[fe80::1]/x']) {
    await assert.rejects(() => assertPublicHttpUrl(url), /private\/internal/, url);
  }
});
