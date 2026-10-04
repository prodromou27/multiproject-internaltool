const test = require('node:test');
const assert = require('node:assert/strict');
const PizZip = require('pizzip');
const docx = require('../managedReportDocx');

const textOf = buffer => new PizZip(buffer).file('word/document.xml').asText().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const edit = (buffer, from, to) => { const zip = new PizZip(buffer); zip.file('word/document.xml', zip.file('word/document.xml').asText().replace(from, to)); return zip.generate({ type: 'nodebuffer' }); };

test('the starter template uses only known placeholders and fills completely', async () => {
  const starter = await docx.starterTemplate();
  assert.deepEqual(docx.validateTemplate(starter), { ok: true });
  assert.doesNotMatch(textOf(docx.render(starter, docx.sampleData())), /[{}]/);
});

test('a typo is named, an unclosed block is explained, and a non-Word file is refused', async () => {
  const starter = await docx.starterTemplate();
  assert.throws(() => docx.validateTemplate(edit(starter, '{customer_name}', '{custmer_name}')),
    error => error.status === 400 && error.details.includes('{custmer_name} is not a known placeholder'));
  assert.throws(() => docx.validateTemplate(edit(starter, '{/include_assets}', '')),
    error => error.status === 400 && error.details.some(item => /include_assets/.test(item) && /unclosed/i.test(item)));
  assert.throws(() => docx.validateTemplate(Buffer.from('plain text')), error => error.status === 400 && /not a valid Word document/.test(error.message));
});

test('empty lists show their message and leave no table or heading behind', async () => {
  const starter = await docx.starterTemplate();
  const data = { ...docx.sampleData(), activities: [], hours_by_category: [], changes: [], recommendations: [],
    has_activities: false, has_changes: false, has_recommendations: false, major_changes: '', key_highlights: '',
    has_risks_or_next_steps: false, risks_concerns: '', upcoming_activities: '' };
  const text = textOf(docx.render(starter, data));
  assert.ok(text.includes('No activities were recorded in this period.'));
  assert.ok(text.includes('No changes or upgrades were made in this period.'));
  assert.ok(!text.includes('Risks and next steps'));
  assert.ok(!/Finding\s+Recommendation/.test(text), 'the recommendations table header is not shown for an empty list');
});

test('report data maps activities, the change log and asset support status', () => {
  const data = docx.templateData({
    customer: { name: 'Northwind', responsible_team: 'Managed Services', reporting_frequency: 'monthly' },
    period: { from: '2026-09-01', to: '2026-09-30' }, generated_at: '2026-10-01T08:00:00Z', sections: ['changes', 'assets'], narratives: { executive_summary: 'Stable.' },
    activities: { total: 1, summary: { hours: 1.5 }, breakdowns: { categories: [{ name: 'Upgrade', count: 1, hours: 1.5 }], engineers: [] },
      rows: [{ activity_date: '2026-09-20', activity_reference: 'ACT-1', title: 'Upgraded firmware', category_name: 'Upgrade', engineer_name: 'Maria', duration_minutes: 90, assets_label: 'FW-01 -> 7.4.3', status: 'completed' }] },
    changes: [{ date: '2026-09-20', asset: 'FW-01', previous_version: '7.2.8', new_version: '7.4.3', title: 'Upgraded firmware', status: 'completed', risk: 'low' }],
    resolved_tickets: [], assets: [{ name: 'FW-01', support_end: '2026-11-15', support_status: 'Expires within 90 days', needs_attention: true }], recommendations: { rows: [] },
  }, { preparedBy: 'Alex' });
  assert.equal(data.period_label, '1 September 2026 to 30 September 2026');
  assert.equal(data.reporting_frequency, 'Monthly');
  assert.deepEqual([data.activities[0].date, data.activities[0].hours, data.activities[0].status], ['20/09/2026', '1.5', 'Completed']);
  assert.deepEqual([data.changes[0].previous_version, data.changes[0].new_version], ['7.2.8', '7.4.3']);
  assert.deepEqual([data.assets[0].support_end, data.assets_needing_attention], ['15/11/2026', '1']);
  assert.deepEqual([data.include_changes, data.include_assets, data.include_resolved_tickets], [true, true, false]);
});
