/**
 * Two customer report sections built from data the app already holds:
 *
 *   Technology lifecycle  devices and firmware, licences and certificates, and
 *                         contracts that have expired or end within 12 months
 *                         of the report period's end, grouped by kind.
 *   Security advisories   the same list for every customer: CVEs scoring above 9
 *                         for the products flagged in Settings → Vulnerabilities,
 *                         published or added to CISA's exploited list in the period.
 */
const db = require('./db');
const appTime = require('./appTime');
const reportData = require('./managedReportData');
const softwareCompliance = require('./softwareCompliance');
const { licencesFor } = require('./customerLicences');
const { contractsFor } = require('./customerContracts');

const LIFECYCLE_MONTHS = 12;
const SOON_DAYS = 90;
const KIND_LABELS = { licence: 'Licence', subscription: 'Subscription', certificate: 'Certificate' };
const GROUPS = [['devices', 'Devices and firmware'], ['licences', 'Licences, subscriptions and certificates'], ['contracts', 'Contracts']];

const addMonths = (iso, months) => { const value = new Date(`${iso}T00:00:00Z`); value.setUTCMonth(value.getUTCMonth() + months); return value.toISOString().slice(0, 10); };
// The day of a stored date ('2027-01-15 00:00:00' reads as 2027-01-15); null when it is not a
// real date (including days that do not exist, like 2027-02-30).
function dayOf(value) {
  const day = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const parsed = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : null;
}

/** The lifecycle section for one customer, measured from `asOf` (the report period's end). */
async function getLifecycle(customerId, asOf, store = db) {
  const soon = appTime.addDays(asOf, SOON_DAYS), horizon = addMonths(asOf, LIFECYCLE_MONTHS), stale = addMonths(asOf, -LIFECYCLE_MONTHS);
  const statusOf = day => (day < asOf ? 'Expired' : day <= soon ? 'Within 90 days' : day <= horizon ? 'Within 12 months' : null);
  const rows = { devices: [], licences: [], contracts: [] };
  // `oldest` drops items that ended long ago (licences and contracts); devices in use stay listed.
  const add = (group, item, type, value, oldest = null) => {
    const ends = dayOf(value);
    if (!ends || (oldest && ends < oldest)) return;
    const status = statusOf(ends);
    if (status) rows[group].push({ item, type, ends, status });
  };

  const [assets, software, licences, contracts, renewals] = await Promise.all([
    reportData.getAssets(customerId, asOf, store),
    softwareCompliance.assetSoftwareStatus({ customerId, store, today: asOf }),
    licencesFor([customerId], store, asOf),
    contractsFor([customerId], store, asOf),
    store.prepare('SELECT renewed_from_id, created_at FROM customer_contracts WHERE customer_id = ? AND renewed_from_id IS NOT NULL').all(customerId),
  ]);
  // A contract counts as renewed only if the renewal existed by the period's end, so a past period reads the same later.
  const renewedBy = new Set(renewals.filter(row => String(row.created_at || '').slice(0, 10) <= asOf).map(row => Number(row.renewed_from_id)));
  for (const asset of assets) {
    const maker = [asset.vendor, asset.model].filter(Boolean).join(' ');
    const name = maker ? `${asset.name} (${maker})` : asset.name;
    add('devices', name, 'Support', asset.support_end);
    add('devices', name, 'Warranty', asset.warranty_end);
  }
  if (software.assets.length) {
    const products = await softwareCompliance.loadProducts(store);
    for (const entry of software.assets) {
      const release = products.find(p => Number(p.id) === entry.product_id)?.releases.find(r => r.branch === entry.line);
      if (release) add('devices', `${entry.product_name} ${entry.line} on ${entry.name}`, 'Firmware', release.eol || release.support_end);
    }
  }
  for (const row of licences) add('licences', row.name, KIND_LABELS[row.kind] || 'Licence', row.expires_on, stale);
  for (const row of contracts) if (!renewedBy.has(Number(row.id))) add('contracts', row.description || 'Contract', 'Contract', row.end_date, stale);

  const groups = GROUPS.filter(([key]) => rows[key].length)
    .map(([key, title]) => ({ key, title, rows: rows[key].sort((a, b) => a.ends.localeCompare(b.ends)) }));
  const total = groups.reduce((sum, group) => sum + group.rows.length, 0);
  const summary = !total ? '' : total === 1 ? '1 item has expired or ends within the next 12 months.' : `${total} items have expired or end within the next 12 months.`;
  return { total, summary, groups };
}

