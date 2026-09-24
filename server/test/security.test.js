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
