/**
 * Where the Software versions portal reads versions from. Each reader returns
 * release branches: { branch, latest_version, latest_date, recommended_version,
 * recommended_date, release_date, support_end, eol, maintained, link }.
 *
 *  - endoflife.date: release branches with support and end-of-life dates, and
 *    for many products the latest patch (free public API).
 *  - Fortinet: the latest patch per branch. Asking docs.fortinet.com for a
 *    release-notes version that does not exist (e.g. 7.4.999) redirects to the
 *    newest one in that branch.
 *  - Check Point: the latest and the recommended Jumbo Hotfix take per version,
 *    from Check Point's public Jumbo documentation ("Take 170 Released on …
 *    and declared as Recommended on …").
 *  - RSS/Atom feeds: news items, filtered by keyword.
 */
const { DOMParser } = require('@xmldom/xmldom');

const ENDOFLIFE = 'https://endoflife.date/api/v1/products';
const FORTINET_DOCS = 'https://docs.fortinet.com/document';
const CHECKPOINT_JUMBO = 'https://sc1.checkpoint.com/documents/Jumbo_HFA';
const AGENT = 'TeamHub software-versions (+https://endoflife.date)';
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

async function request(url, { fetchImpl = global.fetch, accept = '*/*', redirect = 'follow', label, timeoutMs = 30000 } = {}) {
  // Vendor sites are sometimes slow: one more try after a timeout.
  for (let attempt = 1; ; attempt++) {
    try { return await fetchImpl(url, { headers: { Accept: accept, 'User-Agent': AGENT }, redirect, signal: AbortSignal.timeout(timeoutMs) }); }
    catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.cause?.name === 'TimeoutError';
      if (timedOut && attempt < 2) continue;
      if (timedOut) throw new Error(`${label} did not respond in time (${new URL(url).hostname}). It will be tried again at the next check.`);
      const code = error?.cause?.code || error?.code || error?.name;
      throw new Error(`${label} could not be reached (${code || 'network error'}). The server running TeamHub needs internet access to ${new URL(url).hostname}.`);
    }
  }
}
async function text(url, options) {
  const response = await request(url, options);
  if (!response.ok) throw new Error(`${options.label} returned HTTP ${response.status} for ${url}`);
  return response.text();
}
async function json(url, options) {
  const body = await text(url, { ...options, accept: 'application/json' });
  try { return JSON.parse(body); } catch { throw new Error(`${options.label} returned something that is not JSON`); }
}

