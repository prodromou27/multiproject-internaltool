/**
 * Importing service activities from Excel. An engineer downloads a template made
 * for them (only the customers and categories they can log for, as drop-downs),
 * fills in the work they did and uploads it. The import is reviewed first: each row
 * is new, already logged (skipped) or not imported with the reason. Every row goes
 * through the same checks as the activity form (serviceActivityCreate.js).
 */
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const multer = require('multer');
const db = require('./db');
const { decrypt } = require('./fieldCipher');
const { assertSafeSpreadsheet } = require('./uploadUtils');
const { parseDay } = require('./customerImport');
const { categoriesForTeams } = require('./routes/serviceActivitiesAccess');
const { activityCustomersFor, prepareActivityCreate, createActivity } = require('./serviceActivityCreate');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const MAX_ROWS = 1000;
const SHEET = 'Activities';

const WORK_LOCATIONS = [['remote', 'Remote'], ['onsite', 'On-site'], ['internal', 'Internal'], ['hybrid', 'Hybrid']];
const BILLABLE = [['included_in_contract', 'Included in contract'], ['billable', 'Billable'], ['non_billable', 'Non-billable'],
  ['internal', 'Internal'], ['not_applicable', 'Not applicable']];

// [key, header, width, note shown on the header cell]
const COLUMNS = [
  ['customer', 'Customer*', 30, 'Pick from the list.'],
  ['activity_date', 'Date*', 13, 'The day the work was done, e.g. 2026-10-28. Not a future date.'],
  ['category', 'Category*', 24, 'Pick from the list.'],
  ['subcategory', 'Subcategory', 24, 'Optional. Must belong to the category.'],
  ['title', 'Title', 36, 'Optional. Left blank, the activity is named after its category.'],
  ['start_time', 'Start time', 11, 'Optional, 24-hour, e.g. 09:30.'],
  ['end_time', 'End time', 11, 'Optional, 24-hour, e.g. 11:00.'],
  ['duration_minutes', 'Duration (minutes)', 12, 'Optional. Worked out from the start and end time when left blank.'],
  ['ticket_reference', 'Ticket reference', 18, 'Optional, unless the customer requires it.'],
  ['work_location', 'Work location', 15, 'Pick from the list.'],
  ['billable_classification', 'Billable', 20, 'Pick from the list.'],
  ['technologies', 'Technologies', 26, 'Optional. Names from the Lists sheet, separated by commas.'],
  ['assets', 'Assets', 26, 'Optional. Asset names, hostnames or tags, separated by commas.'],
  ['description', 'Notes', 40, 'Optional, unless the customer requires it.'],
  ['follow_up_date', 'Follow-up date', 14, 'Optional. Filling it in marks the activity as needing a follow-up.'],
];
const headerKey = text => String(text || '').replace(/\*/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
const HEADER_KEYS = new Map(COLUMNS.flatMap(([key, header]) => [[headerKey(header), key], [headerKey(key.replace(/_/g, ' ')), key], [key, key]]));
const column = key => COLUMNS.findIndex(([k]) => k === key) + 1;
const letter = n => String.fromCharCode(64 + n);

async function lists(req) {
  const [customers, categories, subcategories, technologies] = await Promise.all([
    activityCustomersFor(req),
    categoriesForTeams(req.enabledTeamIds),
    db.prepare('SELECT id, category_id, name FROM activity_subcategories WHERE active = 1 ORDER BY sort_order, name').all(),
    db.prepare('SELECT id, name FROM technologies WHERE active = 1 ORDER BY sort_order, name').all(),
  ]);
  return { customers, categories, subcategories: subcategories.filter(s => categories.some(c => c.id === s.category_id)), technologies };
}

const REQUIREMENTS = [['require_duration', 'duration'], ['require_ticket_reference', 'ticket reference'], ['require_technology', 'a technology'],
  ['require_notes', 'notes'], ['require_billable_classification', 'billable']];

/** The template for this person: drop-downs list only what they can log for. */
async function buildTemplate(req) {
  const { customers, categories, subcategories, technologies } = await lists(req);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(SHEET, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = COLUMNS.map(([key, header, width]) => ({ header, key, width }));
  const head = sheet.getRow(1);
  head.font = { bold: true };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
  COLUMNS.forEach(([, , , note], i) => { if (note) head.getCell(i + 1).note = note; });
  for (const key of ['activity_date', 'follow_up_date']) sheet.getColumn(column(key)).numFmt = 'yyyy-mm-dd';
  for (const key of ['start_time', 'end_time']) sheet.getColumn(column(key)).numFmt = 'hh:mm';

  const listSheet = workbook.addWorksheet('Lists');
  const listColumns = [
    ['Customers', customers.map(c => c.name)],
    ['Categories', [...new Set(categories.map(c => c.name))]],
    ['Subcategories', [...new Set(subcategories.map(s => s.name))]],
    ['Technologies', technologies.map(t => t.name)],
    ['Work location', WORK_LOCATIONS.map(([, label]) => label)],
    ['Billable', BILLABLE.map(([, label]) => label)],
  ];
  listColumns.forEach(([title, values], i) => {
    listSheet.getColumn(i + 1).width = 30;
    listSheet.getCell(1, i + 1).value = title;
    listSheet.getCell(1, i + 1).font = { bold: true };
    values.forEach((value, row) => { listSheet.getCell(row + 2, i + 1).value = value; });
  });

  const last = MAX_ROWS + 1;
  const dropDown = (key, listIndex, what) => {
    const count = listColumns[listIndex][1].length;
    if (!count) return;
    const col = letter(listIndex + 1);
    sheet.dataValidations.add(`${letter(column(key))}2:${letter(column(key))}${last}`, {
      type: 'list', allowBlank: true, formulae: [`Lists!$${col}$2:$${col}$${count + 1}`],
      showErrorMessage: true, errorStyle: 'error', errorTitle: 'Not in the list', error: `Pick ${what} from the list.`,
    });
  };
  dropDown('customer', 0, 'a customer');
  dropDown('category', 1, 'a category');
  dropDown('subcategory', 2, 'a subcategory');
  dropDown('work_location', 4, 'a work location');
  dropDown('billable_classification', 5, 'a billable option');
  sheet.dataValidations.add(`${letter(column('duration_minutes'))}2:${letter(column('duration_minutes'))}${last}`, {
    type: 'whole', operator: 'between', allowBlank: true, formulae: [1, 1440],
    showErrorMessage: true, errorTitle: 'Duration', error: 'Whole minutes, from 1 to 1440.',
  });

  const help = workbook.addWorksheet('How to fill in');
  help.getColumn(1).width = 34;
  help.getColumn(2).width = 60;
  [
    ['One row per activity you did, on the Activities sheet.'],
    ['Customer, Date and Category are required. Pick them from the drop-downs.'],
    ['Activities you already logged (same customer, day, category, title, start time and duration) are skipped, so a file can be imported again safely.'],
    ['Before anything is saved you see what will be imported and why any row is not.'],
    [],
  ].forEach(row => help.addRow(row));
  const strict = customers.filter(c => REQUIREMENTS.some(([field]) => c[field]));
  if (strict.length) {
    const title = help.addRow(['Customer', 'Also required for this customer']);
    title.font = { bold: true };
    strict.forEach(c => help.addRow([c.name, REQUIREMENTS.filter(([field]) => c[field]).map(([, label]) => label).join(', ')]));
  }

  return workbook.xlsx.writeBuffer();
}

/* ── Reading the file ─────────────────────────────────────────────────── */
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
function cellValue(value) {
  if (value == null) return '';
  if (value instanceof Date || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'object') {
    if (value.richText) return value.richText.map(part => part.text || '').join('');
    if (value.formula !== undefined || value.sharedFormula !== undefined) return cellValue(value.result);
    if (value.text !== undefined) return cellValue(value.text);
    if (value.error) return '';
  }
  return String(value).trim();
}
const shown = value => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '').trim());

