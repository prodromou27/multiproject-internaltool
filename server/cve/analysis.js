/**
 * Joins CVEs with customers' assets: which asset versions each CVE affects,
 * and which CVEs affect each product version. Recomputed only when assets,
 * CVEs or product mappings change (a cheap fingerprint query decides).
 */
const db = require('../db');
const { decrypt } = require('../fieldCipher');
const { normalize, affects, cpeVendorFor } = require('./match');

let cache = { key: null, value: null };

async function fingerprint(store) {
  const [assets, cves, mappings, watch, kev] = await Promise.all([
    store.prepare('SELECT COUNT(*) AS n, MAX(updated_at) AS t FROM customer_assets').get(),
    store.prepare('SELECT COUNT(*) AS n, MAX(fetched_at) AS t FROM cves').get(),
    store.prepare('SELECT COUNT(*) AS n, MAX(updated_at) AS t FROM cve_asset_products').get(),
    store.prepare('SELECT COUNT(*) AS n, SUM(hidden) AS h, MAX(id) AS m FROM cve_watch').get(),
    store.prepare('SELECT COUNT(*) AS n FROM cve_kev').get(),
  ]);
  return JSON.stringify([assets, cves, mappings, watch, kev]);
}

/** Everything the portal needs, for all customers; callers filter by what a person may see. */
async function analyse(store = db) {
  const key = await fingerprint(store);
  if (cache.key === key) return cache.value;

  const technologies = new Map((await store.prepare('SELECT id, name FROM technologies').all()).map(row => [Number(row.id), row.name]));
  const assets = (await store.prepare("SELECT id, customer_id, name, vendor, model, software_version, technology_id FROM customer_assets WHERE lifecycle_status IN ('active','spare')").all())
    .map(row => ({ id: Number(row.id), customer_id: Number(row.customer_id), name: decrypt(row.name) || '', vendor: String(decrypt(row.vendor) || '').trim(), model: String(decrypt(row.model) || '').trim(),
      version: String(decrypt(row.software_version) || '').trim(), technology: technologies.get(Number(row.technology_id)) || '' }))
    .filter(asset => asset.vendor);
  const mappings = new Map((await store.prepare('SELECT asset_vendor, asset_model, cpe_vendor, cpe_product FROM cve_asset_products').all())
    .map(row => [`${row.asset_vendor}|${row.asset_model}`, { vendor: row.cpe_vendor, product: row.cpe_product }]));
  // A model's own mapping wins; otherwise one set for the whole vendor (model '').
  const productOf = asset => mappings.get(`${normalize(asset.vendor)}|${normalize(asset.model)}`) || mappings.get(`${normalize(asset.vendor)}|`) || null;

  const watch = await store.prepare('SELECT cpe_vendor, cpe_product, hidden FROM cve_watch').all();
  const shown = watch.filter(row => !row.hidden);
  const watched = products => shown.some(row => (row.cpe_product ? products.includes(` ${row.cpe_vendor}:${row.cpe_product} `) : products.includes(` ${row.cpe_vendor}:`)));

  const kev = new Map((await store.prepare('SELECT cve_id, name, date_added, due_date, required_action, ransomware FROM cve_kev').all()).map(row => [row.cve_id, row]));
  const rows = await store.prepare('SELECT id, published, description, cvss_score, severity, entries, products FROM cves').all();

  const cves = [], byAssetVersion = new Map();
  for (const row of rows) {
    if (!watched(row.products || '')) continue;
    let entries = [];
    try { entries = JSON.parse(row.entries || '[]'); } catch { /* keep none */ }
    const verdicts = new Map(), affected = [];
    for (const asset of assets) {
      const product = productOf(asset);
      if (!product) continue;
      const cacheKey = `${product.vendor}:${product.product}|${asset.version}`;
      if (!verdicts.has(cacheKey)) verdicts.set(cacheKey, affects(entries, product.vendor, product.product, asset.version));
      const verdict = verdicts.get(cacheKey);
      if (verdict === 'yes' || verdict === 'unknown') affected.push({ asset_id: asset.id, customer_id: asset.customer_id, verdict });
    }
    const record = { id: row.id, published: row.published, description: row.description || '', cvss_score: row.cvss_score === null ? null : Number(row.cvss_score),
      severity: row.severity || null, products: (row.products || '').trim().split(/\s+/).filter(Boolean), kev: kev.get(row.id) || null, affected, entries };
    cves.push(record);
    for (const hit of affected) {
      if (!byAssetVersion.has(hit.asset_id)) byAssetVersion.set(hit.asset_id, []);
      byAssetVersion.get(hit.asset_id).push({ id: record.id, severity: record.severity, kev: !!record.kev, verdict: hit.verdict });
    }
  }
  cves.sort((a, b) => String(b.published || '').localeCompare(String(a.published || '')) || b.id.localeCompare(a.id));
  const value = { cves, assets, byAsset: byAssetVersion, productOf, mappings, cpeVendorFor };
  cache = { key, value };
  return value;
}

/** For tests: forget the cached analysis. */
function reset() { cache = { key: null, value: null }; }

module.exports = { analyse, reset };
