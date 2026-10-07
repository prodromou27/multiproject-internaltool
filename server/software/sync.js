/**
 * Keeps the Software versions portal current: reads each product from its
 * source, stores its release branches, and records an event whenever a
 * branch's latest or recommended version changes. Feeds are read and the
 * items matching their keywords kept. Runs every morning, and on request.
 */
const db = require('../db');
const appTime = require('../appTime');
const sources = require('./sources');

const SETTINGS_KEY = 'software_versions';
const SOURCES = ['endoflife', 'fortinet', 'checkpoint', 'manual'];
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
const parse = value => { try { return typeof value === 'string' ? JSON.parse(value || '{}') : value || {}; } catch { return {}; } };

/** Checks a product's source settings; returns them cleaned. */
function validateConfig(source, config = {}) {
  if (!SOURCES.includes(source)) fail('Unknown source');
  if (!config || typeof config !== 'object' || Array.isArray(config)) fail('Source settings must be an object');
  const slug = value => (typeof value === 'string' && /^[a-z0-9][a-z0-9.+-]{0,60}$/.test(value) ? value : null);
  if (source === 'endoflife') {
    if (!slug(config.slug)) fail('Choose the endoflife.date product');
    return { slug: config.slug, include_old: !!config.include_old };
  }
  if (source === 'fortinet') {
    if (!/^forti[a-z0-9-]{1,40}$/.test(config.product || '')) fail('The Fortinet product is its docs.fortinet.com name, e.g. fortigate, fortimanager');
    if (!/^[a-z0-9-]{1,60}$/.test(config.document || '')) fail('The release-notes document name is required, e.g. fortios-release-notes');
    const branches = Array.isArray(config.branches) ? [...new Set(config.branches.map(String))] : [];
    if (branches.some(branch => !/^\d{1,2}\.\d{1,2}$/.test(branch)) || branches.length > 12) fail('Branches look like 7.4, 7.6 (at most 12)');
    if (config.eol_slug && !slug(config.eol_slug)) fail('The endoflife.date product for dates is invalid');
    if (!branches.length && !config.eol_slug) fail('List the branches to follow, or an endoflife.date product to take them from');
    return { product: config.product, document: config.document, branches, ...(config.eol_slug ? { eol_slug: config.eol_slug } : {}) };
  }
  if (source === 'checkpoint') {
    const versions = Array.isArray(config.versions) ? [...new Set(config.versions.map(String))] : [];
    if (!versions.length || versions.length > 10 || versions.some(version => !/^R\d{2}(\.\d{1,2})?$/.test(version))) fail('Check Point versions look like R81.20, R82 (1 to 10)');
    return { versions };
  }
  return {};
}

async function readProduct(product, { fetchImpl, today } = {}) {
  const config = parse(product.config);
  if (product.source === 'endoflife') return sources.endoflife(config.slug, { fetchImpl, includeOld: config.include_old, today });
  if (product.source === 'fortinet') return sources.fortinet(config, { fetchImpl, today });
  if (product.source === 'checkpoint') return sources.checkpoint(config, { fetchImpl });
  return null; // manual: entered by hand
}

const FIELDS = ['latest_version', 'latest_date', 'recommended_version', 'recommended_date', 'release_date', 'support_end', 'eol', 'maintained', 'link'];

/** Stores what was read; records events for changed versions (not for the first reading). */
async function storeReleases(product, releases, store = db) {
  const existing = new Map((await store.prepare('SELECT * FROM software_releases WHERE product_id=?').all(product.id)).map(row => [row.branch, row]));
  const events = [];
  await store.transaction(async tx => {
    for (const release of releases) {
      const before = existing.get(release.branch);
      for (const [kind, field] of [['latest', 'latest_version'], ['recommended', 'recommended_version']])
        if (before?.[field] && release[field] && before[field] !== release[field]) events.push({ branch: release.branch, kind, version: release[field], previous: before[field] });
      const values = FIELDS.map(field => release[field] ?? null);
      await tx.prepare(`INSERT INTO software_releases (product_id, branch, ${FIELDS.join(', ')}, updated_at) VALUES (?, ?, ${FIELDS.map(() => '?').join(', ')}, app_now())
        ON CONFLICT (product_id, branch) DO UPDATE SET ${FIELDS.map(field => `${field}=EXCLUDED.${field}`).join(', ')}, updated_at=app_now()`).run(product.id, release.branch, ...values);
    }
    // Branches the source no longer lists are dropped.
    const seen = new Set(releases.map(release => release.branch));
    for (const branch of existing.keys()) if (!seen.has(branch)) await tx.prepare('DELETE FROM software_releases WHERE product_id=? AND branch=?').run(product.id, branch);
    for (const event of events) await tx.prepare('INSERT INTO software_release_events (product_id, branch, kind, version, previous) VALUES (?, ?, ?, ?, ?)').run(product.id, event.branch, event.kind, event.version, event.previous);
  });
  return events;
}