function dateOf(value) {
  if (value === '' || value == null) return { value: null };
  if (value instanceof Date) return { value: value.toISOString().slice(0, 10) };
  if (typeof value === 'number' && value > 0) return { value: new Date(EXCEL_EPOCH + Math.round(value) * 86400000).toISOString().slice(0, 10) };
  const day = parseDay(value);
  return day ? { value: day } : { error: true };
}

function timeOf(value) {
  if (value === '' || value == null) return { value: null };
  let minutes = null;
  // Excel keeps a time as a fraction of a day; ExcelJS gives it as a Date on 1899-12-30.
  if (value instanceof Date) minutes = value.getUTCHours() * 60 + value.getUTCMinutes() + (value.getUTCSeconds() >= 30 ? 1 : 0);
  else if (typeof value === 'number' && value >= 0 && value < 1) minutes = Math.round(value * 1440);
  else {
    const match = String(value).trim().match(/^(\d{1,2})[:.](\d{2})(?::\d{2})?$/);
    if (match && Number(match[1]) < 24 && Number(match[2]) < 60) minutes = Number(match[1]) * 60 + Number(match[2]);
  }
  if (minutes == null || minutes >= 1440) return { error: true };
  return { value: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` };
}

/** The rows of the Activities sheet: { rows, hash } or { error }. Blank rows are left out. */
async function readWorkbook(file) {
  if (!file) return { error: 'No file uploaded' };
  const workbook = new ExcelJS.Workbook();
  try { assertSafeSpreadsheet(file.buffer); await workbook.xlsx.load(file.buffer); }
  catch (e) { return { error: e.status === 400 ? e.message : 'Could not read the file. Use the .xlsx template.' }; }
  const sheet = workbook.getWorksheet(SHEET) || workbook.worksheets[0];
  if (!sheet) return { error: 'The file has no sheets' };
  const keys = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => { keys[col] = HEADER_KEYS.get(headerKey(cellValue(cell.value))); });
  for (const required of ['customer', 'activity_date', 'category']) {
    if (!keys.includes(required)) return { error: `The file has no ${COLUMNS.find(([k]) => k === required)[1].replace('*', '')} column. Use the template.` };
  }
  const rows = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const raw = {};
    keys.forEach((key, col) => { if (key) raw[key] = cellValue(row.getCell(col).value); });
    if (Object.values(raw).every(value => value === '')) continue;
    rows.push({ row: r, raw });
    if (rows.length > MAX_ROWS) return { error: `At most ${MAX_ROWS} activities per import. Split the file.` };
  }
  if (!rows.length) return { error: 'The file has no activities in it' };
  return { rows, hash: crypto.createHash('sha256').update(file.buffer).digest('hex') };
}

/* ── What importing would do ──────────────────────────────────────────── */
const lower = value => String(value ?? '').trim().toLowerCase();
const isoDay = value => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '').slice(0, 10));
const dedupeKey = ({ customerId, date, categoryId, title, startTime, duration }) =>
  [customerId, date, categoryId, lower(title), startTime ? String(startTime).slice(0, 5) : '', duration ? Number(duration) : ''].join('|');
const choice = (options, value) => options.find(([key, label]) => lower(key) === lower(value) || lower(label) === lower(value)
  || lower(label).replace(/[^a-z]/g, '') === lower(value).replace(/[^a-z]/g, ''))?.[0];

async function planImport(read, req) {
  const { customers, categories, subcategories, technologies } = await lists(req);
  const customerTeams = new Map();
  for (const { customer_id: customerId, team_id: teamId } of await db.prepare('SELECT customer_id, team_id FROM customer_teams').all()) {
    if (!customerTeams.has(Number(customerId))) customerTeams.set(Number(customerId), new Set());
    customerTeams.get(Number(customerId)).add(teamId);
  }
  const assetsByCustomer = new Map();
  const assetsOf = async customerId => {
    if (!assetsByCustomer.has(customerId)) {
      const rows = await db.prepare("SELECT id, name, hostname, asset_tag FROM customer_assets WHERE customer_id = ? AND lifecycle_status NOT IN ('retired','decommissioned')").all(customerId);
      assetsByCustomer.set(customerId, rows.map(a => ({ id: Number(a.id), names: [a.name, a.hostname, a.asset_tag].map(decrypt).filter(Boolean).map(lower) })));
    }
    return assetsByCustomer.get(customerId);
  };
  const existing = new Set((await db.prepare('SELECT customer_id, activity_date, category_id, title, start_time, duration_minutes FROM service_activities WHERE engineer_id = ?').all(req.user.id))
    .map(a => dedupeKey({ customerId: Number(a.customer_id), date: isoDay(a.activity_date), categoryId: Number(a.category_id), title: a.title, startTime: a.start_time, duration: a.duration_minutes })));
  const seen = new Set();

  const rows = [];
  for (const { row, raw } of read.rows) {
    const values = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, shown(value)]));
    const base = { row, name: [values.customer, values.title || values.category].filter(Boolean).join(' – '), values };
    const fail = (error, kind) => rows.push({ ...base, action: 'error', error, kind });

    const missing = ['customer', 'activity_date', 'category'].filter(key => !values[key]);
    if (missing.length) { fail(`Missing: ${missing.map(key => COLUMNS.find(([k]) => k === key)[1].replace('*', '')).join(', ')}`); continue; }

    const namedCustomers = customers.filter(c => lower(c.name) === lower(values.customer));
    if (!namedCustomers.length) { fail(`You cannot log activity for "${values.customer}" (not one of your customers, or not tracked)`); continue; }
    if (namedCustomers.length > 1) { fail(`More than one customer is called "${values.customer}"; log this one from the form`); continue; }
    const customer = namedCustomers[0], customerId = Number(customer.id);

    const date = dateOf(raw.activity_date);
    if (date.error) { fail(`Date must be a date (YYYY-MM-DD or DD/MM/YYYY), not "${values.activity_date}"`); continue; }

    // The same category name can exist for more than one team: the one this customer's teams can use.
    const teams = customerTeams.get(customerId) || new Set();
    const namedCategories = categories.filter(c => lower(c.name) === lower(values.category));
    const usable = namedCategories.filter(c => c.team_id == null || teams.has(c.team_id));
    const category = (usable.length ? usable : namedCategories).length === 1 ? (usable.length ? usable : namedCategories)[0] : null;
    if (!namedCategories.length) { fail(`Unknown category "${values.category}"`); continue; }
    if (!category) { fail(`More than one category is called "${values.category}"; log this one from the form`); continue; }

    let subcategoryId = null;
    if (values.subcategory) {
      const sub = subcategories.find(s => s.category_id === category.id && lower(s.name) === lower(values.subcategory));
      if (!sub) { fail(`"${values.subcategory}" is not a subcategory of ${category.name}`); continue; }
      subcategoryId = sub.id;
    }

    const start = timeOf(raw.start_time), end = timeOf(raw.end_time);
    if (start.error) { fail(`Start time must be like 09:30, not "${values.start_time}"`); continue; }
    if (end.error) { fail(`End time must be like 17:00, not "${values.end_time}"`); continue; }
    let duration = values.duration_minutes ? Number(values.duration_minutes) : null;
    if (values.duration_minutes && (!Number.isSafeInteger(duration) || duration < 1 || duration > 1440)) { fail(`Duration must be whole minutes from 1 to 1440, not "${values.duration_minutes}"`); continue; }
    if (duration == null && start.value && end.value) {
      const minutes = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
      if (minutes(end.value) > minutes(start.value)) duration = minutes(end.value) - minutes(start.value);
    }

    let workLocation = null, billable = null;
    if (values.work_location && !(workLocation = choice(WORK_LOCATIONS, values.work_location))) { fail(`Unknown work location "${values.work_location}"`); continue; }
    if (values.billable_classification && !(billable = choice(BILLABLE, values.billable_classification))) { fail(`Unknown billable option "${values.billable_classification}"`); continue; }

    const split = text => [...new Set(String(text || '').split(/[,;\n]/).map(part => part.trim()).filter(Boolean))];
    const unknownTech = [], technologyIds = [];
    for (const name of split(values.technologies)) {
      const tech = technologies.find(t => lower(t.name) === lower(name));
      if (tech) { if (!technologyIds.includes(Number(tech.id))) technologyIds.push(Number(tech.id)); } else unknownTech.push(name);
    }
    if (unknownTech.length) { fail(`Unknown technolog${unknownTech.length === 1 ? 'y' : 'ies'}: ${unknownTech.map(n => `"${n}"`).join(', ')}`); continue; }
    const assetIds = [], assetProblems = [];
    if (values.assets) {
      const assets = await assetsOf(customerId);
      for (const name of split(values.assets)) {
        const matches = assets.filter(a => a.names.includes(lower(name)));
        if (matches.length === 1) { if (!assetIds.includes(matches[0].id)) assetIds.push(matches[0].id); }
        else assetProblems.push(matches.length ? `"${name}" matches more than one asset` : `no asset "${name}" for ${customer.name}`);
      }
    }
    if (assetProblems.length) { fail(`Assets: ${assetProblems.join('; ')}`); continue; }

    const followUp = dateOf(raw.follow_up_date);
    if (followUp.error) { fail(`Follow-up date must be a date (YYYY-MM-DD or DD/MM/YYYY), not "${values.follow_up_date}"`); continue; }

    const body = {
      customer_id: customerId, activity_date: date.value, category_id: category.id, subcategory_id: subcategoryId,
      title: values.title || null, start_time: start.value, end_time: end.value, duration_minutes: duration,
      ticket_reference: values.ticket_reference || null, work_location: workLocation, billable_classification: billable,
      technology_ids: technologyIds, asset_ids: assetIds, description: values.description || null,
      follow_up_required: !!followUp.value, follow_up_date: followUp.value,
    };
    // The same checks as the activity form: who may log for the customer, its required fields, dates, times...
    const prepared = await prepareActivityCreate(req, body);
    if (prepared.error) { fail(prepared.error); continue; }

    const key = dedupeKey({ customerId, date: body.activity_date, categoryId: category.id, title: body.title, startTime: body.start_time, duration: body.duration_minutes });
    base.name = `${customer.name} – ${body.title}`;
    if (existing.has(key)) { rows.push({ ...base, action: 'unchanged', error: `Already logged: ${customer.name}, ${body.activity_date}` }); continue; }
    if (seen.has(key)) { fail('The same activity appears earlier in the file', 'duplicate'); continue; }
    seen.add(key);
    rows.push({ ...base, action: 'create', prepared });
  }

  const count = action => rows.filter(r => r.action === action).length;
  const { last } = await db.prepare('SELECT MAX(id) AS last FROM service_activities WHERE engineer_id = ?').get(req.user.id);
  const token = crypto.createHash('sha256').update(`${read.hash}|${req.user.id}|${last || 0}`).digest('hex');
  return { rows, token, counts: { create: count('create'), update: 0, unchanged: count('unchanged'), errors: count('error'),
    duplicates: rows.filter(r => r.kind === 'duplicate').length, total: rows.length } };
}

const previewOf = plan => ({ token: plan.token, counts: plan.counts,
  rows: plan.rows.map(({ row, name, action, kind, error, values }) => ({ row, name, action, kind, error, values: action === 'create' ? undefined : values })) });

/** Saves the new rows of a plan, each on its own: one that fails is reported, the others go in. */
async function commitImport(plan, req) {
  const errors = plan.rows.filter(r => r.action !== 'create').map(r => ({ row: r.row, error: r.error }));
  let imported = 0;
  for (const row of plan.rows.filter(r => r.action === 'create')) {
    try {
      await createActivity(req, row.prepared, { announce: false, auditAction: 'activity_imported' });
      imported++;
    } catch (e) { errors.push({ row: row.row, error: e.message || 'Could not save this activity' }); }
  }
  return { imported, skipped: errors.length, errors };
}

module.exports = { upload, buildTemplate, readWorkbook, planImport, previewOf, commitImport, COLUMNS };
