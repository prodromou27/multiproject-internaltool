/**
 * Customer reports from Odyssey's own Word template (docxtemplater).
 *
 * The template is an ordinary .docx designed in Word. It uses placeholders:
 *   {customer_name}                    a value
 *   {#activities} ... {/activities}    repeat for each item (put both tags in one
 *                                      table row to repeat that row)
 *   {#include_changes} ... {/include_changes}  shown only when that section is on
 *   {^has_changes}None.{/has_changes}  shown only when the list is empty
 *
 * PLACEHOLDERS below is the contract between the template and the app: it drives
 * the data, the check made when a template is uploaded, the in-app reference and
 * the starter template.
 */
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const { AlignmentType, Document, Footer, HeadingLevel, Packer, PageNumber, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } = require('docx');

const value = (description, example) => ({ kind: 'value', description, example });
const list = (description, fields) => ({ kind: 'list', description, fields });
const flag = description => ({ kind: 'flag', description });

const OPTIONAL_SECTIONS = ['changes', 'resolved_tickets', 'assets', 'recommendations'];

const PLACEHOLDERS = {
  customer_name: value('Customer name', 'Northwind Logistics'),
  period_from: value('First day of the reporting period', '01/10/2026'),
  period_to: value('Last day of the reporting period', '31/10/2026'),
  period_label: value('The period in words', '1 October 2026 to 31 October 2026'),
  generated_date: value('Date the report was generated', '04/11/2026'),
  prepared_by: value('Name of the person who generated the report', 'Alex Mercer'),
  responsible_team: value('Team responsible for the customer', 'Managed Services'),
  service_manager: value('Service manager, if set', 'Jordan Lee'),
  reporting_frequency: value('Reporting frequency', 'Monthly'),

  executive_summary: value('Executive summary written for this report', 'All services operated normally this month.'),
  key_highlights: value('Key highlights', 'Firewall firmware brought to the supported release.'),
  major_changes: value('Major changes (written summary)', 'Branch firewalls upgraded to 7.4.3.'),
  risks_concerns: value('Risks or concerns', 'Two switches leave vendor support in December.'),
  upcoming_activities: value('Upcoming work', 'EDR policy review scheduled for next month.'),
  management_notes: value('Management notes', ''),

  activity_count: value('Number of activities in the period', '24'),
  total_hours: value('Hours logged in the period', '36.5'),
  change_count: value('Number of changes and upgrades', '5'),
  resolved_ticket_count: value('Tickets resolved in the period', '12'),
  asset_count: value('Assets in service', '18'),
  assets_needing_attention: value('Assets whose support or warranty has expired or expires within 90 days', '2'),

  activities: list('Every activity in the period', {
    date: 'Date', reference: 'Reference (ACT-…)', title: 'What was done', category: 'Category', engineer: 'Engineer',
    hours: 'Hours', assets: 'Assets worked on, with version', status: 'Status', billing: 'Billing class', ticket: 'Ticket reference',
  }),
  hours_by_category: list('Hours per category', { name: 'Category', hours: 'Hours', count: 'Activities' }),
  hours_by_engineer: list('Hours per engineer', { name: 'Engineer', hours: 'Hours', count: 'Activities' }),
  changes: list('Changes and upgrades: one row per device changed', {
    date: 'Date', reference: 'Activity reference', title: 'What was done', asset: 'Device', asset_type: 'Device type',
    previous_version: 'Version before (when recorded earlier)', new_version: 'Version after', change_type: 'Change type',
    risk: 'Risk', approval_reference: 'Customer approval reference', engineer: 'Engineer', status: 'Status',
  }),
  resolved_tickets: list('Tickets resolved in the period', { number: 'Ticket number', subject: 'Subject', priority: 'Priority', owner: 'Owner', resolved_date: 'Resolved on' }),
  assets: list('Assets in service', {
    name: 'Name', type: 'Type', vendor: 'Vendor', model: 'Model', version: 'Software version', environment: 'Environment',
    criticality: 'Criticality', support_end: 'Support ends', support_status: 'Support status', warranty_end: 'Warranty ends', warranty_status: 'Warranty status',
  }),
  recommendations: list('Open recommendations', { finding: 'Finding', recommendation: 'Recommendation', risk: 'Risk', status: 'Status', owner: 'Owner', due: 'Due' }),

  has_activities: flag('True when there are activities'),
  has_changes: flag('True when there are changes or upgrades'),
  has_resolved_tickets: flag('True when tickets were resolved'),
  has_assets: flag('True when there are assets'),
  has_recommendations: flag('True when there are open recommendations'),
  has_risks_or_next_steps: flag('True when risks or upcoming work were written for this report'),
  ...Object.fromEntries(OPTIONAL_SECTIONS.map(section => [`include_${section}`, flag(`True when the report template includes the ${section.replace('_', ' ')} section`)])),
};

