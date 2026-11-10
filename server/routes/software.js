const router = require('express').Router();
const db = require('../db');
const { requireAuth, requireManager } = require('../middleware/auth');
const { logAudit } = require('../auditLog');
const sync = require('../software/sync');
const sources = require('../software/sources');

/* The Software versions page. Everyone sees the latest and recommended
   versions of the products we support, what changed recently and news from
   the feeds; managers choose the products, sources and feeds. */
router.use(requireAuth);

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const send = (res, error, fallback) => res.status(error.status || 500).json({ error: error.status ? error.message : fallback });
const parse = value => { try { return JSON.parse(value || '{}'); } catch { return {}; } };
const id = value => { const n = Number(value); if (!Number.isSafeInteger(n) || n < 1) fail('Invalid ID'); return n; };
const shortText = (value, label, max, required = false) => {
  if (value === undefined || value === null || value === '') { if (required) fail(`${label} is required`); return null; }
  if (typeof value !== 'string' || value.trim().length > max) fail(`${label} can be up to ${max} characters`);
  return value.trim() || null;
};
const isoDate = (value, label) => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) fail(`${label} must be a date`);
  return value;
};

router.get('/', async (req, res) => {
  const [products, releases, events, news, feeds] = await Promise.all([
    db.prepare('SELECT * FROM software_products WHERE enabled=1 ORDER BY display_order, name, id').all(),
    db.prepare('SELECT * FROM software_releases ORDER BY product_id, branch').all(),
    db.prepare(`SELECT e.*, p.name AS product_name FROM software_release_events e JOIN software_products p ON p.id=e.product_id
      WHERE p.enabled=1 ORDER BY e.detected_at DESC, e.id DESC LIMIT 30`).all(),
    db.prepare(`SELECT i.id, i.title, i.link, i.published_at, i.summary, i.fetched_at, f.name AS feed_name FROM software_feed_items i JOIN software_feeds f ON f.id=i.feed_id
      WHERE f.enabled=1 ORDER BY COALESCE(i.published_at, i.fetched_at) DESC, i.id DESC LIMIT 40`).all(),
    db.prepare('SELECT COUNT(*) AS n FROM software_feeds WHERE enabled=1').get(),
  ]);
  // Newest branches first: 8.0 before 7.6, R82.10 before R82.
  const order = branch => String(branch).replace(/^R/i, '').split('.').map(part => part.padStart(4, '0')).join('.');
  res.json({
    products: products.map(product => ({ id: product.id, name: product.name, vendor: product.vendor, source: product.source, last_checked_at: product.last_checked_at, last_error: product.last_error,
      releases: releases.filter(release => release.product_id === product.id).sort((a, b) => order(b.branch).localeCompare(order(a.branch))) })),
    events, news, feeds: Number(feeds.n), last_sync: await sync.lastSync(),
  });
});

/* ── Managers ─────────────────────────────────────────────────────── */
let catalogueCache = null;
router.get('/admin/catalogue', requireManager, async (req, res) => {
  try {
    if (!catalogueCache || Date.now() - catalogueCache.at > 24 * 3600 * 1000) catalogueCache = { at: Date.now(), rows: await sources.endoflifeCatalogue() };
    res.json({ rows: catalogueCache.rows });
  } catch (error) { res.status(502).json({ error: error.message }); }
});

router.get('/admin', requireManager, async (req, res) => {
  const [products, feeds, manual] = await Promise.all([
    db.prepare('SELECT * FROM software_products ORDER BY display_order, name, id').all(),
    db.prepare('SELECT * FROM software_feeds ORDER BY name, id').all(),
    db.prepare("SELECT r.* FROM software_releases r JOIN software_products p ON p.id=r.product_id WHERE p.source='manual' ORDER BY r.branch").all(),
  ]);
  res.json({ products: products.map(product => ({ ...product, enabled: !!product.enabled, config: parse(product.config), releases: manual.filter(release => release.product_id === product.id) })),
    feeds: feeds.map(feed => ({ ...feed, enabled: !!feed.enabled })), sources: sync.SOURCES, last_sync: await sync.lastSync() });
});

