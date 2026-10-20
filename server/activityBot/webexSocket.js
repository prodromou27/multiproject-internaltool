/**
 * The Webex bot without a webhook: the app connects OUT to Webex over a WebSocket (as
 * the Webex apps do) and receives the bot's messages there, so nothing on this server
 * has to be reachable from the internet and no public certificate is needed. Only
 * outbound HTTPS to Webex (*.webex.com, *.wbx2.com) is used.
 *
 * The app registers itself as a Webex "device" (kept in the bot settings and reused),
 * opens the device's WebSocket, authorises it with the bot token, and for each new
 * message event hands the message to the same handler the webhook uses
 * (channels.handleWebexEvent), which reads it through the REST API and replies.
 * The connection is watched: it is re-opened after a drop, with a growing pause.
 */
const crypto = require('crypto');
const http = require('./http');
const botSettings = require('./settings');

const DEVICES_URL = 'https://wdm-a.wbx2.com/wdm/api/v1/devices';
const DEVICE = { deviceName: 'TeamHub activity bot', deviceType: 'DESKTOP', localizedModel: 'nodeJS', model: 'nodeJS', name: 'teamhub-activity-bot', systemName: 'TeamHub', systemVersion: '1.0' };
const PING_MS = 30 * 1000, SILENT_MS = 100 * 1000, MAX_PAUSE_MS = 5 * 60 * 1000;

let socket = null, timers = [], pause = 5000, wanted = false;
let state = { status: 'off', since: null, error: null };
const setState = (status, error = null) => { state = { status, since: new Date().toISOString(), error }; };
const clearTimers = () => { for (const t of timers) { clearTimeout(t); clearInterval(t); } timers = []; };

/** Webex REST ids are base64 of a "ciscospark://<cluster>/MESSAGE/<uuid>" URI. */
const messageIdFor = (uuid, cluster = 'us') => Buffer.from(`ciscospark://${cluster}/MESSAGE/${uuid}`).toString('base64').replace(/=+$/, '');

/** A device's WebSocket address: the saved device when Webex still knows it, else a new one. */
async function deviceSocketUrl(token) {
  const headers = { Authorization: `Bearer ${token}` };
  const saved = (await botSettings.load()).webex.device_url;
  if (saved && /^https:\/\/[a-z0-9.-]+\.wbx2\.com\//i.test(saved)) {
    try { const device = await http.request('GET', saved, { headers }); if (device?.webSocketUrl) return device.webSocketUrl; }
    catch (error) { if (error.status !== 404) throw error; }
  }
  const device = await http.request('POST', DEVICES_URL, { headers, json: DEVICE });
  if (!device?.webSocketUrl || !device?.url) throw new Error('Webex did not return a connection address');
  await botSettings.save({ webex: { device_url: device.url } });
  return device.webSocketUrl;
}

/** A new message from the socket → the webhook's handler (tries the US, then the EU, cluster id). */
async function onActivity(activity, handle) {
  if (activity?.verb !== 'post' || !activity.id) return 'ignored';
  const email = activity.actor?.emailAddress || '';
  if (/@webex\.bot$/i.test(email)) return 'ignored';   // the bot's own replies
  for (const cluster of ['us', 'eu']) {
    try { return await handle({ resource: 'messages', event: 'created', data: { id: messageIdFor(activity.id, cluster), personEmail: email } }); }
    catch (error) { if (error.status !== 404 || cluster === 'eu') throw error; }
  }
  return 'ignored';
}

function scheduleReconnect(reason) {
  clearTimers();
  try { socket?.close(); } catch { /* already closed */ }
  socket = null;
  if (!wanted) return;
  setState('reconnecting', reason);
  const t = setTimeout(() => { connect().catch(() => {}); }, pause); t.unref?.(); timers.push(t);
  pause = Math.min(pause * 2, MAX_PAUSE_MS);
}

async function connect({ WebSocketImpl = globalThis.WebSocket, handle } = {}) {
  clearTimers();
  const channels = require('./channels');
  const token = await channels.webexToken();
  const settings = await botSettings.load();
  if (!wanted || !token || !settings.webex.enabled) { setState('off'); return state; }
  setState('connecting');
  let url;
  try { url = await deviceSocketUrl(token); }
  catch (error) { scheduleReconnect(`Could not register with Webex: ${error.message}`); return state; }
  const ws = new WebSocketImpl(url);
  socket = ws;
  let lastHeard = Date.now();
  ws.onopen = () => {
    ws.send(JSON.stringify({ id: crypto.randomUUID(), type: 'authorization', data: { token: `Bearer ${token}` } }));
    pause = 5000; setState('connected');
    const ping = setInterval(() => {
      if (Date.now() - lastHeard > SILENT_MS) return scheduleReconnect('Webex stopped answering');
      try { ws.send(JSON.stringify({ id: crypto.randomUUID(), type: 'ping' })); } catch { scheduleReconnect('The connection to Webex dropped'); }
    }, PING_MS); ping.unref?.(); timers.push(ping);
  };
  ws.onmessage = event => {
    lastHeard = Date.now();
    let message; try { message = JSON.parse(typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8')); } catch { return; }
    if (message?.data?.eventType === 'conversation.activity')
      onActivity(message.data.activity, handle || channels.handleWebexEvent).catch(error => console.error('[activity-bot] webex message:', error.message));
  };
  ws.onerror = () => {};
  ws.onclose = () => { if (socket === ws) scheduleReconnect('The connection to Webex closed'); };
  return state;
}

/** (Re)start or stop the connection to match the settings; called at start and after changes. */
async function sync(options = {}) {
  const settings = await botSettings.load();
  const token = await require('./channels').webexToken();
  wanted = !!(settings.webex.enabled && token);
  if (!wanted) { clearTimers(); try { socket?.close(); } catch { /* closed */ } socket = null; setState('off'); return state; }
  pause = 5000;
  try { socket?.close(); } catch { /* closed */ }
  socket = null;
  return connect(options);
}

const status = () => ({ ...state });
function stop() { wanted = false; clearTimers(); try { socket?.close(); } catch { /* closed */ } socket = null; setState('off'); }

module.exports = { sync, status, stop, messageIdFor, onActivity, DEVICES_URL };
