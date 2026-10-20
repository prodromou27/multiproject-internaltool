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
// Webex's service catalogue: where this bot's device service (WDM) is, when wdm-a is not it
// (e.g. an organisation in the EU). Asked with the bot token, it answers for the bot's own
// organisation; the limited catalogue (the default regions) is the last resort.
const CATALOG_URL = 'https://u2c.wbx2.com/u2c/api/v1/catalog?format=hostmap';
const LIMITED_CATALOG_URL = 'https://u2c.wbx2.com/u2c/api/v1/limited/catalog?format=hostmap';
const webexHost = url => { try { const u = new URL(url); return u.protocol === 'https:' && /(^|\.)(wbx2|webex|ciscospark)\.com$/i.test(u.hostname); } catch { return false; } };
// A device registration answer is large (it lists Webex's services): read up to 8 MB.
const DEVICE_MAX_BYTES = 8_000_000;
/** What an answer held, for the error shown in Settings: field names, status, type and size, never values. */
function shapeOf(answer) {
  const data = answer?.data;
  if (data && typeof data === 'object') return `fields: ${Object.keys(data).slice(0, 12).join(', ') || 'none'}`;
  const how = [`HTTP ${answer?.status ?? '?'}`, answer?.contentType || 'no content type', `${answer?.size ?? 0} bytes`, ...(answer?.truncated ? ['cut off'] : [])].join(', ');
  return `${answer?.size ? 'an answer that is not JSON' : 'an empty answer'} (${how})`;
}
const DEVICE = { deviceName: 'TeamHub activity bot', deviceType: 'DESKTOP', localizedModel: 'nodeJS', model: 'nodeJS', name: 'teamhub-activity-bot', systemName: 'TeamHub', systemVersion: '1.0' };
const PING_MS = 30 * 1000, SILENT_MS = 100 * 1000, MAX_PAUSE_MS = 5 * 60 * 1000;

let socket = null, timers = [], pause = 5000, wanted = false;
let state = { status: 'off', since: null, error: null };
// The last message received over the connection and what became of it (shown in Settings).
let lastMessage = null;
const noteMessage = (outcome, error = null) => { lastMessage = { at: new Date().toISOString(), outcome, error }; };
const setState = (status, error = null) => { state = { status, since: new Date().toISOString(), error }; };
const clearTimers = () => { for (const t of timers) { clearTimeout(t); clearInterval(t); } timers = []; };

/** Webex REST ids are base64 of a "ciscospark://<cluster>/MESSAGE/<uuid>" URI (US: "us"; EU: "urn:TEAM:eu-central-1_k"). */
const messageIdFor = (uuid, cluster = 'us') => Buffer.from(`ciscospark://${cluster}/MESSAGE/${uuid}`).toString('base64').replace(/=+$/, '');
const CLUSTERS = ['us', 'urn:TEAM:eu-central-1_k'];

