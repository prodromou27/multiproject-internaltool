/**
 * Grafana device sync: the Check Point devices our Grafana (Prometheus) dashboards
 * show — hostname, model, Gaia version and Jumbo Hotfix — matched to customer
 * assets, so the app knows what each device really runs.
 *
 *  - Two instant queries run through Grafana's data-source API (/api/ds/query) with a
 *    read-only service-account token: the version metric (its `name` label is the
 *    version line, e.g. R81_20_jumbo_hf_main, and its value the hotfix build, e.g.
 *    996000077) and the model metric (`model` label). Both carry `host_name`.
 *  - A build becomes a take through a mapping list kept here, which can be imported
 *    from a Grafana dashboard's value mappings ("996000077" → "Take 170"); builds
 *    with no mapping are shown, never guessed.
 *  - Devices are matched to assets by hostname (then asset name), or by a link a
 *    manager made. Differences are listed for review; applying one updates the
 *    asset's version (and model) and records a device review, so Software versions,
 *    the dashboards and remediation campaigns see the real state. Automatic apply is
 *    off until a manager turns it on.
 * Grafana usually runs on the internal network, so its address may be private; the
 * connection is pinned to the address that was checked, as for Request Tracker.
 */
const db = require('./db');
const { encrypt, decrypt } = require('./fieldCipher');
const { assertPublicHttpUrl, pinnedFetch } = require('./security');

const KEY = 'grafana_sync';
const DEFAULTS = {
  base_url: '', datasource_uid: '',
  version_query: 'system_gaia_module_version{module="Firewall-1", service_namespace="vs_id_0"}',
  model_query: 'hardware_model',
  take_map: {}, version_map: {}, auto_apply: false,
  // The dashboard whose value mappings say which build is which take (read at each sync).
  dashboard_uid: '', dashboard_take_map: {}, dashboard_conflicts: {}, dashboard_read_at: null,
};

/** Build → take: the dashboard's mappings, with a manager's own entries taking precedence. */
const takesOf = s => ({ ...(s.dashboard_take_map || {}), ...(s.take_map || {}) });

async function settings(store = db) {
  const row = await store.prepare('SELECT value FROM settings WHERE key = ?').get(KEY);
  let saved = {};
  try { saved = JSON.parse(row?.value || '{}') || {}; } catch { saved = {}; }
  return { ...DEFAULTS, ...saved };
}
const saveSettings = (value, store = db) => store.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value').run(KEY, JSON.stringify(value));

/** The settings as shown to managers: never the token itself. */
const publicSettings = s => ({ base_url: s.base_url, datasource_uid: s.datasource_uid, version_query: s.version_query, model_query: s.model_query,
  take_map: s.take_map, version_map: s.version_map, auto_apply: !!s.auto_apply, token_set: !!s.token, last_sync_at: s.last_sync_at || null, last_result: s.last_result || null,
  dashboard_uid: s.dashboard_uid || '', dashboard_take_map: s.dashboard_take_map || {}, dashboard_conflicts: s.dashboard_conflicts || {}, dashboard_read_at: s.dashboard_read_at || null });

/* ── Reading the data ────────────────────────────────────────────── */
const checkedBase = (s, validateUrl) => validateUrl(s.base_url, { label: 'Grafana address', allowHttp: true, allowPrivate: process.env.ALLOW_PRIVATE_GRAFANA_URLS !== 'false' });

/**
 * The dashboard's build → take mappings, read through Grafana's API. Grafana keeps
 * these as display mappings ("996000077" shown as "Take 170"); the data API returns
 * the raw build, so the mappings are read from the dashboard itself. Newer Grafana
 * (dashboard schema v2) and the classic API are both tried.
 */
async function dashboardTakes(s, { fetchImpl = pinnedFetch, validateUrl = assertPublicHttpUrl } = {}) {
  const base = await checkedBase(s, validateUrl);
  const uid = encodeURIComponent(s.dashboard_uid);
  const paths = [`/api/dashboards/uid/${uid}`, `/apis/dashboard.grafana.app/v2/namespaces/default/dashboards/${uid}`, `/apis/dashboard.grafana.app/v2beta1/namespaces/default/dashboards/${uid}`];
  let last = 'not found';
  for (const path of paths) {
    const response = await fetchImpl(new URL(path, base).toString(), { method: 'GET', addresses: base.validatedAddresses,
      headers: { Authorization: `Bearer ${decrypt(s.token)}`, Accept: 'application/json' } });
    if (response.status === 401 || response.status === 403) throw new Error('Grafana refused the token for the dashboard (it needs Viewer rights on it)');
    if (!response.ok) { last = `HTTP ${response.status}`; continue; }
    const result = takeMapFromDashboard(await response.json());
    if (Object.keys(result.map).length || Object.keys(result.conflicts).length) return result;
    last = 'no "Take N" value mappings in it';
  }
  throw new Error(`The dashboard could not be read (${last})`);
}

