// Grafana device sync (grafana.js): managers connect Grafana, keep the build → take
// list, sync, and review what each customer device really runs before it is applied.
const router = require('express').Router();
const db = require('../db');
const { requireManager } = require('../middleware/auth');
const { logAudit } = require('../auditLog');
const { encrypt } = require('../fieldCipher');
const grafana = require('../grafana');

router.use(requireManager);
const bad = (res, error) => res.status(400).json({ error });
const BUILD = /^\d{6,12}$/;
const validTakeMap = map => map && typeof map === 'object' && !Array.isArray(map) && Object.keys(map).length <= 2000
  && Object.entries(map).every(([build, take]) => BUILD.test(build) && Number.isInteger(take) && take > 0 && take < 10000);

router.get('/settings', async (req, res) => res.json(grafana.publicSettings(await grafana.settings())));

router.put('/settings', async (req, res) => {
  const body = req.body || {}, current = await grafana.settings();
  const next = { ...current };
  if (body.base_url !== undefined) {
    if (typeof body.base_url !== 'string' || body.base_url.length > 300 || (body.base_url && !/^https?:\/\/[^\s/]+/i.test(body.base_url))) return bad(res, 'The Grafana address must be an http(s) address');
    next.base_url = body.base_url.trim().replace(/\/+$/, '');
  }
  if (body.token !== undefined && body.token !== '') {
    if (typeof body.token !== 'string' || body.token.length > 500) return bad(res, 'Invalid token');
    next.token = encrypt(body.token.trim());
  }
  if (body.clear_token === true) delete next.token;
  if (body.datasource_uid !== undefined) {
    if (typeof body.datasource_uid !== 'string' || !/^[\w-]{0,64}$/.test(body.datasource_uid)) return bad(res, 'The data source is its UID (letters, digits, - and _)');
    next.datasource_uid = body.datasource_uid;
  }
  for (const key of ['version_query', 'model_query']) if (body[key] !== undefined) {
    if (typeof body[key] !== 'string' || !body[key].trim() || body[key].length > 2000) return bad(res, 'Each query must be 1 to 2000 characters');
    next[key] = body[key].trim();
  }
  if (body.version_map !== undefined) {
    const map = body.version_map;
    if (!map || typeof map !== 'object' || Array.isArray(map) || Object.keys(map).length > 200 || Object.entries(map).some(([label, version]) => !/^[\w.-]{1,80}$/.test(label) || typeof version !== 'string' || !/^R\d+(\.\d+)?$/.test(version)))
      return bad(res, 'Version names map a label to a version such as R82.10');
    next.version_map = map;
  }
  if (body.take_map !== undefined) {
    if (!validTakeMap(body.take_map)) return bad(res, 'Each build (6 to 12 digits) maps to a take number');
    next.take_map = body.take_map;
  }
  if (body.auto_apply !== undefined) next.auto_apply = body.auto_apply === true;
  if (body.dashboard_uid !== undefined) {
    if (typeof body.dashboard_uid !== 'string' || !/^[\w-]{0,80}$/.test(body.dashboard_uid)) return bad(res, 'The dashboard is its UID (letters, digits, - and _)');
    next.dashboard_uid = body.dashboard_uid;
  }
  await grafana.saveSettings(next);
  await logAudit(db, req, 'grafana_sync', null, 'Grafana device sync', 'settings_updated', Object.keys(body).filter(k => k !== 'token').join(', ') + (body.token ? ', token' : ''));
  res.json(grafana.publicSettings(next));
});