/** The message's REST id, from the bot's own (regional) conversation service named in the event. */
async function restMessageId(activity) {
  const target = activity?.target;
  if (!target?.url || !target?.id || !webexHost(target.url)) return null;
  const url = target.url.replace(`conversations/${target.id}`, `messages/${activity.id}`);
  if (url === target.url) return null;
  const token = await require('./channels').webexToken();
  if (!token) return null;
  const message = await http.request('GET', url, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
  return typeof message?.id === 'string' && message.id ? message.id : null;
}

/** The device service Webex's catalogue names for this bot (asked only when wdm-a fails); notes what happened. */
async function catalogDeviceService(headers, answers) {
  for (const [url, name] of [[CATALOG_URL, 'the catalogue'], [LIMITED_CATALOG_URL, 'the limited catalogue']]) {
    try {
      const answer = await http.request('GET', url, { headers, raw: true, maxBytes: DEVICE_MAX_BYTES });
      const wdm = answer.data?.serviceLinks?.wdm;
      if (wdm && webexHost(wdm)) {
        const service = `${wdm.replace(/\/+$/, '')}/devices`;
        if (service !== DEVICES_URL) return service;
        continue;   // the same wdm-a: try the other catalogue
      }
      answers.push(`${name} gave ${wdm ? 'a device service outside Webex' : shapeOf(answer)}`);
    } catch (error) { answers.push(`${name}: ${error.message}`); }
  }
  return null;
}

/** A registered device's WebSocket address (asking for the device again when the answer lacks it). */
async function socketOf(device, headers) {
  if (device?.webSocketUrl) return device.webSocketUrl;
  if (device?.url && webexHost(device.url)) {
    const again = await http.request('GET', device.url, { headers, maxBytes: DEVICE_MAX_BYTES }).catch(() => null);
    if (again?.webSocketUrl) return again.webSocketUrl;
  }
  return null;
}

/** A device's WebSocket address: the saved device when Webex still knows it, else a new one. */
async function deviceSocketUrl(token) {
  const headers = { Authorization: `Bearer ${token}` };
  const saved = (await botSettings.load()).webex.device_url;
  if (saved && webexHost(saved)) {
    try { const device = await http.request('GET', saved, { headers, maxBytes: DEVICE_MAX_BYTES }); if (device?.webSocketUrl) return device.webSocketUrl; }
    catch (error) { if (error.status !== 404) throw error; }
  }
  // wdm-a first; when it gives no address, the device service the catalogue names.
  const answers = [];
  const register = async service => {
    let answer;
    try { answer = await http.request('POST', service, { headers, json: DEVICE, raw: true, maxBytes: DEVICE_MAX_BYTES }); }
    catch (error) { answers.push(`${new URL(service).hostname}: ${error.message}`); return null; }
    const device = answer.data;
    const socket = await socketOf(device, headers);
    if (socket && webexHost(socket.replace(/^wss:/, 'https:'))) {
      await botSettings.save({ webex: { device_url: device.url || null } });
      return socket;
    }
    answers.push(`${new URL(service).hostname} gave ${shapeOf(answer)}`);
    return null;
  };
  const first = await register(DEVICES_URL);
  if (first) return first;
  const other = await catalogDeviceService(headers, answers);
  const second = other && other !== DEVICES_URL ? await register(other) : null;
  if (second) return second;
  throw new Error(`Webex did not return a connection address (${answers.join('; ')})`);
}

/** A new message from the socket → the webhook's handler. Its REST id comes from the
    conversation service named in the event; failing that, the US then the EU form is tried. */
async function onActivity(activity, handle) {
  if (activity?.verb !== 'post' || !activity.id) return 'ignored';
  const email = activity.actor?.emailAddress || '';
  if (/@webex\.bot$/i.test(email)) return 'ignored';   // the bot's own replies
  const resolved = await restMessageId(activity);
  const ids = [...new Set([resolved, ...CLUSTERS.map(cluster => messageIdFor(activity.id, cluster))].filter(Boolean))];
  for (const [index, id] of ids.entries()) {
    try { return await handle({ resource: 'messages', event: 'created', data: { id, personEmail: email } }); }
    catch (error) {
      // Not this form of the id (Webex answers 400, 403 or 404): try the next one.
      if (index === ids.length - 1 || ![400, 403, 404].includes(error.status)) throw error;
    }
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
    if (message?.data?.eventType === 'conversation.activity' && message.data.activity?.verb === 'post')
      onActivity(message.data.activity, handle || channels.handleWebexEvent)
        .then(outcome => { if (outcome !== 'ignored') noteMessage(outcome); })
        .catch(error => { noteMessage('failed', error.message); console.error('[activity-bot] webex message:', error.message); });
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
  lastMessage = null;
  if (!wanted) { clearTimers(); try { socket?.close(); } catch { /* closed */ } socket = null; setState('off'); return state; }
  pause = 5000;
  try { socket?.close(); } catch { /* closed */ }
  socket = null;
  return connect(options);
}

const status = () => ({ ...state, last_message: lastMessage });
function stop() { wanted = false; lastMessage = null; clearTimers(); try { socket?.close(); } catch { /* closed */ } socket = null; setState('off'); }

module.exports = { sync, status, stop, messageIdFor, onActivity, DEVICES_URL, CATALOG_URL, LIMITED_CATALOG_URL };
