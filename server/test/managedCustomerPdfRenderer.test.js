const test = require('node:test');
const assert = require('node:assert/strict');
const PDFDocument = require('pdfkit');
const { renderPdf } = require('../managedCustomerPdfRenderer');

const model = {
  customer: { name: 'Northwind Logistics' },
  period: { from: '2026-10-01', to: '2026-10-04' },
  generated_at: '2026-10-04T09:00:00Z',
  narratives: {},
  sections: ['executive_summary', 'service_overview', 'service_activities', 'tasks', 'projects', 'maintenance_visits', 'recommendations', 'risks', 'upcoming_work', 'management_notes'],
  overview: { tickets: null, activities: { activities: 1, hours: 1 }, tasks: { open_now: 0 }, projects: { active_now: 0 }, visits: { visits_period: 0 }, recommendations: { open_now: 0 } },
  tickets: { enabled: false },
  activities: { enabled: true, rows: [{ activity_date: '2026-10-04', activity_reference: 'ACT-2026-000001', title: 'Upgraded FortiGate firmware', engineer_name: 'Maria Security', category_name: 'Upgrade', duration_minutes: 60 }] },
  tasks: { enabled: true, rows: [] },
  projects: { enabled: true, rows: [] },
  maintenance_visits: { enabled: true, rows: [] },
  recommendations: { enabled: true, rows: [] },
};

// Record where each section heading (16pt bold) is written, and how many pages are made.
function instrument() {
  const headings = [];
  let pages = 0;
  const text = PDFDocument.prototype.text, addPage = PDFDocument.prototype.addPage;
  PDFDocument.prototype.text = function (value, ...rest) {
    if (this._fontSize === 16 && typeof value === 'string') {
      const x = typeof rest[0] === 'number' ? rest[0] : this.x;
      headings.push({ value, x, left: this.page.margins.left });
    }
    return text.call(this, value, ...rest);
  };
  PDFDocument.prototype.addPage = function (...args) { pages++; return addPage.apply(this, args); };
  return { headings, pages: () => pages, restore() { PDFDocument.prototype.text = text; PDFDocument.prototype.addPage = addPage; } };
}

test('every section heading starts at the left margin, including those after a table', async () => {
  const spy = instrument();
  try {
    await renderPdf(model);
    assert.ok(spy.headings.length >= 8, `headings recorded: ${spy.headings.length}`);
    for (const h of spy.headings) assert.equal(h.x, h.left, `"${h.value}" starts at x=${h.x}, not the left margin ${h.left}`);
  } finally { spy.restore(); }
});

test('page footers are drawn on the content pages, not on extra blank pages', async () => {
  const spy = instrument();
  let pdf;
  try { pdf = await renderPdf(model); } finally { spy.restore(); }
  const pageObjects = (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
  // The cover page plus whatever addPage() calls the content needed: nothing more.
  assert.equal(pageObjects, spy.pages(), 'no pages were created beyond the ones the content asked for');
  assert.ok(pageObjects <= 3, `a short report should fit in at most 3 pages, got ${pageObjects}`);
});

test('the built-in PDF, Word and Excel layouts include changes, resolved tickets and assets when selected', async () => {
  const PizZip = require('pizzip');
  const ExcelJS = require('exceljs');
  const { renderWord } = require('../managedCustomerWordRenderer');
  const { renderExcel } = require('../managedCustomerExcelRenderer');
  const full = { ...model, tickets: { enabled: true, analytics: null, open: { rows: [] }, period: { rows: [] } },
    sections: ['changes', 'resolved_tickets', 'assets'],
    changes: [{ date: '2026-09-20', asset: 'FW-01', previous_version: '7.2.8', new_version: '7.4.3', title: 'Upgraded firmware', engineer: 'Maria Security', reference: 'ACT-1' }],
    resolved_tickets: [{ ticket_number: '101', subject: 'VPN down', normalized_priority: 'High', owner_name: 'maria', resolved_at: '2026-09-21T10:00:00Z' }],
    assets: [{ name: 'FW-01', type: 'Firewall', version: '7.4.3', support_end: '2026-11-15', support_status: 'Expires within 90 days', warranty_status: null }] };
  const pdf = await renderPdf(full);
  assert.ok(pdf.length > 1000);
  const word = new PizZip(await renderWord(full)).file('word/document.xml').asText().replace(/<[^>]+>/g, ' ');
  for (const text of ['Changes and upgrades', '7.2.8', '7.4.3', 'Resolved tickets', 'VPN down', 'Assets and support status', 'Expires within 90 days']) assert.ok(word.includes(text), `Word: ${text}`);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await renderExcel(full));
  assert.deepEqual(['Changes', 'Resolved Tickets', 'Assets'].map(name => !!workbook.getWorksheet(name)), [true, true, true]);
  assert.equal(workbook.getWorksheet('Changes').getRow(2).getCell(3).value, '7.2.8');
});