function productInput(body) {
  if (!body || typeof body !== 'object') fail('Product details are required');
  const source = body.source;
  return {
    name: shortText(body.name, 'Name', 120, true), vendor: shortText(body.vendor, 'Vendor', 80), source,
    config: sync.validateConfig(source, body.config || {}),
    asset_vendor: shortText(body.asset_vendor, 'Asset vendor', 120), asset_model: shortText(body.asset_model, 'Asset model', 120),
    enabled: body.enabled !== false, display_order: Number.isSafeInteger(Number(body.display_order)) ? Number(body.display_order) : 0,
  };
}

router.post('/admin/products', requireManager, async (req, res) => {
  try {
    const p = productInput(req.body);
    const created = await db.prepare('INSERT INTO software_products (name, vendor, source, config, asset_vendor, asset_model, enabled, display_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(p.name, p.vendor, p.source, JSON.stringify(p.config), p.asset_vendor, p.asset_model, p.enabled ? 1 : 0, p.display_order);
    await logAudit(db, req, 'software_product', created.lastInsertRowid, p.name, 'software_product_created', `source=${p.source}`);
    // Read it straight away so the page fills in.
    const product = await db.prepare('SELECT * FROM software_products WHERE id=?').get(created.lastInsertRowid);
    const check = await sync.syncProduct(product).then(() => null, error => error.message);
    res.status(201).json({ id: created.lastInsertRowid, check_error: check });
  } catch (error) { send(res, error, 'Could not add the product'); }
});

router.put('/admin/products/:id', requireManager, async (req, res) => {
  try {
    const productId = id(req.params.id), p = productInput(req.body);
    const before = await db.prepare('SELECT * FROM software_products WHERE id=?').get(productId);
    if (!before) fail('Product not found', 404);
    await db.prepare('UPDATE software_products SET name=?, vendor=?, source=?, config=?, asset_vendor=?, asset_model=?, enabled=?, display_order=?, updated_at=app_now() WHERE id=?')
      .run(p.name, p.vendor, p.source, JSON.stringify(p.config), p.asset_vendor, p.asset_model, p.enabled ? 1 : 0, p.display_order, productId);
    // A different source means different branches.
    if (before.source !== p.source) await db.prepare('DELETE FROM software_releases WHERE product_id=?').run(productId);
    await logAudit(db, req, 'software_product', productId, p.name, 'software_product_updated', `source=${p.source}`);
    const check = p.enabled ? await sync.syncProduct(await db.prepare('SELECT * FROM software_products WHERE id=?').get(productId)).then(() => null, error => error.message) : null;
    res.json({ ok: true, check_error: check });
  } catch (error) { send(res, error, 'Could not save the product'); }
});

router.delete('/admin/products/:id', requireManager, async (req, res) => {
  try {
    const productId = id(req.params.id);
    const product = await db.prepare('SELECT name FROM software_products WHERE id=?').get(productId);
    if (!product) fail('Product not found', 404);
    await db.prepare('DELETE FROM software_products WHERE id=?').run(productId);
    await logAudit(db, req, 'software_product', productId, product.name, 'software_product_deleted', '');
    res.json({ ok: true });
  } catch (error) { send(res, error, 'Could not remove the product'); }
});

router.post('/admin/products/:id/check', requireManager, async (req, res) => {
  try {
    const product = await db.prepare('SELECT * FROM software_products WHERE id=?').get(id(req.params.id));
    if (!product) fail('Product not found', 404);
    const result = await sync.syncProduct(product);
    res.json({ releases: result.releases, new_versions: result.events.length });
  } catch (error) { res.status(error.status || 502).json({ error: error.message }); }
});

/* Versions entered by hand, for products without a source we can read. */
router.put('/admin/products/:id/releases', requireManager, async (req, res) => {
  try {
    const product = await db.prepare('SELECT * FROM software_products WHERE id=?').get(id(req.params.id));
    if (!product) fail('Product not found', 404);
    if (product.source !== 'manual') fail('Versions of this product are read from its source');
    const body = req.body || {};
    const release = {
      branch: shortText(body.branch, 'Version line', 40, true), latest_version: shortText(body.latest_version, 'Latest version', 80, true),
      latest_date: isoDate(body.latest_date, 'Release date'), recommended_version: shortText(body.recommended_version, 'Recommended version', 80),
      recommended_date: isoDate(body.recommended_date, 'Recommended since'), release_date: null, support_end: isoDate(body.support_end, 'Support ends'),
      eol: isoDate(body.eol, 'End of life'), maintained: 1, link: shortText(body.link, 'Link', 1000),
    };
    if (release.link && !/^https:\/\//i.test(release.link)) fail('The link must start with https://');
    const others = (await db.prepare('SELECT * FROM software_releases WHERE product_id=?').all(product.id)).filter(row => row.branch !== release.branch);
    await sync.storeReleases(product, [...others, release]);
    if (body.note !== undefined) await db.prepare('UPDATE software_releases SET note=? WHERE product_id=? AND branch=?').run(shortText(body.note, 'Note', 300), product.id, release.branch);
    await logAudit(db, req, 'software_product', product.id, product.name, 'software_version_entered', `${release.branch}: ${release.latest_version}`);
    res.json({ ok: true });
  } catch (error) { send(res, error, 'Could not save the version'); }
});
router.delete('/admin/products/:id/releases/:branch', requireManager, async (req, res) => {
  try {
    const product = await db.prepare("SELECT * FROM software_products WHERE id=? AND source='manual'").get(id(req.params.id));
    if (!product) fail('Product not found', 404);
    await db.prepare('DELETE FROM software_releases WHERE product_id=? AND branch=?').run(product.id, String(req.params.branch));
    await logAudit(db, req, 'software_product', product.id, product.name, 'software_version_deleted', String(req.params.branch).slice(0, 40));
    res.json({ ok: true });
  } catch (error) { send(res, error, 'Could not remove the version'); }
});

/* Feeds */
async function feedInput(body) {
  if (!body || typeof body !== 'object') fail('Feed details are required');
  const url = shortText(body.url, 'Address', 1000, true);
  try { await require('../security').assertPublicHttpUrl(url, { label: 'Feed address' }); } catch (error) { fail(error.message); }
  return { name: shortText(body.name, 'Name', 120, true), url, keywords: shortText(body.keywords, 'Keywords', 500) || '', enabled: body.enabled !== false };
}
router.post('/admin/feeds', requireManager, async (req, res) => {
  try {
    const f = await feedInput(req.body);
    const created = await db.prepare('INSERT INTO software_feeds (name, url, keywords, enabled) VALUES (?, ?, ?, ?)').run(f.name, f.url, f.keywords, f.enabled ? 1 : 0);
    await logAudit(db, req, 'software_feed', created.lastInsertRowid, f.name, 'software_feed_created', f.url);
    const feed = await db.prepare('SELECT * FROM software_feeds WHERE id=?').get(created.lastInsertRowid);
    const check = await sync.syncFeed(feed).then(result => ({ items: result.items }), error => ({ error: error.message }));
    res.status(201).json({ id: created.lastInsertRowid, ...check });
  } catch (error) { send(res, error, 'Could not add the feed'); }
});
router.put('/admin/feeds/:id', requireManager, async (req, res) => {
  try {
    const feedId = id(req.params.id), f = await feedInput(req.body);
    const result = await db.prepare('UPDATE software_feeds SET name=?, url=?, keywords=?, enabled=? WHERE id=?').run(f.name, f.url, f.keywords, f.enabled ? 1 : 0, feedId);
    if (!result.changes) fail('Feed not found', 404);
    await logAudit(db, req, 'software_feed', feedId, f.name, 'software_feed_updated', f.url);
    // New keywords: start over with what matches them.
    await db.prepare('DELETE FROM software_feed_items WHERE feed_id=?').run(feedId);
    const check = f.enabled ? await sync.syncFeed(await db.prepare('SELECT * FROM software_feeds WHERE id=?').get(feedId)).then(r => ({ items: r.items }), error => ({ error: error.message })) : {};
    res.json({ ok: true, ...check });
  } catch (error) { send(res, error, 'Could not save the feed'); }
});
router.delete('/admin/feeds/:id', requireManager, async (req, res) => {
  try {
    const feedId = id(req.params.id);
    const feed = await db.prepare('SELECT name FROM software_feeds WHERE id=?').get(feedId);
    if (!feed) fail('Feed not found', 404);
    await db.prepare('DELETE FROM software_feeds WHERE id=?').run(feedId);
    await logAudit(db, req, 'software_feed', feedId, feed.name, 'software_feed_deleted', '');
    res.json({ ok: true });
  } catch (error) { send(res, error, 'Could not remove the feed'); }
});

router.post('/admin/sync', requireManager, async (req, res) => {
  if (sync.isRunning()) return res.status(202).json({ running: true });
  sync.syncAll().catch(error => console.error('[software] versions:', error.message));
  res.status(202).json({ running: true });
});

module.exports = router;
