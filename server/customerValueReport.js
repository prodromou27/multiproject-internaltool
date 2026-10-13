/**
 * The customer report: what we did for the customer in a period, for the customer
 * to read — the value of the service, not our internal bookkeeping. Generated as
 * PDF or Word and downloaded; no review steps.
 *
 *   At a glance   hours of work, activities, changes and upgrades, tickets resolved,
 *                 tasks completed, recommendations
 *   Our summary   an optional note written for this report
 *   Work delivered  hours by type of work, and (optionally) the work log
 *   Changes and upgrades  device, version from → to
 *   Tickets resolved, tasks completed, our recommendations, coming next,
 *   and (optionally) the devices we look after.
 */
const db = require('./db');
const appTime = require('./appTime');
const { decrypt } = require('./fieldCipher');
const reportData = require('./managedReportData');
const { PRODUCT_NAME } = require('./product');

const SECTIONS = Object.freeze(['work_log', 'changes', 'tickets', 'tasks', 'recommendations', 'upcoming', 'assets']);
const DEFAULT_SECTIONS = Object.freeze(['work_log', 'changes', 'tickets', 'tasks', 'recommendations', 'upcoming']);
const MAX_ROWS = 500;

/* The report's wording, editable per report template (Settings → Customer report
   templates). Text may use {customer}, {from}, {to} and {team}. */
const WORDING_DEFAULTS = Object.freeze({
  title: 'Service report',
  intro: '',
  show_overview: true,
  closing: '',
  footer: '{customer} · Confidential',
  color: '#1f3a5f',
  sections: [...DEFAULT_SECTIONS],
  default_summary: '',
  default_coming_next: '',
  headings: Object.freeze({ summary: 'Summary', work: 'Work delivered', changes: 'Changes and upgrades', tickets: 'Tickets resolved', tasks: 'Tasks completed',
    work_log: 'Work log', recommendations: 'Our recommendations', assets: 'Devices we look after', upcoming: 'Coming next' }),
  figures: Object.freeze({ hours: 'Hours of work', activities: 'Activities', changes: 'Changes and upgrades', tickets: 'Tickets resolved', tasks: 'Tasks completed' }),
  empty: Object.freeze({ work: 'No activities were recorded in this period.', changes: 'No changes or upgrades in this period.', tickets: 'No tickets were resolved in this period.',
    tasks: 'No tasks were completed in this period.', work_log: 'No activities were recorded in this period.', recommendations: 'We have no open recommendations.', assets: 'No devices are recorded.' }),
});
const TEXT_LIMITS = { title: 120, intro: 5000, closing: 5000, footer: 200, default_summary: 5000, default_coming_next: 5000 };

