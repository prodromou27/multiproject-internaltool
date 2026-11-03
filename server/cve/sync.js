/**
 * Downloads CVEs for the watched vendors/products from NVD (API 2.0) and CISA's
 * Known Exploited Vulnerabilities catalogue, into cves / cve_kev.
 *
 * NVD allows 5 requests per 30 seconds without an API key and 50 with one
 * (Settings → Vulnerabilities), so requests are spaced out. The first sync of a
 * watch fetches all its CVEs; later ones only what changed since (NVD allows a
 * 120-day "changed since" window, so an older sync starts over).
 */
const db = require('../db');
const appTime = require('../appTime');
const { decrypt, encrypt } = require('../fieldCipher');
const { cpeVendorFor, vulnerableEntries, cvssOf } = require('./match');

const NVD_URL = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
const PAGE_SIZE = 2000;
// A vendor with more CVEs than this (Microsoft, Cisco…) is too broad to watch as a whole.
const MAX_VENDOR_CVES = 4000;
const SETTINGS_KEY = 'vulnerabilities';

async function settings(store = db) {
  const row = await store.prepare('SELECT value FROM settings WHERE key = ?').get(SETTINGS_KEY);
  try { return JSON.parse(row?.value || '{}'); } catch { return {}; }
}
async function saveSettings(value, store = db) {
  await store.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value').run(SETTINGS_KEY, JSON.stringify(value));
}
const apiKeyOf = stored => (stored.nvd_api_key ? decrypt(stored.nvd_api_key) || '' : '');

/** Read from NVD or CISA, with a plain-language error when it fails. */
async function getJson(url, { fetchImpl = global.fetch, headers = {}, timeoutMs = 60000, label } = {}) {
  let response;
  try { response = await fetchImpl(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeoutMs) }); }
  catch (error) {
    const code = error?.cause?.code || error?.code || error?.name;
    throw new Error(`${label} could not be reached (${code || 'network error'}). The server running this app needs internet access to ${new URL(url).hostname}.`);
  }
  if (response.status === 403 || response.status === 429) throw Object.assign(new Error(`${label} is limiting requests (HTTP ${response.status}). Add an NVD API key, or try again later.`), { retryable: true });
  if (response.status === 404 && label === 'NVD') throw new Error('NVD did not recognise that vendor or product name.');
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  try { return await response.json(); } catch { throw new Error(`${label} returned something that is not JSON`); }
}

/** One NVD CVE as we store it, or null for rejected ones. */
function cveRecord(item) {
  const cve = item?.cve;
  if (!cve?.id || /^rejected$/i.test(cve.vulnStatus || '')) return null;
  const cvss = cvssOf(cve.metrics);
  const entries = vulnerableEntries(cve.configurations);
  const products = [...new Set(entries.map(entry => `${entry.vendor}:${entry.product}`))];
  return {
    id: cve.id, published: cve.published || null, last_modified: cve.lastModified || null,
    description: (cve.descriptions || []).find(text => text.lang === 'en')?.value || (cve.descriptions || [])[0]?.value || '',
    cvss_score: cvss.score, severity: cvss.severity, cvss_vector: cvss.vector, cvss_version: cvss.version,
    refs: JSON.stringify((cve.references || []).slice(0, 20).map(ref => ({ url: ref.url, tags: (ref.tags || []).slice(0, 4) }))),
    entries: JSON.stringify(entries),
    // Space-padded so " vendor:product " and " vendor:" searches are exact.
    products: products.length ? ` ${products.join(' ')} ` : '',
  };
}

async function saveCves(records, store) {
  for (const record of records) {
    await store.prepare(`INSERT INTO cves (id, published, last_modified, description, cvss_score, severity, cvss_vector, cvss_version, refs, entries, products, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, app_now())
      ON CONFLICT (id) DO UPDATE SET published = EXCLUDED.published, last_modified = EXCLUDED.last_modified, description = EXCLUDED.description,
        cvss_score = EXCLUDED.cvss_score, severity = EXCLUDED.severity, cvss_vector = EXCLUDED.cvss_vector, cvss_version = EXCLUDED.cvss_version,
        refs = EXCLUDED.refs, entries = EXCLUDED.entries, products = EXCLUDED.products, fetched_at = EXCLUDED.fetched_at`)
      .run(record.id, record.published, record.last_modified, record.description, record.cvss_score, record.severity, record.cvss_vector, record.cvss_version, record.refs, record.entries, record.products);
  }
}

