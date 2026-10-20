// The Webex bot connects out over a WebSocket (no webhook, nothing reachable from the internet).
const { test, assert, db } = require('./lib/activityFixture');
const http = require('../activityBot/http');
const socket = require('../activityBot/webexSocket');
const botSettings = require('../activityBot/settings');

const settle = () => new Promise(resolve => setImmediate(resolve));
class FakeSocket {
  static last = null;
  constructor(url) { this.url = url; this.sent = []; this.closed = false; FakeSocket.last = this; }
  send(text) { this.sent.push(JSON.parse(text)); }
  close() { if (!this.closed) { this.closed = true; this.onclose?.(); } }
}
const activity = (extra = {}) => ({ data: { eventType: 'conversation.activity', activity: { verb: 'post', id: '92db3be0-43bd-11e6-8ae9-dd5b3dfc565d', actor: { emailAddress: 'maria@company.example' }, ...extra } } });

test('a Webex REST message id is built from the event\'s uuid, as Webex documents it', () => {
  assert.equal(socket.messageIdFor('92db3be0-43bd-11e6-8ae9-dd5b3dfc565d'), 'Y2lzY29zcGFyazovL3VzL01FU1NBR0UvOTJkYjNiZTAtNDNiZC0xMWU2LThhZTktZGQ1YjNkZmM1NjVk');
});

test('new messages reach the bot; its own and other events do not; the EU cluster is tried when the US one does not know the message', async () => {
  const seen = [];
  const handle = async event => { seen.push(event.data); if (event.data.id.startsWith(Buffer.from('ciscospark://us').toString('base64').slice(0, 16)) && seen.length === 3) throw Object.assign(new Error('not found'), { status: 404 }); return 'answered'; };
  assert.equal(await socket.onActivity(activity().data.activity, handle), 'answered');
  assert.deepEqual(seen[0], { id: socket.messageIdFor('92db3be0-43bd-11e6-8ae9-dd5b3dfc565d'), personEmail: 'maria@company.example' });
  assert.equal(await socket.onActivity({ ...activity().data.activity, actor: { emailAddress: 'teamhub@webex.bot' } }, handle), 'ignored', 'the bot\'s own reply');
  assert.equal(await socket.onActivity({ ...activity().data.activity, verb: 'acknowledge' }, handle), 'ignored', 'a read receipt');
  seen.length = 2;
  assert.equal(await socket.onActivity(activity().data.activity, handle), 'answered');
  assert.equal(seen[3].id, socket.messageIdFor('92db3be0-43bd-11e6-8ae9-dd5b3dfc565d', 'eu'));
});

