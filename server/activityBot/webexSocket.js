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
// Webex's service catalogue: where this account's device service (WDM) is, when wdm-a is not it.
const CATALOG_URL = 'https://u2c.wbx2.com/u2c/api/v1/limited/catalog?format=hostmap';
const webexHost = url => { try { const u = new URL(url); return u.protocol === 'https:' && /(^|\.)(wbx2|webex|ciscospark)\.com$/i.test(u.hostname); } catch { return false; } };
/** What an answer held, for the error shown in Settings: field names only, never values. */
const shapeOf = data => data == null ? 'an empty or non-JSON answer' : typeof data !== 'object' ? `a ${typeof data}` : `fields: ${Object.keys(data).slice(0, 12).join(', ') || 'none'}`;
const DEVICE = { deviceName: 'TeamHub activity bot', deviceType: 'DESKTOP', localizedModel: 'nodeJS', model: 'nodeJS', name: 'teamhub-activity-bot', systemName: 'TeamHub', systemVersion: '1.0' };
const PING_MS = 30 * 1000, SILENT_MS = 100 * 1000, MAX_PAUSE_MS = 5 * 60 * 1000;

let socket = null, timers = [], pause = 5000, wanted = false;
let state = { status: 'off', since: null, error: null };
const setState = (status, error = null) => { state = { status, since: new Date().toISOString(), error }; };
const clearTimers = () => { for (const t of timers) { clearTimeout(t); clearInterval(t); } timers = []; };

/** Webex REST ids are base64 of a "ciscospark://<cluster>/MESSAGE/<uuid>" URI. */
const messageIdFor = (uuid, cluster = 'us') => Buffer.from(`ciscospark://${cluster}/MESSAGE/${uuid}`).toString('base64').replace(/=+$/, '');

/** The device service Webex's catalogue names for this account (asked only when wdm-a fails). */
async function catalogDeviceService(headers) {
  try {
    const wdm = (await http.request('GET', CATALOG_URL, { headers }))?.serviceLinks?.wdm;
    return wdm && webexHost(wdm) ? `${wdm.replace(/\/+$/, '')}/devices` : null;
  } catch { return null; }
}

/** A registered device's WebSocket address (asking for the device again when the answer lacks it). */
async function socketOf(device, headers) {
  if (device?.webSocketUrl) return device.webSocketUrl;
  if (device?.url && webexHost(device.url)) {
    const again = await http.request('GET', device.url, { headers }).catch(() => null);
    if (again?.webSocketUrl) return again.webSocketUrl;
  }
  return null;
}

/** A device's WebSocket address: the saved device when Webex still knows it, else a new one. */
async function deviceSocketUrl(token) {
  const headers = { Authorization: `Bearer ${token}` };
  const saved = (await botSettings.load()).webex.device_url;
  if (saved && webexHost(saved)) {
    try { const device = await http.request('GET', saved, { headers }); if (device?.webSocketUrl) return device.webSocketUrl; }
    catch (error) { if (error.status !== 404) throw error; }
  }
  // wdm-a first; when it gives no address, the device service the catalogue names.
  const answers = [];
  const register = async service => {
    let device;
    try { device = await http.request('POST', service, { headers, json: DEVICE }); }
    catch (error) { answers.push(`${new URL(service).hostname}: ${error.message}`); return null; }
    const socket = await socketOf(device, headers);
    if (socket && webexHost(socket.replace(/^wss:/, 'https:'))) {
      await botSettings.save({ webex: { device_url: device.url || null } });
      return socket;
    }
    answers.push(`${new URL(service).hostname} gave ${shapeOf(device)}`);
    return null;
  };
  const first = await register(DEVICES_URL);
  if (first) return first;
  const other = await catalogDeviceService(headers);
  const second = other && other !== DEVICES_URL ? await register(other) : null;
  if (second) return second;
  throw new Error(`Webex did not return a connection address (${answers.join('; ')})`);
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

module.exports = { sync, status, stop, messageIdFor, onActivity, DEVICES_URL, CATALOG_URL };