const dmy = iso => { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-'); return d && m && y ? `${d}/${m}/${y}` : String(iso); };
const words = iso => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
const hours = minutes => String(Math.round(Number(minutes || 0) / 6) / 10);
const titleCase = text => text ? String(text).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '';

/** The placeholder values for one report. */
function templateData(model, { preparedBy } = {}) {
  const narratives = model.narratives || {};
  const activities = (model.activities?.rows || []).map(row => ({
    date: dmy(row.activity_date), reference: row.activity_reference, title: row.title, category: row.category_name,
    engineer: row.engineer_name, hours: hours(row.duration_minutes), assets: row.assets_label || '', status: titleCase(row.status),
    billing: titleCase(row.billable_classification), ticket: row.ticket_reference || '',
  }));
  const breakdown = rows => (rows || []).map(row => ({ name: row.name, hours: String(row.hours ?? hours(row.minutes)), count: String(row.count) }));
  const changes = (model.changes || []).map(row => ({ ...row, date: dmy(row.date), status: titleCase(row.status), risk: titleCase(row.risk),
    asset: row.asset || '', asset_type: row.asset_type || '', previous_version: row.previous_version || '', new_version: row.new_version || '',
    change_type: row.change_type || '', approval_reference: row.approval_reference || '' }));
  const resolved = (model.resolved_tickets || []).map(row => ({ number: row.ticket_number, subject: row.subject, priority: row.normalized_priority || '',
    owner: row.owner_name || '', resolved_date: dmy(row.resolved_at) }));
  const assets = (model.assets || []).map(row => ({ ...row, type: row.type || '', vendor: row.vendor || '', model: row.model || '', version: row.version || '',
    environment: titleCase(row.environment), criticality: titleCase(row.criticality), support_end: dmy(row.support_end), support_status: row.support_status || '',
    warranty_end: dmy(row.warranty_end), warranty_status: row.warranty_status || '' }));
  const recommendations = (model.recommendations?.rows || []).map(row => ({ finding: row.finding, recommendation: row.recommendation,
    risk: titleCase(row.risk_level), status: titleCase(row.status), owner: row.owner_name || '', due: dmy(row.due_date) }));
  const sections = new Set(model.sections || []);
  return {
    customer_name: model.customer.name,
    period_from: dmy(model.period.from), period_to: dmy(model.period.to),
    period_label: `${words(model.period.from)} to ${words(model.period.to)}`,
    generated_date: dmy((model.generated_at || new Date().toISOString()).slice(0, 10)),
    prepared_by: preparedBy || '',
    responsible_team: model.customer.responsible_team || '', service_manager: model.customer.service_manager || '',
    reporting_frequency: titleCase(model.customer.reporting_frequency),
    executive_summary: narratives.executive_summary || '', key_highlights: narratives.key_highlights || '', major_changes: narratives.major_changes || '',
    risks_concerns: narratives.risks_concerns || '', upcoming_activities: narratives.upcoming_activities || '', management_notes: narratives.management_notes || '',
    activity_count: String(model.activities?.total ?? activities.length),
    total_hours: String(model.activities?.summary?.hours ?? 0),
    change_count: String(changes.length), resolved_ticket_count: String(resolved.length),
    asset_count: String(assets.length), assets_needing_attention: String((model.assets || []).filter(a => a.needs_attention).length),
    activities, hours_by_category: breakdown(model.activities?.breakdowns?.categories), hours_by_engineer: breakdown(model.activities?.breakdowns?.engineers),
    changes, resolved_tickets: resolved, assets, recommendations,
    has_activities: activities.length > 0, has_changes: changes.length > 0, has_resolved_tickets: resolved.length > 0,
    has_assets: assets.length > 0, has_recommendations: recommendations.length > 0,
    has_risks_or_next_steps: !!(narratives.risks_concerns || narratives.upcoming_activities),
    ...Object.fromEntries(OPTIONAL_SECTIONS.map(section => [`include_${section}`, sections.has(section)])),
  };
}

/** Realistic values for checking a template and for previews. */
function sampleData() {
  const data = {};
  for (const [tag, spec] of Object.entries(PLACEHOLDERS)) {
    if (spec.kind === 'value') data[tag] = spec.example;
    else if (spec.kind === 'flag') data[tag] = true;
    else data[tag] = [Object.fromEntries(Object.keys(spec.fields).map(field => [field, spec.fields[field]]))];
  }
  return data;
}

const fail = (message, details) => { throw Object.assign(new Error(message), { status: 400, details }); };

// Resolves a tag through the scope chain (loop item first, then outer data) and
// records tags that resolve nowhere, so an upload can name typos.
function trackingParser(unknown) {
  return tag => ({
    get(scope, context) {
      if (tag === '.') return scope;
      const scopes = context?.scopeList || [scope];
      for (let index = scopes.length - 1; index >= 0; index--) {
        const candidate = scopes[index];
        if (candidate && typeof candidate === 'object' && Object.prototype.hasOwnProperty.call(candidate, tag)) return candidate[tag];
      }
      if (unknown) unknown.add(tag);
      return undefined;
    },
  });
}

function compile(buffer, unknown) {
  let zip;
  try { zip = new PizZip(buffer); } catch { fail('This file is not a valid Word document (.docx).'); }
  if (!zip.file('word/document.xml')) fail('This file is not a valid Word document (.docx).');
  try {
    return new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, errorLogging: false, nullGetter: () => '', parser: trackingParser(unknown) });
  } catch (error) {
    const items = (error.properties?.errors || [error]).map(item => item.properties?.explanation || item.message);
    fail('The template has placeholder errors.', items.slice(0, 20));
  }
}