// Take mappings read from a dashboard's JSON (its value mappings "build" → "Take N").
router.post('/take-map/import', async (req, res) => {
  let json = req.body?.dashboard;
  if (typeof json === 'string') { try { json = JSON.parse(json); } catch { return bad(res, 'That is not valid JSON'); } }
  if (!json || typeof json !== 'object') return bad(res, 'Paste the dashboard JSON');
  const { map, conflicts } = grafana.takeMapFromDashboard(json);
  if (!Object.keys(map).length && !Object.keys(conflicts).length) return bad(res, 'No "Take N" value mappings were found in that dashboard');
  const current = await grafana.settings();
  // Builds already in the list keep their take; conflicts are left for a person to settle.
  const added = Object.fromEntries(Object.entries(map).filter(([build]) => !Object.hasOwn(current.take_map, build)));
  await grafana.saveSettings({ ...current, take_map: { ...current.take_map, ...added } });
  await logAudit(db, req, 'grafana_sync', null, 'Grafana device sync', 'take_map_imported', `${Object.keys(added).length} added, ${Object.keys(conflicts).length} conflicting`);
  res.json({ added: Object.keys(added).length, found: Object.keys(map).length, conflicts, take_map: { ...current.take_map, ...added } });
});

router.post('/sync', async (req, res) => {
  const result = await grafana.sync({ userId: req.user.id });
  await logAudit(db, req, 'grafana_sync', null, 'Grafana device sync', 'synced', result.ok ? `${result.devices} devices, ${result.differs} to review, ${result.applied} applied` : result.error);
  res.status(result.ok ? 200 : 502).json(result);
});

router.get('/devices', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ rows: await grafana.review() });
});

router.post('/apply', async (req, res) => {
  const names = req.body?.host_names;
  if (!Array.isArray(names) || !names.length || names.length > 2000 || names.some(n => typeof n !== 'string' || n.length > 200)) return bad(res, 'Choose the devices to apply');
  const applied = await grafana.apply(names, { userId: req.user.id });
  for (const row of applied) await logAudit(db, req, 'customer_asset', row.asset_id, row.asset_name, 'updated_from_grafana', row.changes.map(c => `${c.field}: ${c.from || '—'} → ${c.to}`).join('; ') || 'reviewed, no change');
  res.json({ applied: applied.length });
});

// A device that does not match by name: link it to an asset, or ignore it.
router.post('/link', async (req, res) => {
  const { host_name: host, asset_id: assetId, ignore } = req.body || {};
  if (typeof host !== 'string' || !host.trim() || host.length > 200) return bad(res, 'host_name is required');
  if (ignore !== true && assetId !== null && !(Number.isSafeInteger(assetId) && assetId > 0)) return bad(res, 'Choose an asset, clear the link, or ignore the device');
  if (assetId && !await db.prepare('SELECT 1 FROM customer_assets WHERE id = ?').get(assetId)) return res.status(404).json({ error: 'Asset not found' });
  if (ignore !== true && assetId === null) await db.prepare('DELETE FROM grafana_host_links WHERE host_name = ?').run(host.trim());
  else await db.prepare(`INSERT INTO grafana_host_links (host_name, asset_id, ignored, linked_by, linked_at) VALUES (?, ?, ?, ?, app_now())
    ON CONFLICT (host_name) DO UPDATE SET asset_id = EXCLUDED.asset_id, ignored = EXCLUDED.ignored, linked_by = EXCLUDED.linked_by, linked_at = EXCLUDED.linked_at`)
    .run(host.trim(), ignore === true ? null : assetId, ignore === true ? 1 : 0, req.user.id);
  await logAudit(db, req, 'grafana_sync', null, host.trim(), ignore === true ? 'device_ignored' : assetId ? 'device_linked' : 'device_unlinked', assetId ? `asset ${assetId}` : null);
  res.json({ ok: true });
});

// Assets to link a device to, by name or hostname (managers see every customer).
router.get('/assets', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
  if (q.length < 2 || q.length > 100) return bad(res, 'Type at least 2 characters');
  const { decrypt } = require('../fieldCipher');
  const rows = (await db.prepare("SELECT a.id, a.name, a.hostname, c.name AS customer_name FROM customer_assets a JOIN customers c ON c.id = a.customer_id WHERE a.lifecycle_status IN ('active','spare')").all())
    .map(row => ({ id: Number(row.id), name: decrypt(row.name) || '', hostname: decrypt(row.hostname) || '', customer_name: decrypt(row.customer_name) || '' }))
    .filter(row => `${row.name} ${row.hostname} ${row.customer_name}`.toLowerCase().includes(q)).slice(0, 25);
  res.json({ rows });
});

module.exports = router;