/** "22 September 2026" / "3 Aug 2026" → "2026-09-22" (null if unreadable). */
function isoDay(value) {
  const match = String(value || '').match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/);
  if (!match || !MONTHS[match[2].toLowerCase()]) return null;
  return `${match[3]}-${String(MONTHS[match[2].toLowerCase()]).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}
const day = value => (value ? String(value).slice(0, 10) : null);

/* ── endoflife.date ─────────────────────────────────────────────────── */
async function endoflife(slug, { fetchImpl, includeOld = false, today = new Date().toISOString().slice(0, 10) } = {}) {
  const data = await json(`${ENDOFLIFE}/${encodeURIComponent(slug)}`, { fetchImpl, label: 'endoflife.date' });
  const releases = data?.result?.releases;
  if (!Array.isArray(releases)) throw new Error(`endoflife.date has no releases for "${slug}"`);
  // Supported branches, plus those that reached end of life in the last year.
  const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  return releases.filter(release => includeOld || release.isMaintained || !release.eolFrom || release.eolFrom >= yearAgo).map(release => ({
    branch: String(release.name), release_date: day(release.releaseDate),
    support_end: day(release.eoasFrom) || null, eol: day(release.eolFrom) || null, maintained: release.isMaintained ? 1 : 0,
    latest_version: release.latest?.name || null, latest_date: day(release.latest?.date), link: release.latest?.link || null,
  }));
}

/** The products endoflife.date covers, to choose from. */
async function endoflifeCatalogue({ fetchImpl } = {}) {
  const data = await json(ENDOFLIFE, { fetchImpl, label: 'endoflife.date' });
  return (data?.result || []).map(product => ({ slug: product.name, label: product.label || product.name, category: product.category || null }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/* ── Fortinet ───────────────────────────────────────────────────────── */
async function fortinetLatest(product, document, branch, { fetchImpl } = {}) {
  const url = `${FORTINET_DOCS}/${product}/${branch}.999/${document}`;
  const response = await request(url, { fetchImpl, redirect: 'manual', label: 'Fortinet documentation' });
  const location = response.headers.get('location') || '';
  const found = location.match(new RegExp(`/document/${product}/(\\d+\\.\\d+\\.\\d+)/`));
  // A branch that does not exist redirects to the newest release overall: not this branch.
  if (!found || !found[1].startsWith(`${branch}.`)) return null;
  return { version: found[1], link: `${FORTINET_DOCS}/${product}/${found[1]}/${document}` };
}

async function fortinet(config, { fetchImpl, today } = {}) {
  const dates = config.eol_slug ? await endoflife(config.eol_slug, { fetchImpl, today }) : [];
  const branches = config.branches?.length ? config.branches : dates.filter(release => release.maintained).map(release => release.branch);
  if (!branches.length) throw new Error('Choose the branches to follow (e.g. 7.4, 7.6), or an endoflife.date product for them');
  const out = [];
  for (const branch of branches) {
    const latest = await fortinetLatest(config.product, config.document, branch, { fetchImpl });
    const known = dates.find(release => release.branch === branch) || {};
    out.push({ ...known, branch, latest_version: latest?.version || known.latest_version || null, latest_date: known.latest_version === latest?.version ? known.latest_date || null : null, link: latest?.link || known.link || null });
  }
  return out;
}

/* ── Check Point ────────────────────────────────────────────────────── */
function checkpointTakes(html) {
  const plain = String(html).replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ');
  return [...plain.matchAll(/Take (\d{1,4}) Released on (\d{1,2} [A-Za-z]+\.? \d{4})( and declared as Recommended on (\d{1,2} [A-Za-z]+\.? \d{4}))?/gi)]
    .map(match => ({ take: Number(match[1]), released: isoDay(match[2]), recommended: match[4] ? isoDay(match[4]) : null }));
}

async function checkpoint(config, { fetchImpl } = {}) {
  const out = [];
  for (const version of config.versions || []) {
    // Each version's Jumbo documentation names its own start page.
    const help = await text(`${CHECKPOINT_JUMBO}/${version}/Data/HelpSystem.xml`, { fetchImpl, label: 'Check Point documentation' });
    const start = help.match(/DefaultUrl="([^"]+)"/)?.[1];
    if (!start || /^[a-z]+:|\.\./i.test(start)) throw new Error(`Check Point has no Jumbo Hotfix documentation for ${version}`);
    const link = `${CHECKPOINT_JUMBO}/${version}/${start}`;
    const takes = checkpointTakes(await text(link, { fetchImpl, label: 'Check Point documentation' }));
    if (!takes.length) throw new Error(`No Jumbo Hotfix takes were found for ${version}; Check Point may have changed its documentation`);
    const latest = takes.reduce((best, take) => (take.take > best.take ? take : best));
    const recommended = takes.filter(take => take.recommended).reduce((best, take) => (!best || take.take > best.take ? take : best), null);
    out.push({ branch: version, latest_version: `Take ${latest.take}`, latest_date: latest.released,
      recommended_version: recommended ? `Take ${recommended.take}` : null, recommended_date: recommended?.recommended || null, maintained: 1, link });
  }
  return out;
}

/* ── RSS / Atom ─────────────────────────────────────────────────────── */
const clean = value => String(value || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

function parseFeed(xml) {
  const doc = new DOMParser({ onError: () => {} }).parseFromString(String(xml), 'text/xml');
  const first = (node, name) => node.getElementsByTagName(name)[0];
  const textOf = (node, name) => first(node, name)?.textContent || '';
  const items = [...Array.from(doc.getElementsByTagName('item')), ...Array.from(doc.getElementsByTagName('entry'))];
  return items.map(item => {
    const atomLink = Array.from(item.getElementsByTagName('link')).find(link => link.getAttribute('href') && (!link.getAttribute('rel') || link.getAttribute('rel') === 'alternate'));
    const link = atomLink?.getAttribute('href') || textOf(item, 'link').trim() || null;
    const date = textOf(item, 'pubDate') || textOf(item, 'published') || textOf(item, 'updated') || textOf(item, 'dc:date');
    const parsed = date ? new Date(date) : null;
    return {
      guid: (textOf(item, 'guid') || textOf(item, 'id') || link || textOf(item, 'title')).trim().slice(0, 500),
      title: clean(textOf(item, 'title')).slice(0, 300),
      link: link && /^https?:\/\//i.test(link) ? link.slice(0, 1000) : null,
      published_at: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null,
      summary: clean(textOf(item, 'description') || textOf(item, 'summary') || textOf(item, 'content')).slice(0, 500),
    };
  }).filter(item => item.guid && item.title);
}

/** Items whose title or summary has any of the keywords (all items without keywords). */
function matchKeywords(items, keywords) {
  const words = String(keywords || '').split(',').map(word => word.trim().toLowerCase()).filter(Boolean);
  if (!words.length) return items;
  return items.filter(item => words.some(word => `${item.title} ${item.summary}`.toLowerCase().includes(word)));
}

async function feed(url, { fetchImpl } = {}) {
  return parseFeed(await text(url, { fetchImpl, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5', label: 'The feed' }));
}

module.exports = { endoflife, endoflifeCatalogue, fortinet, fortinetLatest, checkpoint, checkpointTakes, parseFeed, matchKeywords, feed, isoDay };