/** Placeholders in the template that the app does not provide (typos, old names). */
function unknownPlaceholders(buffer) {
  const unknown = new Set();
  const doc = compile(buffer, unknown);
  try { doc.render(sampleData()); } catch { /* reported by render() during validation */ }
  return [...unknown].map(tag => `{${tag}}`);
}

/** Check an uploaded template; throws a 400 with the problems listed. */
function validateTemplate(buffer) {
  const unknown = unknownPlaceholders(buffer);
  if (unknown.length) fail('The template uses placeholders the app does not know.', unknown.map(tag => `${tag} is not a known placeholder`));
  render(buffer, sampleData());
  return { ok: true };
}

/** Fill the template with the report data. */
function render(buffer, data) {
  const doc = compile(buffer, null);
  try { doc.render(data); } catch (error) {
    const items = (error.properties?.errors || [error]).map(item => item.properties?.explanation || item.message);
    fail('The template could not be filled in.', items.slice(0, 20));
  }
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ── Starter template: every placeholder in place, for Odyssey to restyle in Word ──
function cell(text, { bold = false, width } = {}) {
  return new TableCell({ width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    children: [new Paragraph({ children: [new TextRun({ text, bold, size: 18 })] })] });
}
function loopTable(name, columns) {
  const header = new TableRow({ tableHeader: true, children: columns.map(([, label]) => cell(label, { bold: true })) });
  const fields = columns.map(([field]) => `{${field}}`);
  fields[0] = `{#${name}}${fields[0]}`;
  fields[fields.length - 1] = `${fields[fields.length - 1]}{/${name}}`;
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, new TableRow({ children: fields.map(text => cell(text)) })] });
}
const h1 = text => new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 120 } });
const p = (text, options = {}) => new Paragraph({ children: [new TextRun({ text, ...options })], spacing: { after: 120 } });

