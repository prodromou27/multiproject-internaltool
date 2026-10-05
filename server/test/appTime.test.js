const test = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('dgram');
const appTime = require('../appTime');
const ntp = require('../ntpCheck');

test('"today" and 08:00 follow the organisation\'s time zone, across daylight saving', () => {
  // 23:30 UTC on 4 October is already 5 October in Cyprus (UTC+3).
  const lateUtc = new Date('2026-10-04T23:30:00Z');
  assert.equal(appTime.timeZone(), 'Asia/Nicosia');
  assert.equal(appTime.today(lateUtc), '2026-10-05');
  assert.equal(appTime.thisMonth(new Date('2026-09-30T22:30:00Z')), '2026-10');
  // 08:00 in Cyprus is 05:00 UTC in summer and 06:00 UTC after 25 October.
  assert.equal(appTime.nextLocalTime(8, 0, new Date('2026-10-20T04:00:00Z')).toISOString(), '2026-10-20T05:00:00.000Z');
  assert.equal(appTime.nextLocalTime(8, 0, new Date('2026-10-20T06:00:00Z')).toISOString(), '2026-10-21T05:00:00.000Z');
  assert.equal(appTime.nextLocalTime(8, 0, new Date('2026-10-26T01:00:00Z')).toISOString(), '2026-10-26T06:00:00.000Z');
  assert.equal(appTime.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(appTime.validTimeZone('Europe/Athens'), true);
  assert.equal(appTime.validTimeZone('Mars/Olympus'), false);
});

// A tiny NTP server that answers with a clock `skewMs` ahead of ours.
function fakeNtpServer(skewMs) {
  return new Promise(resolve => {
    const server = dgram.createSocket('udp4');
    server.on('message', (message, remote) => {
      const reply = Buffer.alloc(48);
      reply[0] = 0x24; // version 4, server mode
      const write = (offset, ms) => {
        const seconds = Math.floor(ms / 1000) + 2208988800;
        reply.writeUInt32BE(seconds >>> 0, offset);
        reply.writeUInt32BE(Math.floor(((ms % 1000) / 1000) * 2 ** 32) >>> 0, offset + 4);
      };
      const now = Date.now() + skewMs;
      write(32, now); write(40, now);
      server.send(reply, remote.port, remote.address);
    });
    server.bind(0, '127.0.0.1', () => resolve(server));
  });
}

test('the NTP check measures how far the server clock is from the NTP server', async () => {
  const server = await fakeNtpServer(8000);
  try {
    const result = await ntp.queryNtp('127.0.0.1', { port: server.address().port });
    assert.ok(Math.abs(result.offset_ms - 8000) < 500, `offset ${result.offset_ms} ms`);
    assert.ok(result.delay_ms >= 0);
  } finally { server.close(); }
  await assert.rejects(ntp.queryNtp('127.0.0.1', { port: 9, timeoutMs: 300 }), /No answer|ECONNREFUSED/);
  await assert.rejects(ntp.queryNtp('bad host!'), /valid NTP server/);
  assert.equal(ntp.validServer('time.windows.com'), true);
  assert.equal(ntp.validServer('10.0.0.1'), true);
  assert.equal(ntp.validServer('http://evil'), false);
});
