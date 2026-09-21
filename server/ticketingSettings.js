const db = require('./db');
const { encrypt,decrypt } = require('./fieldCipher');

const KEY='ticketing_rt';
const DEFAULTS={ enabled:false,base_url:'',sync_interval_minutes:60 };
const object=value => value && typeof value==='object' && !Array.isArray(value);
const fail=message => { throw Object.assign(new Error(message),{ status:400 }); };

async function storedSettings(store=db) {
  const row=await store.prepare('SELECT value FROM settings WHERE key=?').get(KEY);
  try { return { ...DEFAULTS,...JSON.parse(row?.value || '{}') }; } catch { return { ...DEFAULTS }; }
}

function publicSettings(stored={}) {
  return { enabled:!!stored.enabled,base_url:stored.base_url || '',sync_interval_minutes:Number(stored.sync_interval_minutes || 60),api_token:'',api_token_set:!!stored.api_token };
}

function runtimeSettings(stored={}) {
  return { ...publicSettings(stored),api_token:decrypt(stored.api_token) || '' };
}

function mergeSettings(current,input) {
  if (!object(input) || Object.keys(input).some(key => !['enabled','base_url','sync_interval_minutes','api_token','clear_api_token'].includes(key))) fail('Invalid Request Tracker settings');
  const next={ ...DEFAULTS,...current };
  if (input.enabled!==undefined) { if (typeof input.enabled!=='boolean') fail('Enabled must be true or false');next.enabled=input.enabled; }
  if (input.base_url!==undefined) { if (typeof input.base_url!=='string' || input.base_url.trim().length>1000) fail('RT base URL must be text of at most 1000 characters');next.base_url=input.base_url.trim().replace(/\/+$/,''); }
  if (input.sync_interval_minutes!==undefined) { const interval=Number(input.sync_interval_minutes);if (!Number.isInteger(interval) || interval<15 || interval>1440) fail('Sync interval must be between 15 and 1440 minutes');next.sync_interval_minutes=interval; }
  if (input.api_token!==undefined && (typeof input.api_token!=='string' || input.api_token.length>4096)) fail('RT API token must be text of at most 4096 characters');
  if (input.clear_api_token!==undefined && typeof input.clear_api_token!=='boolean') fail('Invalid token clearing option');
  if (input.clear_api_token) next.api_token=null;
  else if (input.api_token) next.api_token=encrypt(input.api_token);
  if (next.enabled && (!next.base_url || !next.api_token)) fail('An RT base URL and API token are required when the integration is enabled');
  return next;
}

async function saveSettings(value,store=db) {
  await store.prepare("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value").run(KEY,JSON.stringify(value));
}

module.exports={ DEFAULTS,storedSettings,publicSettings,runtimeSettings,mergeSettings,saveSettings };
