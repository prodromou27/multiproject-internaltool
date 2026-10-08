const test = require('node:test');
const assert = require('node:assert/strict');
const sources = require('../software/sources');
const { validateConfig } = require('../software/sync');

// A fake internet: URL → { status, body, location }.
const fakeFetch = pages => async url => {
  const page = pages[String(url)];
  if (!page) return new Response('not found', { status: 404 });
  return new Response(page.body ?? '', { status: page.status || 200, headers: page.location ? { location: page.location } : {} });
};

test('Fortinet: asking for a release that does not exist finds the newest in the branch', async () => {
  const fetchImpl = fakeFetch({
    'https://docs.fortinet.com/document/fortigate/7.4.999/fortios-release-notes': { status: 302, location: 'https://docs.fortinet.com/document/fortigate/7.4.12/fortios-release-notes' },
    'https://docs.fortinet.com/document/fortigate/9.9.999/fortios-release-notes': { status: 302, location: 'https://docs.fortinet.com/document/fortigate/8.0.1/fortios-release-notes' },
  });
  assert.deepEqual(await sources.fortinetLatest('fortigate', 'fortios-release-notes', '7.4', { fetchImpl }),
    { version: '7.4.12', link: 'https://docs.fortinet.com/document/fortigate/7.4.12/fortios-release-notes' });
  assert.equal(await sources.fortinetLatest('fortigate', 'fortios-release-notes', '9.9', { fetchImpl }), null, 'redirected to another branch: none');
});

test('Fortinet with endoflife.date: patch from Fortinet, support dates from endoflife.date', async () => {
  const fetchImpl = fakeFetch({
    'https://endoflife.date/api/v1/products/fortios': { body: JSON.stringify({ result: { releases: [
      { name: '7.6', releaseDate: '2024-07-25', isMaintained: true, eoasFrom: '2028-07-25', eolFrom: '2030-01-25', latest: null },
      { name: '6.4', releaseDate: '2020-03-31', isMaintained: false, eoasFrom: '2023-09-30', eolFrom: '2020-01-01', latest: null },
    ] } }) },
    'https://docs.fortinet.com/document/fortigate/7.6.999/fortios-release-notes': { status: 302, location: 'https://docs.fortinet.com/document/fortigate/7.6.7/fortios-release-notes' },
  });
  const rows = await sources.fortinet({ product: 'fortigate', document: 'fortios-release-notes', eol_slug: 'fortios' }, { fetchImpl, today: '2026-10-07' });
  assert.equal(rows.length, 1, 'only maintained branches');
  assert.deepEqual([rows[0].branch, rows[0].latest_version, rows[0].support_end, rows[0].eol], ['7.6', '7.6.7', '2028-07-25', '2030-01-25']);
});

test('Check Point: the latest and the recommended Jumbo take, from the Jumbo documentation', async () => {
  const page = `<h2>Take 170</h2><p>Released on 22 September 2026</p> ...
    <h2>Take 166</h2> Released on 09 September 2026 ...
    <h2>Take 161</h2> Released on 3 Aug 2026 and declared as <span class="x">Recommended</span> on 10 Aug 2026 ...
    <h2>Take 158</h2> Released on 22 July 2026 ... Take 141 Released on 1 May 2026 and declared as Recommended on 5 Jun 2026`;
  const fetchImpl = fakeFetch({
    'https://sc1.checkpoint.com/documents/Jumbo_HFA/R81.20/Data/HelpSystem.xml': { body: '<CatapultHelpSystem DefaultUrl="R81.20/R81.20-List-of-all-Resolved-Issues.htm" />' },
    'https://sc1.checkpoint.com/documents/Jumbo_HFA/R81.20/R81.20/R81.20-List-of-all-Resolved-Issues.htm': { body: page },
  });
  const [row] = await sources.checkpoint({ versions: ['R81.20'] }, { fetchImpl });
  assert.deepEqual([row.branch, row.latest_version, row.latest_date, row.recommended_version, row.recommended_date],
    ['R81.20', 'Take 170', '2026-09-22', 'Take 161', '2026-08-10']);
  await assert.rejects(sources.checkpoint({ versions: ['R99'] }, { fetchImpl }), /HTTP 404/);
});