async function query(s, { fetchImpl = pinnedFetch, validateUrl = assertPublicHttpUrl } = {}) {
  if (!s.base_url || !s.token || !s.datasource_uid) throw new Error('Grafana is not set up: enter its address, a token and the data source');
  const base = await checkedBase(s, validateUrl);
  const url = new URL('/api/ds/query', base);
  const body = JSON.stringify({ from: 'now-15m', to: 'now', queries: [
    { refId: 'A', datasource: { uid: s.datasource_uid, type: 'prometheus' }, expr: s.version_query, instant: true, range: false, format: 'table' },
    { refId: 'B', datasource: { uid: s.datasource_uid, type: 'prometheus' }, expr: s.model_query, instant: true, range: false, format: 'table' },
  ] });
  const response = await fetchImpl(url.toString(), { method: 'POST', body, addresses: base.validatedAddresses,
    headers: { Authorization: `Bearer ${decrypt(s.token)}`, 'Content-Type': 'application/json', Accept: 'application/json' } });
  if (response.status === 401 || response.status === 403) throw new Error('Grafana refused the token (it needs Viewer rights on the data source)');
  if (!response.ok) throw new Error(`Grafana answered HTTP ${response.status}`);
  const data = await response.json();
  const frames = refId => data?.results?.[refId]?.frames || [];
  for (const refId of ['A', 'B']) if (data?.results?.[refId]?.error) throw new Error(`Grafana query ${refId === 'A' ? 'for versions' : 'for models'} failed: ${data.results[refId].error}`);
  return { versions: rowsOf(frames('A')), models: rowsOf(frames('B')) };
}