const nvdDate = date => date.toISOString().replace('Z', '+00:00');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Fetches one watch's CVEs. Returns { fetched, total } or { tooBroad: total }. */
async function syncWatch(watch, { store = db, fetchImpl, apiKey = '', sleep = wait, now = new Date() } = {}) {
  const match = `cpe:2.3:*:${watch.cpe_vendor}:${watch.cpe_product || '*'}`;
  const last = watch.last_sync_at ? new Date(watch.last_sync_at) : null;
  const incremental = last && !Number.isNaN(last.getTime()) && now - last < 110 * 86400000;
  const pause = apiKey ? 700 : 6500;
  let start = 0, fetched = 0, total = null;
  for (let request = 0; request < 50; request++) {
    const params = new URLSearchParams({ virtualMatchString: match, resultsPerPage: String(PAGE_SIZE), startIndex: String(start) });
    if (incremental) { params.set('lastModStartDate', nvdDate(new Date(last.getTime() - 3600000))); params.set('lastModEndDate', nvdDate(now)); }
    let page;
    try { page = await getJson(`${NVD_URL}?${params}`, { fetchImpl, headers: apiKey ? { apiKey } : {}, label: 'NVD' }); }
    catch (error) { if (!error.retryable || request > 0) throw error; await sleep(31000); page = await getJson(`${NVD_URL}?${params}`, { fetchImpl, headers: apiKey ? { apiKey } : {}, label: 'NVD' }); }
    total = Number(page.totalResults || 0);
    if (!incremental && !watch.cpe_product && total > MAX_VENDOR_CVES) return { tooBroad: total };
    // A CVE NVD has not analysed yet lists no products; file it under what it was fetched for.
    const records = (page.vulnerabilities || []).map(cveRecord).filter(Boolean)
      .map(record => (record.products ? record : { ...record, products: ` ${watch.cpe_vendor}:${watch.cpe_product || '*'} ` }));
    await store.transaction(tx => saveCves(records, tx));
    fetched += records.length;
    start += Number(page.resultsPerPage || PAGE_SIZE);
    if (start >= total || !(page.vulnerabilities || []).length) break;
    await sleep(pause);
  }
  return { fetched, total };
}

/** Replaces the Known Exploited Vulnerabilities list with CISA's current one. */
async function syncKev({ store = db, fetchImpl } = {}) {
  const data = await getJson(KEV_URL, { fetchImpl, label: 'CISA' });
  const rows = (data.vulnerabilities || []).filter(row => /^CVE-\d{4}-\d+$/.test(row.cveID || ''));
  if (!rows.length) throw new Error('CISA returned an empty Known Exploited Vulnerabilities list');
  await store.transaction(async tx => {
    await tx.prepare('DELETE FROM cve_kev').run();
    for (const row of rows) await tx.prepare('INSERT INTO cve_kev (cve_id, name, date_added, due_date, required_action, ransomware) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (cve_id) DO NOTHING')
      .run(row.cveID, String(row.vulnerabilityName || '').slice(0, 500), row.dateAdded || null, row.dueDate || null, String(row.requiredAction || '').slice(0, 2000), row.knownRansomwareCampaignUse || null);
  });
  return rows.length;
}

/** The vendors on customers' assets become watched automatically (unless someone already watches that NVD vendor). */
async function refreshAssetWatch(store = db) {
  const rows = await store.prepare("SELECT DISTINCT vendor FROM customer_assets WHERE vendor IS NOT NULL AND lifecycle_status IN ('active','spare')").all();
  const vendors = new Map();
  for (const row of rows) {
    const name = String(decrypt(row.vendor) || '').trim();
    const cpe = cpeVendorFor(name);
    if (cpe && !vendors.has(cpe)) vendors.set(cpe, name);
  }
  // Admins can point an asset vendor at a different NVD name; those rows keep their choice.
  const existing = await store.prepare('SELECT cpe_vendor, asset_vendor FROM cve_watch').all();
  const covered = new Set([...existing.map(row => row.cpe_vendor), ...existing.filter(row => row.asset_vendor).map(row => cpeVendorFor(row.asset_vendor))]);
  let added = 0;
  for (const [cpe, name] of vendors) {
    if (covered.has(cpe)) continue;
    const result = await store.prepare("INSERT INTO cve_watch (cpe_vendor, cpe_product, label, source, asset_vendor) VALUES (?, '', ?, 'asset', ?) ON CONFLICT (cpe_vendor, cpe_product) DO NOTHING").run(cpe, name, name);
    added += result.changes || 0;
  }
  return added;
}

