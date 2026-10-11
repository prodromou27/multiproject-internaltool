/**
 * Customer contracts: status from the dates, and reading contracts with the
 * assets they cover. Routes: routes/customer-contracts.js.
 *
 * A contract is upcoming before its start date, ending soon in its last 30 days,
 * expired after its end date, and renewed once a renewal has been added (the
 * renewal carries on as its own contract).
 */
const db = require('./db');
const appTime = require('./appTime');
const { decrypt } = require('./fieldCipher');

const ENDING_SOON_DAYS = 30;
const SERVICE_LEVELS = Object.freeze(['24x7', '12x5', '8x5']);

const dayNumber = iso => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86400000);

function contractStatus(contract, today = appTime.today(), renewed = false) {
  if (renewed) return 'renewed';
  if (contract.end_date < today) return 'expired';
  if (contract.start_date > today) return 'upcoming';
  if (contract.end_date <= appTime.addDays(today, ENDING_SOON_DAYS)) return 'ending_soon';
  return 'active';
}

// Which of several contracts describes the customer now: one in force (the one
// ending last), else the next upcoming one, else the one that ended most recently.
function currentContract(contracts) {
  const live = contracts.filter(c => ['active', 'ending_soon'].includes(c.status)).sort((a, b) => b.end_date.localeCompare(a.end_date));
  if (live.length) return live[0];
  const upcoming = contracts.filter(c => c.status === 'upcoming').sort((a, b) => a.start_date.localeCompare(b.start_date));
  if (upcoming.length) return upcoming[0];
  return [...contracts].sort((a, b) => b.end_date.localeCompare(a.end_date))[0] || null;
}

function present(row, renewedIds, today) {
  const status = contractStatus(row, today, renewedIds.has(Number(row.id)));
  return {
    id: Number(row.id), customer_id: Number(row.customer_id),
    reference: decrypt(row.reference) || null, description: decrypt(row.description) || null,
    service_level: row.service_level || null, start_date: row.start_date, end_date: row.end_date,
    notes: decrypt(row.notes) || null, renewed_from_id: row.renewed_from_id ? Number(row.renewed_from_id) : null,
    status, days_left: dayNumber(row.end_date) - dayNumber(today),
    updated_at: row.updated_at, updated_by_name: row.updated_by_name || null,
  };
}

// All contracts of the given customers (or all customers), with status.
async function contractsFor(customerIds = null, store = db, today = appTime.today()) {
  if (Array.isArray(customerIds) && !customerIds.length) return [];
  const where = customerIds ? `WHERE customer_id IN (${customerIds.map(() => '?').join(',')})` : '';
  const rows = await store.prepare(`SELECT * FROM customer_contracts ${where} ORDER BY end_date DESC, id DESC`).all(...(customerIds || []));
  const userIds = [...new Set(rows.map(r => r.updated_by || r.created_by).filter(Boolean).map(Number))];
  const names = userIds.length ? new Map((await store.prepare(`SELECT id, name FROM users WHERE id IN (${userIds.map(() => '?').join(',')})`).all(...userIds))
    .map(u => [Number(u.id), u.name])) : new Map();
  for (const row of rows) row.updated_by_name = names.get(Number(row.updated_by || row.created_by)) || null;
  const renewedIds = new Set(rows.filter(r => r.renewed_from_id).map(r => Number(r.renewed_from_id)));
  return rows.map(row => present(row, renewedIds, today));
}

module.exports = { ENDING_SOON_DAYS, SERVICE_LEVELS, contractStatus, currentContract, contractsFor };