test('endoflife.date: branches with their latest patch and dates; old ones only for a year', async () => {
  const fetchImpl = fakeFetch({ 'https://endoflife.date/api/v1/products/panos': { body: JSON.stringify({ result: { releases: [
    { name: '12.1', releaseDate: '2025-08-28', isMaintained: true, eolFrom: '2028-08-28', latest: { name: '12.1.10', date: '2026-09-06', link: 'https://docs.example/12.1.10' } },
    { name: '10.1', releaseDate: '2021-05-01', isMaintained: false, eolFrom: '2026-03-01', latest: { name: '10.1.14', date: '2025-12-01' } },
    { name: '9.0', releaseDate: '2019-02-01', isMaintained: false, eolFrom: '2022-03-01', latest: { name: '9.0.17' } },
  ] } }) } });
  const rows = await sources.endoflife('panos', { fetchImpl, today: '2026-10-07' });
  assert.deepEqual(rows.map(row => [row.branch, row.latest_version, row.maintained]), [['12.1', '12.1.10', 1], ['10.1', '10.1.14', 0]]);
  assert.equal(rows[0].eol, '2028-08-28');
});

test('feeds: RSS and Atom items, kept when they match a keyword', () => {
  const rss = `<?xml version="1.0"?><rss><channel>
    <item><title>R81.20 Jumbo Take 170 released</title><link>https://example.com/a</link><guid>a</guid><pubDate>Tue, 22 Sep 2026 08:00:00 GMT</pubDate><description>&lt;p&gt;New take&lt;/p&gt;</description></item>
    <item><title>Webinar next week</title><link>https://example.com/b</link><guid>b</guid></item>
  </channel></rss>`;
  const items = sources.parseFeed(rss);
  assert.equal(items.length, 2);
  assert.deepEqual([items[0].title, items[0].link, items[0].published_at, items[0].summary], ['R81.20 Jumbo Take 170 released', 'https://example.com/a', '2026-09-22T08:00:00.000Z', 'New take']);
  assert.deepEqual(sources.matchKeywords(items, 'jumbo, FortiOS').map(item => item.guid), ['a']);
  assert.equal(sources.matchKeywords(items, '').length, 2, 'no keywords: everything');
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>urn:1</id><title>FortiOS 7.4.13 is out</title><link rel="alternate" href="https://example.com/fos"/><updated>2026-10-01T10:00:00Z</updated><summary>Patch</summary></entry></feed>`;
  assert.deepEqual(sources.parseFeed(atom).map(item => [item.guid, item.link]), [['urn:1', 'https://example.com/fos']]);
  assert.equal(sources.isoDay('3 Aug 2026'), '2026-08-03');
});

test('source settings are checked', () => {
  assert.deepEqual(validateConfig('checkpoint', { versions: ['R81.20', 'R81.20', 'R82'] }), { versions: ['R81.20', 'R82'] });
  for (const [source, config] of [['checkpoint', { versions: ['81.20'] }], ['fortinet', { product: 'cisco', document: 'x', branches: ['7.4'] }], ['fortinet', { product: 'fortigate', document: 'fortios-release-notes' }],
    ['endoflife', { slug: 'Bad Slug' }], ['nope', {}]])
    assert.throws(() => validateConfig(source, config), error => error.status === 400, `${source} ${JSON.stringify(config)}`);
});

test('feeds: each redirect is checked, and a redirect to an internal address is refused', async () => {
  const rss = '<rss><channel><item><title>FortiOS 7.4.13</title><guid>1</guid></item></channel></rss>';
  const allowed = new Set(['https://feeds.example.com/rss', 'https://cdn.example.com/rss']);
  const check = async value => { if (!allowed.has(String(value))) throw new Error('Feed address must not point to a local/internal host'); return new URL(value); };
  const site = { 'https://feeds.example.com/rss': { status: 302, location: 'https://cdn.example.com/rss' }, 'https://cdn.example.com/rss': { status: 200, body: rss } };
  const get = async url => site[String(url)];
  assert.equal((await sources.feed('https://feeds.example.com/rss', { get, check }))[0].title, 'FortiOS 7.4.13', 'a redirect to another public address is followed');
  site['https://feeds.example.com/rss'] = { status: 302, location: 'http://169.254.169.254/latest/meta-data' };
  await assert.rejects(sources.feed('https://feeds.example.com/rss', { get, check }), /redirected to an address that is not allowed/);
  site['https://feeds.example.com/rss'] = { status: 302, location: 'https://feeds.example.com/rss' };
  await assert.rejects(sources.feed('https://feeds.example.com/rss', { get, check }), /too many times/);
});