test('with the bot on and a token, the app registers a device once, connects out, authorises and passes messages on; it reconnects after a drop and stops when turned off', async () => {
  await db.prepare("INSERT INTO settings (key, value) VALUES ('integrations', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").run(JSON.stringify({ webex: { bot_token: 'bot-token-123' } }));
  await botSettings.save({ webex: { enabled: true } });
  const calls = [];
  http._setTransport(async ({ method, url, headers }) => {
    calls.push([method, url, headers.Authorization]);
    if (method === 'POST' && url === socket.DEVICES_URL) return { status: 200, text: JSON.stringify({ url: 'https://wdm-a.wbx2.com/wdm/api/v1/devices/dev-1', webSocketUrl: 'wss://mercury.wbx2.com/v1/apps/wx2/registrations/dev-1/messages' }) };
    if (method === 'GET' && url.endsWith('/devices/dev-1')) return { status: 200, text: JSON.stringify({ url: 'https://wdm-a.wbx2.com/wdm/api/v1/devices/dev-1', webSocketUrl: 'wss://mercury.wbx2.com/v1/apps/wx2/registrations/dev-1/messages' }) };
    return { status: 404, text: '{}' };
  });
  const handled = [];
  try {
    await socket.sync({ WebSocketImpl: FakeSocket, handle: async event => { handled.push(event.data.id); return 'answered'; } });
    const ws = FakeSocket.last;
    assert.equal(ws.url, 'wss://mercury.wbx2.com/v1/apps/wx2/registrations/dev-1/messages');
    assert.deepEqual(calls[0], ['POST', socket.DEVICES_URL, 'Bearer bot-token-123'], 'registered once with the bot token');
    assert.equal((await botSettings.load()).webex.device_url, 'https://wdm-a.wbx2.com/wdm/api/v1/devices/dev-1', 'the device is kept for next time');
    ws.onopen();
    assert.deepEqual([ws.sent[0].type, ws.sent[0].data.token], ['authorization', 'Bearer bot-token-123']);
    assert.equal(socket.status().status, 'connected');
    assert.equal((await botSettings.view()).webex.connection.status, 'connected', 'shown in Settings');

    ws.onmessage({ data: JSON.stringify(activity()) });
    ws.onmessage({ data: JSON.stringify({ data: { eventType: 'conversation.activity', activity: { verb: 'post', id: 'x', actor: { emailAddress: 'teamhub@webex.bot' } } } }) });
    ws.onmessage({ data: 'not json' });
    await settle(); await settle();
    assert.deepEqual(handled, [socket.messageIdFor('92db3be0-43bd-11e6-8ae9-dd5b3dfc565d')]);

    // A drop: reconnecting, and the next connection reuses the saved device (no new registration).
    ws.close();
    assert.equal(socket.status().status, 'reconnecting');
    calls.length = 0;
    await socket.sync({ WebSocketImpl: FakeSocket });
    assert.deepEqual(calls.map(c => c[0]), ['GET'], 'the saved device, not a new one');

    // Turned off: disconnected.
    await botSettings.save({ webex: { enabled: false } });
    await socket.sync({ WebSocketImpl: FakeSocket });
    assert.equal(socket.status().status, 'off');
    assert.equal(FakeSocket.last.closed, true);
  } finally { socket.stop(); http._setTransport(null); }
});

test('when wdm-a gives no connection address, the device service from Webex\'s catalogue is used; when none does, the error says what came back', async () => {
  await db.prepare("INSERT INTO settings (key, value) VALUES ('integrations', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").run(JSON.stringify({ webex: { bot_token: 'bot-token-123' } }));
  await botSettings.save({ webex: { enabled: true, device_url: null } });
  const device = { url: 'https://wdm-k.wbx2.com/wdm/api/v1/devices/dev-9', webSocketUrl: 'wss://mercury-k.wbx2.com/v1/apps/wx2/registrations/dev-9/messages' };
  let catalogWdm = 'https://wdm-k.wbx2.com/wdm/api/v1';
  http._setTransport(async ({ method, url }) => {
    if (method === 'POST' && url === socket.DEVICES_URL) return { status: 200, text: JSON.stringify({ id: 'x', deviceSettings: {} }) };
    if (method === 'GET' && url === socket.CATALOG_URL) return { status: 200, text: JSON.stringify({ serviceLinks: { wdm: catalogWdm } }) };
    if (method === 'POST' && url === 'https://wdm-k.wbx2.com/wdm/api/v1/devices') return { status: 200, text: JSON.stringify(device) };
    return { status: 404, text: '{}' };
  });
  try {
    await socket.sync({ WebSocketImpl: FakeSocket });
    assert.equal(FakeSocket.last.url, device.webSocketUrl, 'connected through the catalogue\'s device service');
    assert.equal((await botSettings.load()).webex.device_url, device.url);

    // Neither gives an address: the error names the fields Webex sent (no values).
    socket.stop();
    await botSettings.save({ webex: { enabled: true, device_url: null } });
    catalogWdm = 'https://evil.example.com/wdm';   // not a Webex host: not used
    await socket.sync({ WebSocketImpl: FakeSocket });
    const shown = socket.status();
    assert.equal(shown.status, 'reconnecting');
    assert.match(shown.error, /Webex did not return a connection address \(wdm-a\.wbx2\.com gave fields: id, deviceSettings\)/);
  } finally { socket.stop(); http._setTransport(null); }
});