async function syncProduct(product, { fetchImpl, store = db, today = appTime.today() } = {}) {
  if (product.source === 'manual') return { releases: null, events: [] };
  try {
    const releases = await readProduct(product, { fetchImpl, today });
    const events = await storeReleases(product, releases, store);
    await store.prepare('UPDATE software_products SET last_checked_at=app_now(), last_error=NULL WHERE id=?').run(product.id);
    return { releases: releases.length, events };
  } catch (error) {
    await store.prepare('UPDATE software_products SET last_checked_at=app_now(), last_error=? WHERE id=?').run(String(error.message).slice(0, 500), product.id);
    throw error;
  }
}

async function syncFeed(feed, { fetchImpl, store = db } = {}) {
  try {
    const { assertPublicHttpUrl } = require('../security');
    await assertPublicHttpUrl(feed.url, { label: 'Feed address' });
    const items = sources.matchKeywords(await sources.feed(feed.url, { fetchImpl }), feed.keywords).slice(0, 100);
    for (const item of items)
      await store.prepare(`INSERT INTO software_feed_items (feed_id, guid, title, link, published_at, summary) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (feed_id, guid) DO UPDATE SET title=EXCLUDED.title, link=EXCLUDED.link, published_at=EXCLUDED.published_at, summary=EXCLUDED.summary`)
        .run(feed.id, item.guid, item.title, item.link, item.published_at, item.summary);
    // Keep the newest 200 per feed.
    const old = await store.prepare('SELECT id FROM software_feed_items WHERE feed_id=? ORDER BY COALESCE(published_at, fetched_at) DESC, id DESC LIMIT 1000 OFFSET 200').all(feed.id);
    for (const row of old) await store.prepare('DELETE FROM software_feed_items WHERE id=?').run(row.id);
    await store.prepare('UPDATE software_feeds SET last_checked_at=app_now(), last_error=NULL WHERE id=?').run(feed.id);
    return { items: items.length };
  } catch (error) {
    await store.prepare('UPDATE software_feeds SET last_checked_at=app_now(), last_error=? WHERE id=?').run(String(error.message).slice(0, 500), feed.id);
    throw error;
  }
}

let running = null;
/** Every enabled product and feed; one failure does not stop the rest. */
function syncAll(options = {}) {
  running ||= (async () => {
    const store = options.store || db;
    const result = { products: 0, failed: 0, events: 0, feeds: 0 };
    for (const product of await store.prepare('SELECT * FROM software_products WHERE enabled=1 ORDER BY display_order, id').all()) {
      try { const outcome = await syncProduct(product, options); if (outcome.releases !== null) result.products++; result.events += outcome.events.length; }
      catch { result.failed++; }
    }
    for (const feed of await store.prepare('SELECT * FROM software_feeds WHERE enabled=1').all()) {
      try { await syncFeed(feed, options); result.feeds++; } catch { result.failed++; }
    }
    await store.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value')
      .run(SETTINGS_KEY, JSON.stringify({ last_sync_at: new Date().toISOString(), last_result: result }));
    return result;
  })().finally(() => { running = null; });
  return running;
}

async function lastSync(store = db) {
  const row = await store.prepare('SELECT value FROM settings WHERE key=?').get(SETTINGS_KEY);
  const value = parse(row?.value);
  return { at: value.last_sync_at || null, result: value.last_result || null, running: !!running };
}

/** Every morning at 06:00 (organisation time), and soon after the first start. */
function startSchedule() {
  const run = () => syncAll().then(result => console.log('[software] versions:', JSON.stringify(result))).catch(error => console.error('[software] versions:', error.message));
  lastSync().then(last => { if (!last.at) setTimeout(run, 90 * 1000).unref?.(); }).catch(() => {});
  const next = () => { const now = new Date(), at = appTime.nextLocalTime(6, 0, now); setTimeout(() => { run(); next(); }, at - now).unref?.(); };
  next();
}

module.exports = { SOURCES, validateConfig, syncProduct, syncFeed, syncAll, storeReleases, lastSync, startSchedule, isRunning: () => !!running };
