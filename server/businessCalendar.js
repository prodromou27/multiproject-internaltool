/* The organisation's business calendar (review I10): which weekdays are working
   days, public holidays (once, or every year on the same date), and the travel
   buffer kept between timed visits. Settings → Time & region.

   SLAs measured in working days skip non-working days and holidays. A contract type
   can instead count every day (24x7: the SLA never pauses); Settings → Contract
   types. Visit planning does not offer holidays or non-working days as slots. */
const db = require('./db');
const { currentContract, contractStatus } = require('./customerContracts');

const KEY = 'business_calendar';
const MODES_KEY = 'contract_type_calendars';
const DEFAULTS = Object.freeze({ working_days: [1, 2, 3, 4, 5], holidays: [], travel_buffer_minutes: 30 });
const MAX_HOLIDAYS = 400;
const isDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const weekdayOf = iso => new Date(`${iso.slice(0, 10)}T00:00:00Z`).getUTCDay();
const addDay = iso => new Date(Date.parse(`${iso}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

async function readJson(key, store) {
  const row = await store.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  try { return row ? JSON.parse(row.value) : null; } catch { return null; }
}

/** The calendar with defaults filled in. */
async function load(store = db) {
  const saved = (await readJson(KEY, store)) || {};
  return {
    working_days: Array.isArray(saved.working_days) ? saved.working_days.filter(day => Number.isInteger(day) && day >= 0 && day <= 6) : [...DEFAULTS.working_days],
    holidays: Array.isArray(saved.holidays) ? saved.holidays.filter(h => h && isDay(h.date)) : [],
    travel_buffer_minutes: Number.isInteger(saved.travel_buffer_minutes) ? saved.travel_buffer_minutes : DEFAULTS.travel_buffer_minutes,
  };
}

/** Checks a calendar sent from Settings. */
function validate(body) {
  if (!body || typeof body !== 'object') return { error: 'A calendar is required' };
  const days = body.working_days;
  if (!Array.isArray(days) || !days.length || days.some(day => !Number.isInteger(day) || day < 0 || day > 6) || new Set(days).size !== days.length)
    return { error: 'Choose at least one working day (0 Sunday … 6 Saturday), each once' };
  const holidays = body.holidays ?? [];
  if (!Array.isArray(holidays) || holidays.length > MAX_HOLIDAYS) return { error: `Up to ${MAX_HOLIDAYS} holidays` };
  const seen = new Set(), clean = [];
  for (const holiday of holidays) {
    const name = typeof holiday?.name === 'string' ? holiday.name.trim() : '';
    if (!isDay(holiday?.date)) return { error: 'Each holiday needs a date (YYYY-MM-DD)' };
    if (!name || name.length > 80) return { error: 'Each holiday needs a name of at most 80 characters' };
    const yearly = holiday.yearly === true;
    const key = yearly ? holiday.date.slice(5) : holiday.date;
    if (seen.has(key)) return { error: `${holiday.date} is listed twice` };
    seen.add(key); clean.push({ date: holiday.date, name, yearly });
  }
  const buffer = body.travel_buffer_minutes ?? DEFAULTS.travel_buffer_minutes;
  if (!Number.isInteger(buffer) || buffer < 0 || buffer > 480) return { error: 'The travel buffer must be 0 to 480 minutes' };
  return { value: { working_days: [...days].sort(), holidays: clean.sort((a, b) => a.date.localeCompare(b.date)), travel_buffer_minutes: buffer } };
}

async function save(calendar, store = db) {
  await store.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value').run(KEY, JSON.stringify(calendar));
}

/** The holiday on a date (a yearly one matches any year), or null. */
function holidayOn(date, calendar) {
  const day = date.slice(0, 10), monthDay = day.slice(5);
  return calendar.holidays.find(h => (h.yearly ? h.date.slice(5) === monthDay : h.date === day)) || null;
}

/** Why a day is not a working day ('holiday' with its name, 'non_working_day'), or null when it is one. */
function dayOff(date, calendar) {
  const holiday = holidayOn(date, calendar);
  if (holiday) return { kind: 'holiday', name: holiday.name };
  if (!calendar.working_days.includes(weekdayOf(date))) return { kind: 'non_working_day', name: null };
  return null;
}
const isWorkingDay = (date, calendar) => !dayOff(date, calendar);

/** The holidays from `start` to `end` (inclusive, YYYY-MM-DD), yearly ones on each year's date: [{ date, name }]. */
function holidaysBetween(start, end, calendar) {
  const out = [];
  for (let day = start; day <= end; day = addDay(day)) {
    const holiday = holidayOn(day, calendar);
    if (holiday) out.push({ date: day, name: holiday.name });
  }
  return out;
}

/** Working days after `start` up to and including `end`; `allDays` counts every day (24x7). */
function workingDaysBetween(start, end, calendar, { allDays = false } = {}) {
  const from = String(start).slice(0, 10), to = String(end).slice(0, 10);
  if (to <= from) return 0;
  let count = 0;
  for (let day = addDay(from); day <= to; day = addDay(day)) if (allDays || isWorkingDay(day, calendar)) count += 1;
  return count;
}

/* ── Contract types: does the SLA pause outside working days? ────────────────── */
// 'business': counts working days (pauses on weekends and holidays); 'all_days': never pauses.
const defaultMode = name => (/24\s*[x×]\s*7/i.test(String(name)) ? 'all_days' : 'business');
async function contractModes(store = db) {
  const saved = (await readJson(MODES_KEY, store)) || {};
  return { modeOf: name => (saved[name] === 'all_days' || saved[name] === 'business' ? saved[name] : defaultMode(name)), saved };
}
async function saveContractModes(modes, store = db) {
  await store.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value').run(MODES_KEY, JSON.stringify(modes));
}

/** customer id → 'business' | 'all_days', from each customer's current contract type. */
async function customerModes(store = db, today) {
  const { modeOf } = await contractModes(store);
  const rows = await store.prepare('SELECT customer_id, service_level, start_date, end_date FROM customer_contracts').all();
  const byCustomer = new Map();
  for (const row of rows) {
    const list = byCustomer.get(Number(row.customer_id)) || [];
    list.push({ ...row, status: contractStatus(row, today) });
    byCustomer.set(Number(row.customer_id), list);
  }
  const modes = new Map();
  for (const [customerId, list] of byCustomer) {
    const contract = currentContract(list);
    if (contract?.service_level) modes.set(customerId, modeOf(contract.service_level));
  }
  return { modeFor: customerId => modes.get(Number(customerId)) || 'business' };
}

module.exports = { KEY, DEFAULTS, load, validate, save, holidayOn, holidaysBetween, dayOff, isWorkingDay, workingDaysBetween, contractModes, saveContractModes, customerModes, defaultMode };