const ADVISORY_MIN_SCORE = 9; // strictly above
const ADVISORY_LIMIT = 10;
const ADVISORY_PER_PRODUCT = 3;
const ADVISORY_NOTICE = 'General information about significant vulnerabilities published in this period. This list is not an assessment of your environment.';
const placeholders = list => list.map(() => '?').join(',');
const titleCase = text => String(text || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

/** The security advisories for a period: the same for every customer. */
async function getAdvisories(from, to, store = db) {
  const watched = await store.prepare('SELECT id, cpe_vendor, cpe_product, label FROM cve_watch WHERE in_advisories = 1 AND hidden = 0 ORDER BY id').all();
  if (!watched.length) return { total: 0, more: '', rows: [] };
  // CVEs published in the period, and those CISA added to its exploited list in the period.
  const addedInPeriod = (await store.prepare('SELECT cve_id FROM cve_kev WHERE date_added >= ? AND date_added <= ?').all(from, to)).map(row => row.cve_id);
  const candidates = await store.prepare(`SELECT id, published, description, cvss_score, severity, products FROM cves
    WHERE cvss_score > ? AND ((published >= ? AND published < ?)${addedInPeriod.length ? ` OR id IN (${placeholders(addedInPeriod)})` : ''})`)
    .all(ADVISORY_MIN_SCORE, from, appTime.addDays(to, 1), ...addedInPeriod);
  const kev = new Map();
  for (let start = 0; start < candidates.length; start += 500) {
    const ids = candidates.slice(start, start + 500).map(row => row.id);
    // Exploited as of the period's end: a later CISA listing does not change a past period.
    for (const row of await store.prepare(`SELECT cve_id, date_added, short_description FROM cve_kev WHERE cve_id IN (${placeholders(ids)})`).all(...ids))
      if (String(row.date_added || '') <= to) kev.set(row.cve_id, row);
  }

  // Each CVE counts once, under the first flagged product it names that still has room.
  const nameOf = watch => watch.label || watch.cpe_product || watch.cpe_vendor;
  const productsOf = cve => [...new Set(watched.filter(w => String(cve.products || '').includes(w.cpe_product ? ` ${w.cpe_vendor}:${w.cpe_product} ` : ` ${w.cpe_vendor}:`)).map(nameOf))];
  const listed = candidates.map(cve => ({ cve, products: productsOf(cve), kev: kev.get(cve.id) })).filter(entry => entry.products.length);
  listed.sort((a, b) => (!!b.kev - !!a.kev)
    || String(b.kev?.date_added || '').localeCompare(String(a.kev?.date_added || ''))
    || Number(b.cve.cvss_score) - Number(a.cve.cvss_score)
    || String(b.cve.published || '').localeCompare(String(a.cve.published || ''))
    || String(a.cve.id).localeCompare(String(b.cve.id)));
  const perProduct = new Map(), chosen = [];
  for (const entry of listed) {
    const name = entry.products.find(product => (perProduct.get(product) || 0) < ADVISORY_PER_PRODUCT);
    if (!name) continue;
    perProduct.set(name, (perProduct.get(name) || 0) + 1);
    chosen.push({ cve: entry.cve.id, product: name, severity: `${titleCase(entry.cve.severity || 'critical')} ${Number(entry.cve.cvss_score)}`,
      exploited: !!entry.kev, description: entry.kev?.short_description || entry.cve.description || '' });
    if (chosen.length === ADVISORY_LIMIT) break;
  }
  const more = listed.length > chosen.length ? `Showing the ${chosen.length} most significant of ${listed.length}.` : '';
  return { total: listed.length, more, rows: chosen };
}

module.exports = { LIFECYCLE_MONTHS, ADVISORY_MIN_SCORE, ADVISORY_LIMIT, ADVISORY_PER_PRODUCT, ADVISORY_NOTICE, getLifecycle, getAdvisories };
