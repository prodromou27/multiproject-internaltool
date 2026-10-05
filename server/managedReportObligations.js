/**
 * Reporting obligations: for each managed customer with a reporting frequency,
 * the most recent complete period a report is owed for, when it is due, and how
 * far the report for that period has got (not started -> draft -> in review ->
 * approved -> final -> sent to the customer).
 */
const db = require('./db');

// Days after the end of a period by which its report should reach the customer,
// unless the customer's configuration sets its own (report_due_days).
const REPORT_DUE_DAYS = 10;
const MAX_REPORT_DUE_DAYS = 120;
const dueDaysFor = value => (Number.isSafeInteger(Number(value)) && value !== null && value !== '' && Number(value) >= 0 && Number(value) <= MAX_REPORT_DUE_DAYS ? Number(value) : REPORT_DUE_DAYS);
const MONTHS_PER_PERIOD = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// The furthest a report for the period has got; a later stage wins over an earlier one.
const STAGES = ['not_started', 'draft', 'in_review', 'approved', 'final', 'sent'];

const pad = value => String(value).padStart(2, '0');
const day = (year, monthIndex, date) => { const value = new Date(Date.UTC(year, monthIndex, date)); return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`; };
const addDays = (iso, days) => { const value = new Date(`${iso}T00:00:00.000Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };

function label(frequency, year, startMonth) {
  if (frequency === 'monthly') return `${MONTH_NAMES[startMonth]} ${year}`;
  if (frequency === 'quarterly') return `Q${startMonth / 3 + 1} ${year}`;
  if (frequency === 'semiannual') return `${startMonth ? 'H2' : 'H1'} ${year}`;
  return String(year);
}

/** The period that starts `offset` periods after the one containing `today` (offset -1 = the last complete one). */
function periodFor(frequency, today, offset = -1, dueDays = REPORT_DUE_DAYS) {
  const months = MONTHS_PER_PERIOD[String(frequency || '').toLowerCase()];
  if (!months || !/^\d{4}-\d{2}-\d{2}$/.test(String(today || ''))) return null;
  const [year, month] = today.split('-').map(Number);
  const currentStart = Math.floor((month - 1) / months) * months;
  const start = new Date(Date.UTC(year, currentStart + offset * months, 1));
  const startYear = start.getUTCFullYear(), startMonth = start.getUTCMonth();
  const from = day(startYear, startMonth, 1), to = day(startYear, startMonth + months, 0);
  return { frequency: frequency.toLowerCase(), from, to, label: label(frequency.toLowerCase(), startYear, startMonth), due_date: addDays(to, dueDaysFor(dueDays)) };
}

/**
 * Obligations for the given customers ({ id, reporting_frequency, managed_since, report_due_days }),
 * keyed by customer id. A customer whose managed service began after the last
 * complete period owes nothing yet; `next` names the first period it will.
 */
async function obligations(customers, store = db) {
  const result = new Map();
  const relevant = customers.filter(customer => MONTHS_PER_PERIOD[String(customer.reporting_frequency || '').toLowerCase()]);
  if (!relevant.length) return result;
  const { today } = await store.prepare('SELECT app_today() AS today').get();
  const ids = relevant.map(customer => Number(customer.id));
  const reports = await store.prepare(`SELECT id, customer_id, period_start, period_end, workflow_status, sent_at
    FROM managed_report_history WHERE customer_id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  for (const customer of relevant) {
    const period = periodFor(customer.reporting_frequency, today, -1, customer.report_due_days);
    const since = customer.managed_since ? String(customer.managed_since).slice(0, 10) : null;
    if (since && since > period.to) { result.set(Number(customer.id), { ...period, status: 'not_yet_due', overdue: false, report_id: null, next: periodFor(customer.reporting_frequency, today, 0, customer.report_due_days) }); continue; }
    let best = null;
    for (const report of reports) {
      if (Number(report.customer_id) !== Number(customer.id) || report.period_start > period.from || report.period_end < period.to) continue;
      const stage = report.sent_at ? 'sent' : report.workflow_status;
      if (!best || STAGES.indexOf(stage) > STAGES.indexOf(best.stage)) best = { stage, id: Number(report.id) };
    }
    const status = best?.stage || 'not_started';
    result.set(Number(customer.id), { ...period, status, overdue: status !== 'sent' && today > period.due_date, report_id: best?.id || null });
  }
  return result;
}

module.exports = { REPORT_DUE_DAYS, MAX_REPORT_DUE_DAYS, STAGES, periodFor, obligations };
