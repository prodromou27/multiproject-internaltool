// Layout of the lifecycle and advisory sections in the built-in customer report PDF and Word.
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { resolveWording, renderPdf, renderWord } = require('../customerValueReport');

// Every line of text in a pdfkit PDF, in drawing order: { page, y (from the top), text }.
function textItems(pdf) {
  const raw = pdf.toString('latin1'), items = [];
  let page = -1;
  for (const match of raw.matchAll(/stream\r?\n/g)) {
    const start = match.index + match[0].length, end = raw.indexOf('endstream', start);
    let content;
    try { content = zlib.inflateSync(pdf.subarray(start, end)).toString('latin1'); } catch { continue; }
    const height = /^1 0 0 -1 0 ([\d.]+) cm/.exec(content);
    if (!height) continue;
    page++;
    for (const block of content.matchAll(/1 0 0 1 [\d.-]+ ([\d.-]+) Tm[\s\S]*?\[(.*?)\] TJ/g)) {
      const text = [...block[2].matchAll(/<([0-9a-f]*)>/g)].map(hex => Buffer.from(hex[1], 'hex').toString('latin1')).join('');
      items.push({ page, y: Number(height[1]) - Number(block[1]), text });
    }
  }
  return items;
}
const find = (items, text, from = 0) => { const index = items.findIndex((item, i) => i >= from && item.text.includes(text)); assert.ok(index >= 0, `"${text}" is in the PDF`); return index; };

const report = ({ devices = 0, advisories = [], summaryLines = 0 }) => ({
  wording: resolveWording(null), customer: { id: 1, name: 'Acme Corp', team: null }, period: { from: '2026-10-01', to: '2026-10-31' },
  generated_at: '2026-11-01T09:00:00.000Z', prepared_by: '', sections: ['lifecycle', 'advisories'], summary: Array.from({ length: summaryLines }, (_, n) => `Summary line ${n}.`).join('\n'), coming_next: '', upcoming: [], categories: [],
  figures: { hours: 0, activities: 0, changes: 0, tickets_resolved: null, tasks_completed: 0, recommendations: 0 },
  lifecycle: { total: devices + 1, summary: 'Some items have expired.', groups: [
    ...(devices ? [{ key: 'devices', title: 'Devices and firmware', rows: Array.from({ length: devices }, (_, n) => ({ item: `Device ${n}`, type: 'Support', ends: '2026-12-01', status: 'Within 90 days' })) }] : []),
    { key: 'licences', title: 'Licences, subscriptions and certificates', rows: [{ item: 'Licence A', type: 'Licence', ends: '2027-01-01', status: 'Within 90 days' }] },
  ] },
  advisories: { total: advisories.length, more: '', notice: 'General information.', rows: advisories },
});
const advisory = (cve, description) => ({ cve, product: 'PHP', severity: 'Critical 9.8', exploited: false, description });

test('a description longer than a page flows on, and the next advisory follows right below it', async () => {
  const long = `${'Lorem ipsum dolor sit amet consectetur. '.repeat(260)}ENDMARK`;
  const items = textItems(await renderPdf(report({ advisories: [advisory('CVE-2026-00001', long), advisory('CVE-2026-00002', 'Short text.')] })));
  const end = items[find(items, 'ENDMARK')], next = items[find(items, 'CVE-2026-00002')];
  assert.ok(next.page === end.page && next.y > end.y && next.y - end.y < 60, `next advisory at page ${next.page} y ${next.y}, description ended at page ${end.page} y ${end.y}`);
});

test('a group title, and an advisory and its description, are never split across pages', async () => {
  // Rows move the page position in fixed steps; summary lines shift it in between, so every position is tried.
  for (let summaryLines = 0; summaryLines <= 3; summaryLines++) for (let devices = 0; devices <= 80; devices++) {
    const items = textItems(await renderPdf(report({ devices, summaryLines, advisories: [advisory('CVE-2026-10001', 'DESC-ONE text.'), advisory('CVE-2026-10002', 'DESC-TWO text.')] })));
    const title = find(items, 'Licences, subscriptions and certificates');
    assert.equal(items[find(items, 'Item', title + 1)].page, items[title].page, `with ${devices} devices the group title is alone at the foot of page ${items[title].page}`);
    for (const [cve, text] of [['CVE-2026-10001', 'DESC-ONE'], ['CVE-2026-10002', 'DESC-TWO']])
      assert.equal(items[find(items, text)].page, items[find(items, cve)].page, `with ${devices} devices ${cve} is split from its description`);
  }
});

test('in Word, no line separates an advisory from its description', async () => {
  const PizZip = require('pizzip');
  const xml = new PizZip(await renderWord(report({ advisories: [advisory('CVE-2026-20001', 'DESC-WORD text.')] }))).file('word/document.xml').asText();
  const rows = xml.split('<w:tr>').slice(1);
  const cveRow = rows.find(row => row.includes('CVE-2026-20001')), descRow = rows.find(row => row.includes('DESC-WORD'));
  assert.match(cveRow, /<w:bottom w:val="(none|nil)"/, 'the advisory row has no bottom line');
  assert.match(descRow, /<w:top w:val="(none|nil)"/, 'the description row has no top line');
});
