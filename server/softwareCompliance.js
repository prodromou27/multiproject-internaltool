/**
 * Which customer assets run older software than the Software versions page
 * says is current. An asset matches a followed product by vendor (and model,
 * when the product names one); its software version is read as a numbered
 * version (FortiOS 7.4.3, PAN-OS 11.1.2-h3) or a Check Point version with its
 * Jumbo take (R81.20 Take 141). Its version line is the longest branch it
 * starts with (7.4, R81.20), and it is compared with that line's latest.
 */
const db = require('./db');
const appTime = require('./appTime');
const { decrypt } = require('./fieldCipher');

const numbers = text => (String(text || '').match(/\d+(?:\.\d+)+|\d+/) || [''])[0].split('.').filter(Boolean).map(Number);
const takeOf = text => { const m = String(text || '').match(/(?:take|jhf|hf|t)\s*_?(\d+)/i); return m ? Number(m[1]) : null; };
const checkPointBranch = text => (String(text || '').match(/R\d+(?:\.\d+)?/i) || [null])[0]?.toUpperCase() || null;

function compareNumbers(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** The followed product an asset runs: vendor must match; a product naming a model must match it too, and wins over vendor-only ones. */
function productFor(asset, products) {
  const vendor = (asset.vendor || '').toLowerCase(), model = (asset.model || '').toLowerCase();
  if (!vendor) return null;
  const byVendor = products.filter(p => p.asset_vendor && vendor.includes(p.asset_vendor.toLowerCase()));
  const byModel = byVendor.filter(p => p.asset_model && model.includes(p.asset_model.toLowerCase()));
  return byModel[0] || byVendor.find(p => !p.asset_model) || null;
}

/**
 * Status of one asset against its product's releases:
 * current | behind | end_of_life | unknown_line (not a followed line) | unreadable (version not understood).
 */
function assessVersion(version, product, today = appTime.today()) {
  const releases = product.releases || [];
  if (product.source === 'checkpoint') {
    const branch = checkPointBranch(version), take = takeOf(version.replace(/R\d+(?:\.\d+)?/i, ''));
    if (!branch) return { status: 'unreadable' };
    const release = releases.find(r => r.branch.toUpperCase() === branch);
    if (!release) return { status: 'unknown_line', line: branch };
    const latest = takeOf(release.latest_version), recommended = takeOf(release.recommended_version);
    const base = { line: release.branch, latest: release.latest_version, recommended: release.recommended_version || null };
    if (release.eol && release.eol < today) return { ...base, status: 'end_of_life', eol: release.eol };
    if (take == null || latest == null) return { ...base, status: take == null ? 'unreadable' : 'current' };
    return take >= latest ? { ...base, status: 'current' } : { ...base, status: 'behind', behind: latest - take, behind_unit: 'take', below_recommended: recommended != null && take < recommended };
  }
  const parts = numbers(version);
  if (parts.length < 2) return { status: 'unreadable' };
  const release = releases
    .filter(r => { const b = numbers(r.branch); return b.length && b.every((n, i) => parts[i] === n); })
    .sort((a, b) => numbers(b.branch).length - numbers(a.branch).length)[0];
  if (!release) return { status: 'unknown_line', line: parts.slice(0, 2).join('.') };
  const base = { line: release.branch, latest: release.latest_version, recommended: release.recommended_version || null };
  if (release.eol && release.eol < today) return { ...base, status: 'end_of_life', eol: release.eol };
  const latest = numbers(release.latest_version);
  if (latest.length < 2) return { ...base, status: 'current' };
  if (compareNumbers(parts, latest) >= 0) return { ...base, status: 'current' };
  const at = latest.findIndex((n, i) => n !== (parts[i] || 0));
  const behind = at === latest.length - 1 ? latest[at] - (parts[at] || 0) : null;
  return { ...base, status: 'behind', behind, behind_unit: behind == null ? null : 'patch' };
}

async function loadProducts(store = db) {
  const products = await store.prepare('SELECT id, name, vendor, source, asset_vendor, asset_model FROM software_products WHERE enabled = 1 AND asset_vendor IS NOT NULL ORDER BY display_order, id').all();
  const releases = await store.prepare('SELECT product_id, branch, latest_version, recommended_version, eol, support_end FROM software_releases').all();
  return products.map(p => ({ ...p, releases: releases.filter(r => Number(r.product_id) === Number(p.id)) }));
}

/** Every active asset with a software version, of one customer or all, with its status. */
async function assetSoftwareStatus({ customerId = null, store = db, today = appTime.today() } = {}) {
  const products = await loadProducts(store);
  if (!products.length) return { products: 0, assets: [] };
  const rows = await store.prepare(`SELECT a.id, a.customer_id, a.name, a.vendor, a.model, a.software_version, c.name AS customer_name
    FROM customer_assets a JOIN customers c ON c.id = a.customer_id
    WHERE a.lifecycle_status = 'active' AND a.software_version IS NOT NULL${customerId ? ' AND a.customer_id = ?' : ''}`).all(...(customerId ? [customerId] : []));
  const assets = [];
  for (const row of rows) {
    const asset = { id: Number(row.id), customer_id: Number(row.customer_id), customer_name: decrypt(row.customer_name), name: decrypt(row.name),
      vendor: decrypt(row.vendor), model: decrypt(row.model), software_version: decrypt(row.software_version) };
    if (!asset.software_version) continue;
    const product = productFor(asset, products);
    if (!product) continue;
    assets.push({ ...asset, product_id: Number(product.id), product_name: product.name, ...assessVersion(asset.software_version, product, today) });
  }
  return { products: products.length, assets };
}

module.exports = { numbers, takeOf, productFor, assessVersion, assetSoftwareStatus, loadProducts };