/** Checks wording sent from Settings (unknown keys are refused). */
function checkWording(input) {
  if (input == null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) fail('Report wording must be an object');
  const out = {};
  const text = (value, max, name) => { if (typeof value !== 'string' || value.length > max) fail(`${name} must be text of at most ${max} characters`); return value; };
  for (const [key, value] of Object.entries(input)) {
    if (key in TEXT_LIMITS) out[key] = text(value, TEXT_LIMITS[key], key);
    else if (key === 'show_overview') { if (typeof value !== 'boolean') fail('show_overview must be true or false'); out[key] = value; }
    else if (key === 'color') { if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) fail('The colour must look like #1f3a5f'); out[key] = value.toLowerCase(); }
    else if (key === 'sections') { if (!Array.isArray(value) || value.some(k => !SECTIONS.includes(k)) || new Set(value).size !== value.length) fail('Invalid default sections'); out[key] = value; }
    else if (['headings', 'figures', 'empty'].includes(key)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${key} must be an object`);
      out[key] = {};
      for (const [name, label] of Object.entries(value)) {
        if (!(name in WORDING_DEFAULTS[key])) fail(`Unknown ${key} entry: ${name}`);
        out[key][name] = text(label, key === 'empty' ? 300 : 80, `${key}.${name}`);
      }
    } else fail(`Unknown report wording: ${key}`);
  }
  return out;
}

/** The wording to use: the saved wording over the built-in one (a blank label falls back). */
function resolveWording(saved) {
  let stored = saved;
  if (typeof saved === 'string') { try { stored = JSON.parse(saved); } catch { stored = null; } }
  stored = stored && typeof stored === 'object' ? stored : {};
  const pick = group => Object.fromEntries(Object.entries(WORDING_DEFAULTS[group]).map(([k, v]) => [k, String(stored[group]?.[k] || '').trim() || v]));
  const value = key => (typeof stored[key] === 'string' ? stored[key] : WORDING_DEFAULTS[key]);
  return {
    title: value('title').trim() || WORDING_DEFAULTS.title, intro: value('intro'), closing: value('closing'), footer: value('footer'),
    show_overview: typeof stored.show_overview === 'boolean' ? stored.show_overview : true,
    color: /^#[0-9a-f]{6}$/i.test(stored.color || '') ? stored.color : WORDING_DEFAULTS.color,
    sections: Array.isArray(stored.sections) ? stored.sections.filter(k => SECTIONS.includes(k)) : [...DEFAULT_SECTIONS],
    default_summary: value('default_summary'), default_coming_next: value('default_coming_next'),
    headings: pick('headings'), figures: pick('figures'), empty: pick('empty'),
  };
}

/** The template a customer's report uses: their default (if active), else the first active one. */
async function templateFor(customerId, store = db) {
  return await store.prepare(`SELECT t.id, t.name, t.wording FROM managed_customer_configurations mc JOIN managed_report_templates t ON t.id = mc.default_report_template_id
      WHERE mc.customer_id = ? AND t.active = 1`).get(customerId)
    || await store.prepare('SELECT id, name, wording FROM managed_report_templates WHERE active = 1 ORDER BY id LIMIT 1').get() || null;
}
const hours = minutes => Math.round(Number(minutes || 0) / 6) / 10;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

/** Checks what the person asked for: sections to include and two optional notes. */
function checkRequest(body) {
  const sections = body.sections === undefined ? null : body.sections; // null: the template's default sections
  if (sections !== null && (!Array.isArray(sections) || sections.some(key => !SECTIONS.includes(key)) || new Set(sections).size !== sections.length)) fail('Invalid report sections');
  const note = key => {
    const value = body[key];
    if (value == null || value === '') return '';
    if (typeof value !== 'string' || value.length > 5000) fail(`${key} must be text of at most 5000 characters`);
    return value.trim();
  };
  return { sections, summary: note('summary'), coming_next: note('coming_next') };
}

async function buildValueReport({ customerId, from, to, sections = null, summary = '', coming_next = '', preparedBy = '' }, store = db) {
  const config = await store.prepare(`SELECT c.name, mc.include_in_managed_services_reports, t.name AS team, u.name AS manager,
      tc.enabled AS ticketing, tc.include_in_reporting AS tickets_in_reporting
    FROM managed_customer_configurations mc JOIN customers c ON c.id = mc.customer_id
    LEFT JOIN teams t ON t.id = mc.responsible_team_id LEFT JOIN users u ON u.id = mc.service_manager_id
    LEFT JOIN customer_ticketing_configurations tc ON tc.customer_id = mc.customer_id AND tc.provider_type = 'request_tracker'
    WHERE mc.customer_id = ? AND mc.managed_services_enabled = 1 AND c.active = 1`).get(customerId);
  if (!config) return null;
  if (!config.include_in_managed_services_reports) fail('This customer is excluded from customer reports', 409);
  const template = await templateFor(customerId, store);
  const wording = resolveWording(template?.wording);
  const include = new Set(sections || wording.sections);
  const ticketsOn = !!config.ticketing && config.tickets_in_reporting !== 0;
  const today = appTime.today();
  const dayAfter = appTime.addDays(to, 1);

  const [activities, activityChanges, versionChanges, resolved, tasksDone, recommendations, upcoming, assets] = await Promise.all([
    store.prepare(`SELECT sa.activity_date, sa.title, sa.duration_minutes, cat.name AS category, u.name AS engineer
      FROM service_activities sa JOIN activity_categories cat ON cat.id = sa.category_id JOIN users u ON u.id = sa.engineer_id
      WHERE sa.customer_id = ? AND sa.activity_date BETWEEN ? AND ? AND sa.status <> 'cancelled' ORDER BY sa.activity_date, sa.id`).all(customerId, from, to),
    reportData.getChanges(customerId, from, to, store),
    // Upgrades recorded in asset reviews and edits (customer_asset_versions), not only through activities.
    store.prepare(`SELECT v.created_at, v.from_version, v.to_version, a.name AS asset FROM customer_asset_versions v JOIN customer_assets a ON a.id = v.asset_id
      WHERE v.customer_id = ? AND v.created_at >= ? AND v.created_at < ? ORDER BY v.id`).all(customerId, from, dayAfter),
    ticketsOn ? reportData.getResolvedTickets(customerId, from, to, store) : Promise.resolve(null),
    store.prepare(`SELECT tk.title, tk.completed_at, u.name AS who FROM tasks tk LEFT JOIN projects p ON p.id = tk.project_id LEFT JOIN users u ON u.id = tk.assigned_to
      WHERE COALESCE(tk.customer_id, p.customer_id) = ? AND tk.status IN ('completed','closed') AND tk.completed_at >= ? AND tk.completed_at < ? ORDER BY tk.completed_at`).all(customerId, from, dayAfter),
    store.prepare(`SELECT finding, recommendation, risk_level, due_date, status, created_at FROM customer_recommendations
      WHERE customer_id = ? AND (status NOT IN ('implemented','converted_to_project','closed','rejected') OR (created_at >= ? AND created_at < ?))
      ORDER BY CASE risk_level WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, id`).all(customerId, from, dayAfter),
    store.prepare(`SELECT tk.title, tk.deadline FROM tasks tk LEFT JOIN projects p ON p.id = tk.project_id
      WHERE COALESCE(tk.customer_id, p.customer_id) = ? AND tk.status NOT IN ('completed','closed','cancelled') AND tk.deadline IS NOT NULL AND tk.deadline >= ? AND tk.deadline <= ?
      ORDER BY tk.deadline LIMIT 30`).all(customerId, today, appTime.addDays(today, 45)),
    include.has('assets') ? reportData.getAssets(customerId, to, store) : Promise.resolve([]),
  ]);

  // Work by type of work.
  const byCategory = new Map();
  for (const a of activities) { const row = byCategory.get(a.category) || { name: a.category, activities: 0, minutes: 0 }; row.activities++; row.minutes += Number(a.duration_minutes || 0); byCategory.set(a.category, row); }
  const categories = [...byCategory.values()].map(row => ({ name: row.name, activities: row.activities, hours: hours(row.minutes) })).sort((a, b) => b.hours - a.hours || b.activities - a.activities);

  // Changes: one row per device and version, from activities and from asset records, without repeats.
  const changes = [], seen = new Set();
  for (const c of activityChanges) {
    const key = `${c.asset || c.title}|${c.new_version || ''}`;
    if (seen.has(key)) continue; seen.add(key);
    changes.push({ date: c.date, device: c.asset || '', from: c.previous_version || '', to: c.new_version || '', what: c.title });
  }
  for (const v of versionChanges) {
    const before = decrypt(v.from_version) || '', after = decrypt(v.to_version) || '', device = decrypt(v.asset) || '';
    if (!after || before === after || seen.has(`${device}|${after}`)) continue;
    seen.add(`${device}|${after}`);
    changes.push({ date: String(v.created_at).slice(0, 10), device, from: before, to: after, what: 'Software upgraded' });
  }
  changes.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const totalMinutes = activities.reduce((sum, a) => sum + Number(a.duration_minutes || 0), 0);
  const assetSummary = include.has('assets') ? {
    total: assets.length,
    attention: assets.filter(a => a.needs_attention).length,
    rows: assets.map(a => ({ name: a.name, type: a.type || '', version: a.version || '', support: a.support_status || '—' })),
  } : null;
  const customerName = decrypt(config.name);
  const fill = text => String(text || '').replace(/\{customer\}/g, customerName).replace(/\{from\}/g, words(from)).replace(/\{to\}/g, words(to)).replace(/\{team\}/g, config.team || '');
  return {
    template: template ? { id: template.id, name: template.name } : null,
    // The wording with its placeholders filled in, for the preview and both documents.
    wording: { ...wording, title: fill(wording.title), intro: fill(wording.intro), closing: fill(wording.closing), footer: fill(wording.footer) },
    // Starting text for the two notes, offered in the form (the person may change it).
    defaults: { summary: fill(wording.default_summary), coming_next: fill(wording.default_coming_next) },
    customer: { id: Number(customerId), name: customerName, team: config.team || null, manager: config.manager || null },
    period: { from, to }, generated_at: new Date().toISOString(), prepared_by: preparedBy,
    sections: [...include], summary, coming_next,
    figures: {
      hours: hours(totalMinutes), activities: activities.length, changes: changes.length,
      tickets_resolved: resolved ? resolved.length : null, tasks_completed: tasksDone.length,
      recommendations: recommendations.length,
    },
    categories,
    work_log: activities.slice(0, MAX_ROWS).map(a => ({ date: a.activity_date, title: a.title, category: a.category, hours: hours(a.duration_minutes) })),
    changes: changes.slice(0, MAX_ROWS),
    tickets: (resolved || []).slice(0, MAX_ROWS).map(t => ({ number: t.ticket_number, subject: t.subject, resolved: String(t.resolved_at || '').slice(0, 10) })),
    tasks: tasksDone.slice(0, MAX_ROWS).map(t => ({ title: t.title, completed: String(t.completed_at).slice(0, 10) })),
    recommendations: recommendations.slice(0, MAX_ROWS).map(r => ({ finding: r.finding, recommendation: r.recommendation, risk: r.risk_level, due: r.due_date || '', status: r.status })),
    upcoming: upcoming.map(t => ({ title: t.title, due: String(t.deadline).slice(0, 10) })),
    assets: assetSummary,
  };
}

// ── Shared wording ──────────────────────────────────────────────────────────
const dmy = iso => { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-'); return d ? `${d}/${m}/${y}` : String(iso); };
const words = iso => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
const cap = text => (text ? String(text).charAt(0).toUpperCase() + String(text).slice(1).replace(/_/g, ' ') : '');
const wordingOf = report => report.wording || resolveWording(null);
function figuresOf(report) {
  const f = report.figures, l = wordingOf(report).figures;
  return [[l.hours, String(f.hours)], [l.activities, String(f.activities)], [l.changes, String(f.changes)],
    ...(f.tickets_resolved == null ? [] : [[l.tickets, String(f.tickets_resolved)]]), [l.tasks, String(f.tasks_completed)]];
}
function overviewSentence(report) {
  const f = report.figures, parts = [`${f.activities} ${f.activities === 1 ? 'activity' : 'activities'} (${f.hours} hours)`];
  if (f.changes) parts.push(`${f.changes} ${f.changes === 1 ? 'change or upgrade' : 'changes and upgrades'}`);
  if (f.tickets_resolved) parts.push(`${f.tickets_resolved} ${f.tickets_resolved === 1 ? 'ticket' : 'tickets'} resolved`);
  if (f.tasks_completed) parts.push(`${f.tasks_completed} ${f.tasks_completed === 1 ? 'task' : 'tasks'} completed`);
  return `In this period our team carried out ${parts.join(', ').replace(/, ([^,]*)$/, ' and $1')}.`;
}
function tablesOf(report) {
  const has = key => report.sections.includes(key), { headings: H, empty: E } = wordingOf(report);
  const t = [];
  if (has('changes')) t.push({ title: H.changes, empty: E.changes, columns: [['Date', 1], ['Device', 2], ['From', 1.2], ['To', 1.2], ['Change', 3]], rows: report.changes.map(c => [dmy(c.date), c.device, c.from, c.to, c.what]) });
  if (has('tickets') && report.figures.tickets_resolved != null) t.push({ title: H.tickets, empty: E.tickets, columns: [['Ticket', 1], ['Subject', 5], ['Resolved', 1.2]], rows: report.tickets.map(x => [x.number, x.subject, dmy(x.resolved)]) });
  if (has('tasks')) t.push({ title: H.tasks, empty: E.tasks, columns: [['Task', 5], ['Completed', 1.2]], rows: report.tasks.map(x => [x.title, dmy(x.completed)]) });
  if (has('work_log')) t.push({ title: H.work_log, empty: E.work_log, columns: [['Date', 1], ['Work', 4.5], ['Type', 1.8], ['Hours', 0.7]], rows: report.work_log.map(w => [dmy(w.date), w.title, w.category, String(w.hours)]) });
  if (has('recommendations')) t.push({ title: H.recommendations, empty: E.recommendations, columns: [['Finding', 3], ['Recommendation', 3.5], ['Risk', 0.9], ['Due', 1]], rows: report.recommendations.map(r => [r.finding, r.recommendation, cap(r.risk), dmy(r.due)]) });
  if (has('assets') && report.assets) t.push({ title: H.assets, note: `${report.assets.total} devices${report.assets.attention ? `; ${report.assets.attention} need attention for support or warranty` : ''}.`, empty: E.assets, columns: [['Device', 3], ['Type', 2], ['Version', 2], ['Support', 2]], rows: report.assets.rows.map(a => [a.name, a.type, a.version, a.support]) });
  return t;
}
const fileName = (report, extension) => `${(report.customer.name.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 80) || `customer_${report.customer.id}`)}_report_${report.period.from}_${report.period.to}.${extension}`;

// ── PDF ─────────────────────────────────────────────────────────────────────
function renderPdf(report) {
  const PDFDocument = require('pdfkit');
  const W = wordingOf(report);
  const C = { primary: W.color, accent: W.color, text: '#1b2430', muted: '#5f6b7a', line: '#d6dce4', soft: '#eef3f8', good: '#2e7d4f' };
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: `${W.title} – ${report.customer.name}`, Author: PRODUCT_NAME } });
    const chunks = []; doc.on('data', chunk => chunks.push(chunk)); doc.on('error', reject); doc.on('end', () => resolve(Buffer.concat(chunks)));
    const left = doc.page.margins.left, width = doc.page.width - left - doc.page.margins.right;
    const room = h => { if (doc.y + h > doc.page.height - doc.page.margins.bottom - 20) doc.addPage(); };
    const heading = text => { room(60); doc.x = left; doc.moveDown(0.8).font('Helvetica-Bold').fontSize(14).fillColor(C.primary).text(text, { width }); doc.moveTo(left, doc.y + 3).lineTo(left + 60, doc.y + 3).lineWidth(2).strokeColor(C.accent).stroke(); doc.moveDown(0.7); };
    const para = (text, opts = {}) => { doc.x = left; doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size || 10.5).fillColor(opts.color || C.text).text(text, { width, lineGap: 3 }); doc.moveDown(0.5); };

    // Header band.
    doc.rect(0, 0, doc.page.width, 150).fill(C.primary);
    doc.fillColor('#ffffff').font('Helvetica').fontSize(11).text(W.title, left, 44);
    doc.font('Helvetica-Bold').fontSize(24).text(report.customer.name, left, 62, { width });
    doc.font('Helvetica').fontSize(11).text(`${words(report.period.from)} – ${words(report.period.to)}`, left, 98);
    doc.fontSize(9).fillColor('#c9d6e6').text(`Prepared${report.prepared_by ? ` by ${report.prepared_by}` : ''} on ${words(report.generated_at.slice(0, 10))}${report.customer.team ? ` · ${report.customer.team}` : ''}`, left, 118);
    doc.y = 176; doc.x = left;

    // At a glance: figure tiles.
    const tiles = figuresOf(report), gap = 10, tileWidth = (width - gap * (tiles.length - 1)) / tiles.length, top = doc.y;
    tiles.forEach(([label, value], index) => {
      const x = left + index * (tileWidth + gap);
      doc.roundedRect(x, top, tileWidth, 64, 6).fill(C.soft);
      doc.fillColor(C.primary).font('Helvetica-Bold').fontSize(20).text(value, x + 10, top + 12, { width: tileWidth - 20 });
      doc.fillColor(C.muted).font('Helvetica').fontSize(8.5).text(label, x + 10, top + 40, { width: tileWidth - 20 });
    });
    doc.y = top + 82; doc.x = left;
    if (W.intro) para(W.intro);
    if (W.show_overview) para(overviewSentence(report));
    if (report.summary) { heading(W.headings.summary); para(report.summary); }

    // Where the time went.
    heading(W.headings.work);
    if (!report.categories.length) para(W.empty.work, { color: C.muted });
    else {
      const max = Math.max(...report.categories.map(c => c.hours), 0.1), labelWidth = 150, barWidth = width - labelWidth - 90;
      for (const c of report.categories.slice(0, 12)) {
        room(22); const y = doc.y;
        doc.font('Helvetica').fontSize(9.5).fillColor(C.text).text(c.name, left, y, { width: labelWidth - 8, lineBreak: false, ellipsis: true });
        doc.roundedRect(left + labelWidth, y + 1, barWidth, 9, 4).fill('#e3e9f0');
        doc.roundedRect(left + labelWidth, y + 1, Math.max(4, barWidth * c.hours / max), 9, 4).fill(C.accent);
        doc.fillColor(C.text).fontSize(9).text(`${c.hours} h · ${c.activities}`, left + labelWidth + barWidth + 8, y, { width: 80 });
        doc.y = y + 19;
      }
      doc.x = left; doc.moveDown(0.3);
    }

    // Tables.
    const table = spec => {
      heading(spec.title);
      if (spec.note) para(spec.note, { color: C.muted });
      if (!spec.rows.length) return para(spec.empty, { color: C.muted });
      const total = spec.columns.reduce((sum, [, w]) => sum + w, 0), widths = spec.columns.map(([, w]) => width * w / total), pad = 5;
      const row = (values, header) => {
        doc.font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(header ? 8.5 : 8.5);
        const h = Math.max(20, ...values.map((v, i) => doc.heightOfString(String(v || '—'), { width: widths[i] - pad * 2 }) + pad * 2));
        room(h); const y = doc.y;
        if (header) doc.rect(left, y, width, h).fill(C.soft);
        values.forEach((v, i) => { const x = left + widths.slice(0, i).reduce((s, w) => s + w, 0); doc.fillColor(header ? C.primary : C.text).text(String(v || '—'), x + pad, y + pad, { width: widths[i] - pad * 2 }); });
        doc.moveTo(left, y + h).lineTo(left + width, y + h).lineWidth(0.5).strokeColor(C.line).stroke();
        doc.x = left; doc.y = y + h;
      };
      row(spec.columns.map(([label]) => label), true); spec.rows.forEach(values => row(values, false)); doc.moveDown(0.4);
    };
    tablesOf(report).forEach(table);

    if (report.sections.includes('upcoming') && (report.coming_next || report.upcoming.length)) {
      heading(W.headings.upcoming);
      if (report.coming_next) para(report.coming_next);
      for (const item of report.upcoming) { room(16); para(`•  ${item.title}${item.due ? ` (planned by ${dmy(item.due)})` : ''}`); }
    }
    if (W.closing) { doc.moveDown(0.6); para(W.closing); }

    const range = doc.bufferedPageRange();
    for (let index = 0; index < range.count; index++) {
      doc.switchToPage(index); const bottom = doc.page.margins.bottom; doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(8).fillColor(C.muted).text(`${W.footer ? `${W.footer} · ` : ''}Page ${index + 1} of ${range.count}`, left, doc.page.height - 30, { width, align: 'center', lineBreak: false });
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  });
}

// ── Word ────────────────────────────────────────────────────────────────────
async function renderWord(report) {
  const { AlignmentType, BorderStyle, Document, Footer, HeadingLevel, Packer, PageNumber, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } = require('docx');
  const W = wordingOf(report);
  const PRIMARY = W.color.slice(1).toUpperCase(), SOFT = 'EEF3F8', MUTED = '5F6B7A';
  const p = (text, opts = {}) => new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text, size: opts.size || 21, bold: opts.bold, color: opts.color })] });
  const h = text => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 120 }, children: [new TextRun({ text, color: PRIMARY, bold: true, size: 28 })] });
  const cell = (text, { header = false, width } = {}) => new TableCell({ width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    shading: header ? { type: ShadingType.CLEAR, color: 'auto', fill: SOFT } : undefined, margins: { top: 60, bottom: 60, left: 90, right: 90 },
    children: [new Paragraph({ children: [new TextRun({ text: String(text || '—'), bold: header, size: 18, color: header ? PRIMARY : undefined })] })] });
  const borders = { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D6DCE4' }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'D6DCE4' }, insideVertical: { style: BorderStyle.NONE } };
  const table = spec => {
    const total = spec.columns.reduce((sum, [, w]) => sum + w, 0), pct = spec.columns.map(([, w]) => Math.round(w / total * 100));
    return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders, rows: [
      new TableRow({ tableHeader: true, children: spec.columns.map(([label], i) => cell(label, { header: true, width: pct[i] })) }),
      ...spec.rows.map(values => new TableRow({ children: values.map((v, i) => cell(v, { width: pct[i] })) })),
    ] });
  };
  const tiles = figuresOf(report);
  const children = [
    p(W.title, { color: MUTED, size: 22 }),
    new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: report.customer.name, bold: true, size: 48, color: PRIMARY })] }),
    p(`${words(report.period.from)} – ${words(report.period.to)}`, { size: 24 }),
    p(`Prepared${report.prepared_by ? ` by ${report.prepared_by}` : ''} on ${words(report.generated_at.slice(0, 10))}${report.customer.team ? ` · ${report.customer.team}` : ''}`, { color: MUTED, size: 18 }),
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: { ...borders, bottom: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.NONE } }, rows: [
      new TableRow({ children: tiles.map(([, value]) => new TableCell({ shading: { type: ShadingType.CLEAR, color: 'auto', fill: SOFT }, margins: { top: 120, bottom: 0, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: value, bold: true, size: 36, color: PRIMARY })] })] })) }),
      new TableRow({ children: tiles.map(([label]) => new TableCell({ shading: { type: ShadingType.CLEAR, color: 'auto', fill: SOFT }, margins: { top: 0, bottom: 120, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: label, size: 16, color: MUTED })] })] })) }),
    ] }),
    new Paragraph({ spacing: { before: 200, after: 0 }, children: [] }),
  ];
  if (W.intro) children.push(...W.intro.split(/\n+/).map(line => p(line)));
  if (W.show_overview) children.push(p(overviewSentence(report)));
  if (report.summary) children.push(h(W.headings.summary), ...report.summary.split(/\n+/).map(line => p(line)));
  children.push(h(W.headings.work));
  if (report.categories.length) children.push(table({ columns: [['Type of work', 5], ['Activities', 1.5], ['Hours', 1.5]], rows: report.categories.map(c => [c.name, String(c.activities), String(c.hours)]) }));
  else children.push(p(W.empty.work, { color: MUTED }));
  for (const spec of tablesOf(report)) {
    children.push(h(spec.title));
    if (spec.note) children.push(p(spec.note, { color: MUTED }));
    children.push(spec.rows.length ? table(spec) : p(spec.empty, { color: MUTED }));
  }
  if (report.sections.includes('upcoming') && (report.coming_next || report.upcoming.length)) {
    children.push(h(W.headings.upcoming));
    if (report.coming_next) children.push(...report.coming_next.split(/\n+/).map(line => p(line)));
    for (const item of report.upcoming) children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: `${item.title}${item.due ? ` (planned by ${dmy(item.due)})` : ''}`, size: 21 })] }));
  }
  if (W.closing) children.push(new Paragraph({ spacing: { before: 240 }, children: [] }), ...W.closing.split(/\n+/).map(line => p(line)));
  const doc = new Document({ creator: PRODUCT_NAME, title: `${W.title} – ${report.customer.name}`, styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } },
    sections: [{ children, footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
      new TextRun({ text: `${W.footer ? `${W.footer} · ` : ''}Page `, size: 16, color: MUTED }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: MUTED })] })] }) } }] });
  return Packer.toBuffer(doc);
}

module.exports = { SECTIONS, DEFAULT_SECTIONS, WORDING_DEFAULTS, checkRequest, checkWording, resolveWording, buildValueReport, renderPdf, renderWord, fileName };