async function starterTemplate() {
  // Each optional piece sits in its own block, so nothing empty is left behind:
  // a tag alone on a paragraph (e.g. {#has_changes}) removes that paragraph.
  const block = (tag, ...content) => [p(`{#${tag}}`), ...content, p(`{/${tag}}`)];
  const unless = (tag, text) => p(`{^${tag}}${text}{/${tag}}`);
  const children = [
    new Paragraph({ children: [new TextRun({ text: 'Managed Services Report', bold: true, size: 44 })], spacing: { after: 120 } }),
    p('{customer_name}', { size: 32 }),
    p('{period_label}'),
    p('Prepared by {prepared_by} on {generated_date}', { color: '666666' }),

    h1('Summary'),
    ...block('executive_summary', p('{executive_summary}')),
    p('In this period we carried out {activity_count} activities ({total_hours} hours), made {change_count} changes or upgrades and resolved {resolved_ticket_count} tickets.'),
    ...block('key_highlights', p('Highlights: {key_highlights}')),

    h1('Work done'),
    unless('has_activities', 'No activities were recorded in this period.'),
    ...block('has_activities',
      loopTable('activities', [['date', 'Date'], ['title', 'Activity'], ['category', 'Category'], ['engineer', 'Engineer'], ['hours', 'Hours']]),
      p('Hours by category', { bold: true }),
      loopTable('hours_by_category', [['name', 'Category'], ['count', 'Activities'], ['hours', 'Hours']])),

    ...block('include_changes',
      h1('Changes and upgrades'),
      ...block('major_changes', p('{major_changes}')),
      unless('has_changes', 'No changes or upgrades were made in this period.'),
      ...block('has_changes', loopTable('changes', [['date', 'Date'], ['asset', 'Device'], ['previous_version', 'From'], ['new_version', 'To'], ['title', 'Change'], ['engineer', 'Engineer']]))),

    ...block('include_resolved_tickets',
      h1('Resolved tickets'),
      unless('has_resolved_tickets', 'No tickets were resolved in this period.'),
      ...block('has_resolved_tickets', loopTable('resolved_tickets', [['number', 'Ticket'], ['subject', 'Subject'], ['priority', 'Priority'], ['resolved_date', 'Resolved']]))),

    ...block('include_assets',
      h1('Assets and support status'),
      unless('has_assets', 'No assets are recorded for this customer.'),
      ...block('has_assets',
        p('{assets_needing_attention} of {asset_count} assets have support or warranty that has expired or expires within 90 days.'),
        loopTable('assets', [['name', 'Asset'], ['type', 'Type'], ['version', 'Version'], ['support_end', 'Support ends'], ['support_status', 'Support']]))),

    ...block('include_recommendations',
      h1('Recommendations'),
      unless('has_recommendations', 'There are no open recommendations.'),
      ...block('has_recommendations', loopTable('recommendations', [['finding', 'Finding'], ['recommendation', 'Recommendation'], ['risk', 'Risk'], ['due', 'Due']]))),

    ...block('has_risks_or_next_steps',
      h1('Risks and next steps'),
      ...block('risks_concerns', p('{risks_concerns}')),
      ...block('upcoming_activities', p('{upcoming_activities}'))),
  ];
  const doc = new Document({
    creator: 'TeamHub', title: 'Managed Services Report template',
    styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } },
    sections: [{ children, footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: '{customer_name} · Confidential · Page ', size: 16 }), new TextRun({ children: [PageNumber.CURRENT], size: 16 })] })] }) } }],
  });
  return Packer.toBuffer(doc);
}

/** The placeholder reference shown in Settings. */
function placeholderReference() {
  return Object.entries(PLACEHOLDERS).map(([tag, spec]) => ({ tag, kind: spec.kind, description: spec.description,
    example: spec.example, fields: spec.fields ? Object.entries(spec.fields).map(([field, description]) => ({ field, description })) : undefined }));
}

module.exports = { PLACEHOLDERS, OPTIONAL_SECTIONS, templateData, sampleData, validateTemplate, unknownPlaceholders, render, starterTemplate, placeholderReference };