let running = null;
/** Brings everything up to date. Only one runs at a time; a second call waits for it. */
function syncAll(options = {}) {
  if (running) return running;
  running = (async () => {
    const store = options.store || db, fetchImpl = options.fetchImpl, startedAt = options.now || new Date();
    const stored = await settings(store);
    const apiKey = apiKeyOf(stored);
    const result = { watches: 0, fetched: 0, errors: 0, kev: null };
    await saveSettings({ ...stored, sync_running_since: startedAt.toISOString() }, store);
    try {
      await refreshAssetWatch(store);
      const watches = await store.prepare('SELECT * FROM cve_watch WHERE hidden = 0 ORDER BY id').all();
      for (const watch of watches) {
        try {
          const outcome = await syncWatch(watch, { store, fetchImpl, apiKey, sleep: options.sleep, now: startedAt });
          if (outcome.tooBroad) {
            await store.prepare("UPDATE cve_watch SET last_status = 'too_broad', last_error = ?, total = ? WHERE id = ?")
              .run(`NVD lists ${outcome.tooBroad} CVEs for all of ${watch.cpe_vendor}. Watch specific products instead (for example ${watch.cpe_vendor}:product).`, outcome.tooBroad, watch.id);
            continue;
          }
          const pattern = watch.cpe_product ? `% ${watch.cpe_vendor}:${watch.cpe_product} %` : `% ${watch.cpe_vendor}:%`;
          const count = await store.prepare('SELECT COUNT(*) AS n FROM cves WHERE products ILIKE ?').get(pattern);
          await store.prepare("UPDATE cve_watch SET last_status = 'ok', last_error = NULL, last_sync_at = ?, total = ? WHERE id = ?").run(startedAt.toISOString(), Number(count.n), watch.id);
          result.watches++; result.fetched += outcome.fetched;
        } catch (error) {
          result.errors++;
          await store.prepare("UPDATE cve_watch SET last_status = 'error', last_error = ? WHERE id = ?").run(String(error.message).slice(0, 500), watch.id);
        }
        if (watch !== watches.at(-1)) await (options.sleep || wait)(apiKey ? 700 : 6500); // NVD's rate limit
      }
      try { result.kev = await syncKev({ store, fetchImpl }); }
      catch (error) { result.errors++; result.kev_error = error.message; }
    } finally {
      const latest = await settings(store);
      delete latest.sync_running_since;
      await saveSettings({ ...latest, last_sync_at: startedAt.toISOString(), last_sync_result: result }, store);
    }
    require('../liveUpdates').emitChange('vulnerabilities');
    return result;
  })().finally(() => { running = null; });
  return running;
}

/** Daily at 05:30 in the organisation's time zone; the first sync a minute after start-up if there has never been one. */
function startCveSchedule() {
  const run = () => syncAll().then(result => console.log('[vulnerabilities] sync:', JSON.stringify(result))).catch(error => console.error('[vulnerabilities] sync:', error.message));
  settings().then(stored => { if (!stored.last_sync_at) setTimeout(run, 60 * 1000).unref?.(); }).catch(() => {});
  const scheduleNext = () => {
    const now = new Date(), next = appTime.nextLocalTime(5, 30, now);
    setTimeout(() => { run(); scheduleNext(); }, next - now).unref?.();
  };
  scheduleNext();
}

module.exports = { NVD_URL, KEV_URL, MAX_VENDOR_CVES, SETTINGS_KEY, settings, saveSettings, apiKeyOf, encryptKey: encrypt, cveRecord, syncWatch, syncKev, refreshAssetWatch, syncAll, startCveSchedule, isRunning: () => !!running };
