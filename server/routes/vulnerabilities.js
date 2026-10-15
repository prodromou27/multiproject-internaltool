const router = require('express').Router();
const db = require('../db');
const { requireAuth, requireManager } = require('../middleware/auth');
const { logAudit } = require('../auditLog');
const { decrypt } = require('../fieldCipher');
const { accessibleCustomerIds } = require('../customerAccess');
const { analyse } = require('../cve/analysis');
const { normalize, cpeVendorFor } = require('../cve/match');
const sync = require('../cve/sync');

/* The Vulnerabilities page (CVE portal). Everyone sees the CVEs for the
   products we watch; which customer assets are affected is shown only for
   customers the person may see. Managers choose what is watched. */
router.use(requireAuth);

const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const CPE_NAME = /^[a-z0-9][a-z0-9._\-]{0,99}$/;
const bad = (res, message) => res.status(400).json({ error: message });

async function visibleTo(user) {
  const ids = await accessibleCustomerIds(user);
  return customerId => ids === null || ids.has(Number(customerId));
}
async function customerNames(ids) {
  if (!ids.length) return new Map();
  return new Map((await db.prepare(`SELECT id, name FROM customers WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)).map(row => [Number(row.id), decrypt(row.name)]));
}
async function lastSync() {
  const stored = await sync.settings();
  return { at: stored.last_sync_at || null, running: !!stored.sync_running_since || sync.isRunning(), result: stored.last_sync_result || null };
}

router.get('/', async (req, res) => {
  const { q = '', severity = '', kev = '', affected = '', product = '' } = req.query;
  if ([q, severity, kev, affected, product].some(value => typeof value !== 'string') || q.length > 200 || product.length > 200) return bad(res, 'Invalid filters');
  if (severity && !SEVERITIES.includes(severity)) return bad(res, 'Severity must be critical, high, medium or low');
  const page = Number(req.query.page || 1), pageSize = Number(req.query.page_size || 25);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) return bad(res, 'Invalid page');
  const data = await analyse(), canSee = await visibleTo(req.user);
  const mine = cve => cve.affected.filter(hit => canSee(hit.customer_id));
  const term = q.trim().toLowerCase();
  const filtered = data.cves.filter(cve => (!severity || cve.severity === severity) && (kev !== '1' || cve.kev)
    && (!product || cve.products.some(item => (product.endsWith(':') ? item.startsWith(product) : item === product)))
    && (!term || cve.id.toLowerCase().includes(term) || cve.description.toLowerCase().includes(term) || cve.products.some(item => item.includes(term)))
    && (affected !== '1' || mine(cve).some(hit => hit.verdict === 'yes')) && (affected !== 'check' || mine(cve).length > 0));
  const counts = { all: data.cves.length, critical: 0, high: 0, kev: 0, affected: 0 };
  for (const cve of data.cves) {
    if (cve.severity === 'critical') counts.critical++;
    if (cve.severity === 'high') counts.high++;
    if (cve.kev) counts.kev++;
    if (mine(cve).some(hit => hit.verdict === 'yes')) counts.affected++;
  }
  const rows = filtered.slice((page - 1) * pageSize, page * pageSize).map(cve => {
    const hits = mine(cve);
    return { id: cve.id, published: cve.published, severity: cve.severity, cvss_score: cve.cvss_score, description: cve.description.slice(0, 400), products: cve.products,
      kev: cve.kev ? { date_added: cve.kev.date_added, due_date: cve.kev.due_date, ransomware: cve.kev.ransomware } : null,
      affected_assets: hits.filter(hit => hit.verdict === 'yes').length, check_assets: hits.filter(hit => hit.verdict === 'unknown').length,
      affected_customers: new Set(hits.filter(hit => hit.verdict === 'yes').map(hit => hit.customer_id)).size };
  });
  res.json({ rows, total: filtered.length, page, page_size: pageSize, counts, sync: await lastSync() });
});

/* Products & versions: what customers run, and how many CVEs affect each version. */
router.get('/products', async (req, res) => {
  const data = await analyse(), canSee = await visibleTo(req.user);
  const assets = data.assets.filter(asset => canSee(asset.customer_id));
  const names = await customerNames([...new Set(assets.map(asset => asset.customer_id))]);
  const cveById = new Map(data.cves.map(cve => [cve.id, cve]));
  const groups = new Map();
  for (const asset of assets) {
    const key = `${normalize(asset.vendor)}|${normalize(asset.model)}`;
    if (!groups.has(key)) {
      const exact = data.mappings.get(key), vendorWide = data.mappings.get(`${normalize(asset.vendor)}|`);
      groups.set(key, { vendor: asset.vendor, model: asset.model, technology: asset.technology, product: exact || vendorWide || null, product_scope: exact ? 'model' : vendorWide ? 'vendor' : null, versions: new Map() });
    }
    const group = groups.get(key), version = asset.version || '';
    if (!group.versions.has(version)) group.versions.set(version, { version, assets: [], cves: new Set(), check: new Set() });
    const entry = group.versions.get(version);
    entry.assets.push({ id: asset.id, name: asset.name, customer_id: asset.customer_id, customer_name: names.get(asset.customer_id) || '' });
    for (const hit of data.byAsset.get(asset.id) || []) (hit.verdict === 'yes' ? entry.cves : entry.check).add(hit.id);
  }
  // NVD product names already seen for a vendor, to choose from when mapping.
  const productsByVendor = new Map();
  for (const cve of data.cves) for (const item of cve.products) { const [vendor, name] = item.split(':'); if (!productsByVendor.has(vendor)) productsByVendor.set(vendor, new Set()); productsByVendor.get(vendor).add(name); }
  const out = [...groups.values()].map(group => {
    const versions = [...group.versions.values()].map(entry => {
      const list = [...entry.cves].map(id => cveById.get(id)).filter(Boolean);
      return { version: entry.version, assets: entry.assets.sort((a, b) => a.customer_name.localeCompare(b.customer_name) || a.name.localeCompare(b.name)),
        cves: { total: list.length, critical: list.filter(cve => cve.severity === 'critical').length, high: list.filter(cve => cve.severity === 'high').length, kev: list.filter(cve => cve.kev).length, check: entry.check.size } };
    }).sort((a, b) => require('../cve/match').compareVersions(b.version, a.version));
    const cpeVendor = group.product?.vendor || cpeVendorFor(group.vendor);
    return { vendor: group.vendor, model: group.model, technology: group.technology, product: group.product, product_scope: group.product_scope,
      suggested_vendor: cpeVendor, known_products: [...(productsByVendor.get(cpeVendor) || [])].sort(), versions,
      asset_count: versions.reduce((sum, entry) => sum + entry.assets.length, 0) };
  }).sort((a, b) => a.vendor.localeCompare(b.vendor) || a.model.localeCompare(b.model));
  res.json({ groups: out, sync: await lastSync() });
});

/* ── Managers: what is watched, the NVD API key, and running a sync ───────── */
router.get('/admin/status', requireManager, async (req, res) => {
  const stored = await sync.settings();
  const watch = await db.prepare('SELECT id, cpe_vendor, cpe_product, label, source, asset_vendor, hidden, total, last_sync_at, last_status, last_error FROM cve_watch ORDER BY cpe_vendor, cpe_product').all();
  res.json({ nvd_api_key_set: !!stored.nvd_api_key, sync: await lastSync(), watch: watch.map(row => ({ ...row, hidden: !!row.hidden })) });
});

router.put('/admin/settings', requireManager, async (req, res) => {
  const body = req.body || {};
  if (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['nvd_api_key', 'clear_nvd_api_key'].includes(key))) return bad(res, 'Invalid settings');
  if (body.nvd_api_key !== undefined && (typeof body.nvd_api_key !== 'string' || body.nvd_api_key.length > 200)) return bad(res, 'The NVD API key must be text');
  const stored = await sync.settings();
  if (body.clear_nvd_api_key === true) delete stored.nvd_api_key;
  else if (body.nvd_api_key?.trim()) stored.nvd_api_key = sync.encryptKey(body.nvd_api_key.trim());
  await sync.saveSettings(stored);
  await logAudit(db, req, 'settings', null, 'Vulnerabilities', 'vulnerability_settings_updated', `nvd_api_key_set=${!!stored.nvd_api_key}`);
  res.json({ nvd_api_key_set: !!stored.nvd_api_key });
});

router.post('/admin/watch', requireManager, async (req, res) => {
  const vendor = String(req.body?.cpe_vendor || '').trim().toLowerCase(), product = String(req.body?.cpe_product || '').trim().toLowerCase();
  const label = typeof req.body?.label === 'string' ? req.body.label.trim().slice(0, 200) : '';
  if (!CPE_NAME.test(vendor) || (product && !CPE_NAME.test(product))) return bad(res, 'Use NVD names: lower case letters, digits, dots, dashes or underscores (for example fortinet and fortios)');
  const result = await db.prepare("INSERT INTO cve_watch (cpe_vendor, cpe_product, label, source) VALUES (?, ?, ?, 'manual') ON CONFLICT (cpe_vendor, cpe_product) DO UPDATE SET hidden = 0").run(vendor, product, label || null);
  await logAudit(db, req, 'cve_watch', result.lastInsertRowid || null, `${vendor}:${product || '*'}`, 'cve_watch_added', null);
  res.status(201).json({ ok: true });
});

router.put('/admin/watch/:id', requireManager, async (req, res) => {
  const id = Number(req.params.id), body = req.body || {};
  if (!Number.isSafeInteger(id) || id < 1) return bad(res, 'Invalid watch ID');
  const row = await db.prepare('SELECT * FROM cve_watch WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (body.hidden !== undefined && typeof body.hidden !== 'boolean') return bad(res, 'Hidden must be true or false');
  let vendor = row.cpe_vendor;
  if (body.cpe_vendor !== undefined) {
    vendor = String(body.cpe_vendor).trim().toLowerCase();
    if (!CPE_NAME.test(vendor)) return bad(res, 'Use the NVD vendor name: lower case letters, digits, dots, dashes or underscores');
    if (vendor !== row.cpe_vendor && await db.prepare('SELECT 1 FROM cve_watch WHERE cpe_vendor = ? AND cpe_product = ? AND id <> ?').get(vendor, row.cpe_product, id)) return res.status(409).json({ error: 'That is already watched' });
  }
  // A corrected NVD name starts a fresh sync for it.
  await db.prepare('UPDATE cve_watch SET hidden = COALESCE(?, hidden), cpe_vendor = ?, last_sync_at = CASE WHEN ? THEN NULL ELSE last_sync_at END WHERE id = ?')
    .run(body.hidden === undefined ? null : (body.hidden ? 1 : 0), vendor, vendor !== row.cpe_vendor, id);
  await logAudit(db, req, 'cve_watch', id, `${vendor}:${row.cpe_product || '*'}`, 'cve_watch_updated', `hidden=${body.hidden}; vendor=${vendor}`);
  res.json({ ok: true });
});

router.delete('/admin/watch/:id', requireManager, async (req, res) => {
  const id = Number(req.params.id);
  const row = Number.isSafeInteger(id) ? await db.prepare('SELECT * FROM cve_watch WHERE id = ?').get(id) : null;
  if (!row) return res.status(404).json({ error: 'Not found' });
  // Vendors that come from assets come back on the next sync; hide them instead.
  if (row.source === 'asset') await db.prepare('UPDATE cve_watch SET hidden = 1 WHERE id = ?').run(id);
  else await db.prepare('DELETE FROM cve_watch WHERE id = ?').run(id);
  await logAudit(db, req, 'cve_watch', id, `${row.cpe_vendor}:${row.cpe_product || '*'}`, 'cve_watch_removed', null);
  res.json({ ok: true });
});

/* Which NVD product an asset vendor (and model) runs, so its versions are checked. */
router.put('/admin/asset-products', requireManager, async (req, res) => {
  const body = req.body || {};
  const assetVendor = normalize(body.asset_vendor), assetModel = normalize(body.asset_model || '');
  if (!assetVendor) return bad(res, 'The asset vendor is required');
  if (body.cpe_product === null) {
    await db.prepare('DELETE FROM cve_asset_products WHERE asset_vendor = ? AND asset_model = ?').run(assetVendor, assetModel);
  } else {
    const vendor = String(body.cpe_vendor || '').trim().toLowerCase(), product = String(body.cpe_product || '').trim().toLowerCase();
    if (!CPE_NAME.test(vendor) || !CPE_NAME.test(product)) return bad(res, 'Use NVD names for the vendor and product (for example fortinet and fortios)');
    await db.prepare(`INSERT INTO cve_asset_products (asset_vendor, asset_model, cpe_vendor, cpe_product, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, app_now())
      ON CONFLICT (asset_vendor, asset_model) DO UPDATE SET cpe_vendor = EXCLUDED.cpe_vendor, cpe_product = EXCLUDED.cpe_product, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`)
      .run(assetVendor, assetModel, vendor, product, req.user.id);
    // Make sure the product's CVEs are fetched.
    await db.prepare("INSERT INTO cve_watch (cpe_vendor, cpe_product, label, source) VALUES (?, ?, ?, 'manual') ON CONFLICT (cpe_vendor, cpe_product) DO UPDATE SET hidden = 0")
      .run(vendor, product, `${body.asset_vendor} ${body.asset_model || ''}`.trim().slice(0, 200));
  }
  await logAudit(db, req, 'cve_asset_product', null, `${assetVendor} ${assetModel}`.trim(), 'cve_asset_product_set', `product=${body.cpe_vendor}:${body.cpe_product}`);
  res.json({ ok: true });
});

router.post('/admin/sync', requireManager, async (req, res) => {
  if (sync.isRunning()) return res.status(202).json({ started: false, running: true });
  sync.syncAll().then(result => console.log('[vulnerabilities] manual sync:', JSON.stringify(result))).catch(error => console.error('[vulnerabilities] manual sync:', error.message));
  await logAudit(db, req, 'settings', null, 'Vulnerabilities', 'vulnerability_sync_started', null);
  res.status(202).json({ started: true });
});

/* One CVE, with the customer assets it affects that this person may see. */
router.get('/:cveId', async (req, res) => {
  const id = String(req.params.cveId || '').toUpperCase();
  if (!/^CVE-\d{4}-\d{4,}$/.test(id)) return bad(res, 'Invalid CVE ID');
  const row = await db.prepare('SELECT * FROM cves WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const data = await analyse(), canSee = await visibleTo(req.user);
  const cve = data.cves.find(item => item.id === id);
  const hits = (cve?.affected || []).filter(hit => canSee(hit.customer_id));
  const assets = new Map(data.assets.map(asset => [asset.id, asset]));
  const names = await customerNames([...new Set(hits.map(hit => hit.customer_id))]);
  let refs = [], entries = [];
  try { refs = JSON.parse(row.refs || '[]'); } catch { /* none */ }
  try { entries = JSON.parse(row.entries || '[]'); } catch { /* none */ }
  const kev = await db.prepare('SELECT * FROM cve_kev WHERE cve_id = ?').get(id);
  res.json({
    id: row.id, published: row.published, last_modified: row.last_modified, description: row.description, severity: row.severity,
    cvss_score: row.cvss_score === null ? null : Number(row.cvss_score), cvss_vector: row.cvss_vector, cvss_version: row.cvss_version,
    references: refs, entries, kev: kev || null, nvd_url: `https://nvd.nist.gov/vuln/detail/${row.id}`,
    affected: hits.map(hit => { const asset = assets.get(hit.asset_id) || {}; return { asset_id: hit.asset_id, asset_name: asset.name, version: asset.version, vendor: asset.vendor, model: asset.model, customer_id: hit.customer_id, customer_name: names.get(hit.customer_id) || '', verdict: hit.verdict }; })
      .sort((a, b) => a.customer_name.localeCompare(b.customer_name) || String(a.asset_name).localeCompare(String(b.asset_name))),
  });
});

module.exports = router;
