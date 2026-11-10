/**
 * Which of our assets run a version a CVE affects.
 *
 * NVD lists the affected products of a CVE as CPE match entries: a vendor and
 * product, and either one exact version or a range (versionStartIncluding,
 * versionEndExcluding and so on). An asset is matched through the product
 * a manager mapped its vendor and model to (cve_asset_products), and its
 * software_version is compared with each entry.
 */

/** Lower-case words, for matching names typed in different ways ("Fortinet", "fortinet "). */
const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// NVD's vendor names for common vendors whose plain name differs.
const VENDOR_ALIASES = Object.freeze({
  'palo alto networks': 'paloaltonetworks', 'palo alto': 'paloaltonetworks', 'hewlett packard enterprise': 'hpe', 'hpe aruba': 'arubanetworks',
  'aruba': 'arubanetworks', 'aruba networks': 'arubanetworks', 'check point': 'checkpoint', 'check point software': 'checkpoint',
  'juniper networks': 'juniper', 'vmware by broadcom': 'vmware', 'sonic wall': 'sonicwall', 'f5 networks': 'f5', 'ubiquiti networks': 'ui', 'ubiquiti': 'ui',
  'trend micro': 'trendmicro', 'western digital': 'westerndigital', 'schneider electric': 'schneider-electric', 'red hat': 'redhat', 'mikro tik': 'mikrotik',
  'microsoft corporation': 'microsoft', 'cisco systems': 'cisco', 'dell technologies': 'dell', 'dell emc': 'dell', 'veeam software': 'veeam', 'zyxel communications': 'zyxel',
});
/** NVD's name for a vendor as typed on an asset ("Palo Alto Networks" -> "paloaltonetworks"). */
function cpeVendorFor(assetVendor) {
  const name = normalize(assetVendor);
  if (!name) return '';
  return VENDOR_ALIASES[name] || name.replace(/ /g, '_');
}

/** Version parts: numbers compare as numbers, words as text ("7.2.10" > "7.2.9"). */
function versionParts(value) {
  return String(value || '').toLowerCase().replace(/^v(?=\d)/, '').split(/[^0-9a-z]+|(?<=\d)(?=[a-z])|(?<=[a-z])(?=\d)/).filter(Boolean).map(part => (/^\d+$/.test(part) ? Number(part) : part));
}
// Words that mark a version before its release (7.2.0-beta < 7.2.0). Any other
// trailing word is a later build or hotfix (17.9.4a, 10.1.6-h3 > the plain version).
const PRE_RELEASE = /^(alpha|beta|rc|pre|preview|dev|snapshot|b|a)$/;
function compareVersions(a, b) {
  const x = versionParts(a), y = versionParts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    let p = x[i], q = y[i];
    if (p === q) continue;
    if (p === undefined || q === undefined) {
      const extra = p === undefined ? q : p, sign = p === undefined ? -1 : 1;
      if (typeof extra === 'number') { if (extra === 0) continue; return sign; }
      // "a"/"b" right after a number are letter releases (17.9.4a), not alpha/beta.
      const preRelease = PRE_RELEASE.test(extra) && !(/^[ab]$/.test(extra) && typeof (x[i - 1] ?? y[i - 1]) === 'number');
      return preRelease ? -sign : sign;
    }
    if (typeof p === 'number' && typeof q === 'number') return p < q ? -1 : 1;
    if (typeof p === 'number') return 1;
    if (typeof q === 'number') return -1;
    return p < q ? -1 : 1;
  }
  return 0;
}

/** cpe:2.3:o:fortinet:fortios:7.2.5:*:... -> { vendor, product, version } (CPE escapes removed). */
function parseCpe(criteria) {
  const parts = String(criteria || '').split(/(?<!\\):/);
  if (parts[0] !== 'cpe' || parts[1] !== '2.3' || parts.length < 6) return null;
  const clean = value => value.replace(/\\(.)/g, '$1');
  return { vendor: clean(parts[3]), product: clean(parts[4]), version: clean(parts[5]) };
}

/** The vulnerable product entries of an NVD CVE, compacted: [{ vendor, product, version, si, se, ei, ee }]. */
function vulnerableEntries(configurations) {
  const out = [];
  for (const configuration of configurations || []) for (const node of configuration.nodes || []) {
    if (node.negate) continue;
    for (const match of node.cpeMatch || []) {
      if (!match.vulnerable) continue;
      const cpe = parseCpe(match.criteria);
      if (!cpe) continue;
      const entry = { vendor: cpe.vendor, product: cpe.product, version: cpe.version };
      if (match.versionStartIncluding) entry.si = match.versionStartIncluding;
      if (match.versionStartExcluding) entry.se = match.versionStartExcluding;
      if (match.versionEndIncluding) entry.ei = match.versionEndIncluding;
      if (match.versionEndExcluding) entry.ee = match.versionEndExcluding;
      out.push(entry);
    }
  }
  return out;
}

/**
 * Whether `version` is affected by one entry: 'yes', 'no', or 'unknown' (the
 * entry names no versions, so every version may be affected — shown as "check").
 */
function entryAffects(entry, version) {
  if (!version) return 'unknown';
  const ranged = entry.si || entry.se || entry.ei || entry.ee;
  if (!ranged) {
    if (entry.version === '*' || entry.version === '-' || !entry.version) return 'unknown';
    return compareVersions(version, entry.version) === 0 ? 'yes' : 'no';
  }
  if (entry.si && compareVersions(version, entry.si) < 0) return 'no';
  if (entry.se && compareVersions(version, entry.se) <= 0) return 'no';
  if (entry.ei && compareVersions(version, entry.ei) > 0) return 'no';
  if (entry.ee && compareVersions(version, entry.ee) >= 0) return 'no';
  return 'yes';
}

/** The verdict for a product version across a CVE's entries for that product. */
function affects(entries, vendor, product, version) {
  let verdict = null;
  for (const entry of entries) {
    if (entry.vendor !== vendor || entry.product !== product) continue;
    const result = entryAffects(entry, version);
    if (result === 'yes') return 'yes';
    if (result === 'unknown') verdict = 'unknown';
    else verdict ||= 'no';
  }
  return verdict; // null: the CVE is not about this product
}

/** The CVSS score and severity NVD gives, preferring v4, then 3.1, 3.0 and 2. */
function cvssOf(metrics = {}) {
  for (const key of ['cvssMetricV40', 'cvssMetricV31', 'cvssMetricV30', 'cvssMetricV2']) {
    const metric = (metrics[key] || []).find(item => item.type === 'Primary') || (metrics[key] || [])[0];
    if (!metric) continue;
    const data = metric.cvssData || {};
    const severity = String(data.baseSeverity || metric.baseSeverity || '').toLowerCase() || null;
    return { score: Number.isFinite(Number(data.baseScore)) ? Number(data.baseScore) : null, severity, vector: data.vectorString || null, version: data.version || key.replace('cvssMetricV', '') };
  }
  return { score: null, severity: null, vector: null, version: null };
}

module.exports = { normalize, cpeVendorFor, versionParts, compareVersions, parseCpe, vulnerableEntries, entryAffects, affects, cvssOf };