/** Data frames → [{ labels, value }], for both the "one field per series" and the table shapes. */
function rowsOf(frames) {
  const rows = [];
  for (const frame of frames) {
    const fields = frame?.schema?.fields || [], values = frame?.data?.values || [];
    const labelled = fields.map((field, index) => ({ field, index })).filter(({ field }) => field.labels && Object.keys(field.labels).length);
    if (labelled.length) {
      for (const { field, index } of labelled) { const column = values[index] || []; rows.push({ labels: field.labels, value: column[column.length - 1] }); }
      continue;
    }
    const count = Math.max(0, ...values.map(column => column.length));
    for (let i = 0; i < count; i++) {
      const labels = {}; let value;
      fields.forEach((field, k) => {
        if (/^Value( #\w+)?$/.test(field.name)) value = values[k]?.[i];
        else if (field.name !== 'Time') labels[field.name] = values[k]?.[i];
      });
      rows.push({ labels, value });
    }
  }
  return rows;
}

/** "R81_20_jumbo_hf_main" → "R81.20", "R82_jumbo_hf_main" → "R82"; managers may name others (e.g. jess_main → R82.10). */
function versionOf(label, versionMap = {}) {
  if (!label) return null;
  if (Object.hasOwn(versionMap, label)) return versionMap[label];
  const match = String(label).match(/^R(\d+)(?:_(\d+))?_jumbo/i);
  return match ? `R${match[1]}${match[2] ? `.${match[2]}` : ''}` : null;
}

/** One row per device: { host_name, version_label, version, build, take, model }. */
function devicesFrom({ versions, models }, s) {
  const byHost = new Map();
  for (const row of versions) {
    const host = String(row.labels?.host_name || '').trim();
    if (!host) continue;
    const build = row.value == null ? null : String(Math.round(Number(row.value)));
    const takes = takesOf(s);
    const take = build && Object.hasOwn(takes, build) ? Number(takes[build]) : null;
    byHost.set(host, { host_name: host, version_label: row.labels.name || null, version: versionOf(row.labels.name, s.version_map), build, take, model: null });
  }
  for (const row of models) {
    const host = String(row.labels?.host_name || '').trim();
    if (!host) continue;
    const device = byHost.get(host) || { host_name: host, version_label: null, version: null, build: null, take: null, model: null };
    device.model = row.labels.model || device.model;
    byHost.set(host, device);
  }
  return [...byHost.values()];
}

/** What the asset's software version should read, e.g. "R81.20 Take 170" (null when the version line is unknown). */
const softwareVersionOf = device => (device.version ? `${device.version}${device.take ? ` Take ${device.take}` : ''}` : null);

/* ── Mappings from a dashboard ───────────────────────────────────── */
/** Build → take pairs from a dashboard's JSON value mappings; conflicting builds are reported. */
function takeMapFromDashboard(json) {
  const found = new Map(), conflicts = new Map();
  const visit = node => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object') return;
    if (node.type === 'value' && node.options && typeof node.options === 'object') {
      for (const [build, option] of Object.entries(node.options)) {
        const take = String(option?.text || '').match(/^Take\s+(\d{1,4})$/i)?.[1];
        if (!/^\d{6,12}$/.test(build) || !take) continue;
        const known = found.get(build);
        if (known != null && known !== Number(take)) conflicts.set(build, [...new Set([...(conflicts.get(build) || [known]), Number(take)])]);
        else found.set(build, Number(take));
      }
    }
    Object.values(node).forEach(visit);
  };
  visit(json);
  for (const build of conflicts.keys()) found.delete(build);
  return { map: Object.fromEntries([...found].sort()), conflicts: Object.fromEntries(conflicts) };
}

/* ── Matching and review ─────────────────────────────────────────── */
const norm = value => String(value || '').trim().toLowerCase();

async function assetsIndex(store = db) {
  const rows = await store.prepare(`SELECT a.id, a.customer_id, a.name, a.hostname, a.model, a.software_version, a.version, c.name AS customer_name
    FROM customer_assets a JOIN customers c ON c.id = a.customer_id WHERE a.lifecycle_status IN ('active','spare')`).all();
  return rows.map(row => ({ id: Number(row.id), customer_id: Number(row.customer_id), customer_name: decrypt(row.customer_name), name: decrypt(row.name) || '',
    hostname: decrypt(row.hostname) || '', model: decrypt(row.model) || '', software_version: decrypt(row.software_version) || '', version: Number(row.version) }));
}

/** Every device last seen, with its asset and what would change. */
async function review(store = db) {
  const s = await settings(store);
  const [stored, links, assets] = await Promise.all([
    store.prepare('SELECT * FROM grafana_devices ORDER BY host_name').all(),
    store.prepare('SELECT host_name, asset_id, ignored FROM grafana_host_links').all(),
    assetsIndex(store),
  ]);
  // Take and version line from the current lists, so a mapping added later applies at once.
  const takes = takesOf(s);
  const devices = stored.map(d => ({ ...d, take: d.build && Object.hasOwn(takes, d.build) ? Number(takes[d.build]) : null, version: versionOf(d.version_label, s.version_map) || d.version }));
  const linkOf = new Map(links.map(link => [norm(link.host_name), link]));
  const byId = new Map(assets.map(a => [a.id, a]));
  return devices.map(device => {
    const link = linkOf.get(norm(device.host_name));
    let candidates;
    if (link?.ignored) return { ...device, status: 'ignored', asset: null, changes: [] };
    if (link?.asset_id) candidates = byId.has(Number(link.asset_id)) ? [byId.get(Number(link.asset_id))] : [];
    else {
      candidates = assets.filter(a => norm(a.hostname) === norm(device.host_name));
      if (!candidates.length) candidates = assets.filter(a => norm(a.name) === norm(device.host_name));
    }
    const proposed = softwareVersionOf(device);
    if (candidates.length !== 1) return { ...device, proposed_version: proposed, status: candidates.length ? 'ambiguous' : 'unmatched', asset: null, candidates: candidates.map(a => ({ id: a.id, name: a.name, customer_name: a.customer_name })), changes: [] };
    const asset = candidates[0];
    const changes = [];
    // With no take known for the build, only the version line is compared, so a known take is never wiped.
    const lineOf = text => norm(text).replace(/\s*(take|jhf|t)\s*_?\d+.*$/, '');
    const differs = device.take ? norm(proposed) !== norm(asset.software_version) : lineOf(proposed) !== lineOf(asset.software_version);
    if (proposed && differs) changes.push({ field: 'software_version', from: asset.software_version || null, to: proposed });
    if (device.model && norm(device.model) !== norm(asset.model)) changes.push({ field: 'model', from: asset.model || null, to: device.model });
    return { ...device, proposed_version: proposed, linked: !!link?.asset_id, status: changes.length ? 'differs' : 'matches',
      asset: { id: asset.id, name: asset.name, customer_id: asset.customer_id, customer_name: asset.customer_name, software_version: asset.software_version || null, model: asset.model || null }, changes };
  });
}

/** Applies Grafana's values to the matched assets of `hostNames` (differences, and a review for matches). */
async function apply(hostNames, { userId = null, store = db } = {}) {
  const wanted = new Set(hostNames.map(norm));
  const rows = (await review(store)).filter(row => wanted.has(norm(row.host_name)) && ['differs', 'matches'].includes(row.status));
  const applied = [];
  for (const row of rows) {
    const next = Object.fromEntries(row.changes.map(change => [change.field, change.to]));
    const done = await store.transaction(async tx => {
      const current = await tx.prepare('SELECT * FROM customer_assets WHERE id = ?').get(row.asset.id);
      if (!current) return false;
      const before = decrypt(current.software_version) || null;
      const after = next.software_version ?? before;
      const model = next.model ?? (decrypt(current.model) || null);
      const updated = (await tx.prepare(`UPDATE customer_assets SET software_version = ?, model = ?, reviewed_at = app_now(), reviewed_by = ?, updated_by = COALESCE(?, updated_by), updated_at = app_now(), version = version + 1
        WHERE id = ? AND version = ? RETURNING *`).all(encrypt(after), encrypt(model), userId, userId, current.id, current.version))[0];
      if (!updated) return false;
      await tx.prepare('INSERT INTO customer_asset_versions (asset_id, customer_id, kind, from_version, to_version, note, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(updated.id, updated.customer_id, 'reviewed', encrypt(before), encrypt(after), encrypt(`From Grafana (${row.host_name})`), userId);
      await tx.prepare('INSERT INTO customer_asset_history (asset_id, customer_id, user_id, action, lifecycle_status, coverage_type, version) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(updated.id, updated.customer_id, userId, 'updated', updated.lifecycle_status, updated.coverage_type, updated.version);
      if (next.model !== undefined) {
        const plain = ['name', 'hostname', 'serial_number', 'asset_tag', 'ip_address', 'mac_address', 'model'].reduce((out, key) => ({ ...out, [key]: decrypt(updated[key]) || null }), { id: updated.id });
        await require('./assetSearchIndex').replaceAssetSearchDocument(tx, plain);
      }
      return true;
    });
    if (done) applied.push({ host_name: row.host_name, asset_id: row.asset.id, asset_name: row.asset.name, changes: row.changes });
  }
  return applied;
}

/** Reads Grafana, keeps what each device runs, and (when switched on) applies the differences. */
async function sync({ store = db, fetchImpl, validateUrl, userId = null } = {}) {
  let s = await settings(store);
  let result, dashboard = null;
  try {
    // The dashboard's current mappings first; if it cannot be read, the last ones read are kept.
    if (s.dashboard_uid && s.base_url && s.token) {
      try {
        const read = await dashboardTakes(s, { fetchImpl, validateUrl });
        s = { ...s, dashboard_take_map: read.map, dashboard_conflicts: read.conflicts, dashboard_read_at: new Date().toISOString() };
        dashboard = { builds: Object.keys(read.map).length, conflicts: Object.keys(read.conflicts).length };
      } catch (error) { dashboard = { error: error.message }; }
    }
    const devices = devicesFrom(await query(s, { fetchImpl, validateUrl }), s);
    await store.transaction(async tx => {
      for (const d of devices) {
        await tx.prepare(`INSERT INTO grafana_devices (host_name, version_label, version, build, take, model, seen_at) VALUES (?, ?, ?, ?, ?, ?, app_now())
          ON CONFLICT (host_name) DO UPDATE SET version_label = EXCLUDED.version_label, version = EXCLUDED.version, build = EXCLUDED.build, take = EXCLUDED.take, model = EXCLUDED.model, seen_at = EXCLUDED.seen_at`)
          .run(d.host_name, d.version_label, d.version, d.build, d.take, d.model);
      }
    });
    const rows = await review(store);
    const count = status => rows.filter(row => row.status === status).length;
    let applied = [];
    if (s.auto_apply) applied = await apply(rows.filter(row => row.status === 'differs').map(row => row.host_name), { userId, store });
    result = { ok: true, devices: devices.length, differs: count('differs') - applied.length, unmatched: count('unmatched') + count('ambiguous'),
      unknown_takes: devices.filter(d => d.build && !d.take).length, applied: applied.length, ...(dashboard ? { dashboard } : {}) };
  } catch (error) {
    result = { ok: false, error: error.message };
  }
  await saveSettings({ ...s, last_sync_at: new Date().toISOString(), last_result: result }, store);
  return result;
}

module.exports = { KEY, DEFAULTS, settings, saveSettings, publicSettings, takesOf, dashboardTakes, query, rowsOf, versionOf, devicesFrom, softwareVersionOf, takeMapFromDashboard, review, apply, sync };
