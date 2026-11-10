/**
 * Support cases opened with a vendor (Check Point TAC, Fortinet TAC…) on a
 * customer's behalf: case number, severity, status, owner, the next follow-up
 * and the Request Tracker ticket it belongs to, with a history of updates.
 * Routes: routes/customer-vendor-cases.js; the list across customers: routes/renewals.js.
 *
 * An open case "goes quiet" when nothing was recorded on it for QUIET_DAYS. Each
 * morning the owner (else the customer's managers) is reminded of a follow-up that
 * is due, once per follow-up date, and of a quiet case, once per quiet spell.
 */
const db = require('./db');
const appTime = require('./appTime');
const { decrypt } = require('./fieldCipher');

const STATUSES = Object.freeze({ open: 'Open', waiting_vendor: 'Waiting for vendor', waiting_us: 'Waiting for us', resolved: 'Resolved', closed: 'Closed' });
const OPEN = Object.freeze(['open', 'waiting_vendor', 'waiting_us']);
const SEVERITIES = Object.freeze({ critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' });
const QUIET_DAYS = 7;

const dayOf = value => (value ? String(value).slice(0, 10) : null);
const dayNumber = iso => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86400000);

function attention(row, today = appTime.today()) {
  if (!OPEN.includes(row.status)) return null;
  if (row.next_follow_up && row.next_follow_up <= today) return 'follow_up_due';
  const last = dayOf(row.last_update_at);
  if (last && dayNumber(today) - dayNumber(last) >= QUIET_DAYS) return 'quiet';
  return null;
}

function present(row, today = appTime.today()) {
  return {
    id: Number(row.id), customer_id: Number(row.customer_id), asset_id: row.asset_id ? Number(row.asset_id) : null,
    asset_name: row.asset_name ? decrypt(row.asset_name) : null,
    vendor: row.vendor, case_number: row.case_number, subject: decrypt(row.subject),
    severity: row.severity, status: row.status, open: OPEN.includes(row.status),
    owner_id: row.owner_id ? Number(row.owner_id) : null, owner_name: row.owner_name || null,
    rt_ticket: row.rt_ticket || null, rt_url: row.rt_url || null, rt_status: row.rt_status || null,
    next_follow_up: row.next_follow_up || null, opened_on: row.opened_on, closed_on: row.closed_on || null,
    last_update_at: row.last_update_at, attention: attention(row, today),
    quiet_days: row.last_update_at ? dayNumber(today) - dayNumber(dayOf(row.last_update_at)) : null,
    edit_version: Number(row.edit_version || 1),
  };
}

const SELECT = `SELECT v.*, u.name AS owner_name, a.name AS asset_name, t.external_url AS rt_url, t.normalized_status AS rt_status
  FROM vendor_cases v LEFT JOIN users u ON u.id = v.owner_id LEFT JOIN customer_assets a ON a.id = v.asset_id
  LEFT JOIN external_tickets t ON t.customer_id = v.customer_id AND t.external_ticket_id = v.rt_ticket`;

/** Cases of the given customers (null: all); open ones only unless `all`. Open first, then by follow-up and age. */
async function casesFor(customerIds = null, { all = true } = {}, store = db, today = appTime.today()) {
  if (Array.isArray(customerIds) && !customerIds.length) return [];
  const where = [customerIds ? `v.customer_id IN (${customerIds.map(() => '?').join(',')})` : null,
    all ? null : `v.status IN (${OPEN.map(s => `'${s}'`).join(',')})`].filter(Boolean);
  const rows = await store.prepare(`${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY v.opened_on DESC, v.id DESC`).all(...(customerIds || []));
  const order = { follow_up_due: 0, quiet: 1 };
  return rows.map(row => present(row, today)).sort((a, b) => (b.open - a.open)
    || ((order[a.attention] ?? 2) - (order[b.attention] ?? 2))
    || String(a.next_follow_up || '9999').localeCompare(String(b.next_follow_up || '9999')));
}

async function caseById(id, store = db, today = appTime.today()) {
  const row = await store.prepare(`${SELECT} WHERE v.id = ?`).get(id);
  return row ? present(row, today) : null;
}

async function updatesOf(caseId, store = db) {
  const rows = await store.prepare(`SELECT up.id, up.note, up.status_from, up.status_to, up.created_at, u.name AS user_name
    FROM vendor_case_updates up LEFT JOIN users u ON u.id = up.user_id WHERE up.case_id = ? ORDER BY up.created_at DESC, up.id DESC`).all(caseId);
  return rows.map(row => ({ id: Number(row.id), note: decrypt(row.note) || null, status_from: row.status_from || null, status_to: row.status_to || null, created_at: row.created_at, user_name: row.user_name || null }));
}

/** The daily reminders (reminders.js); returns how many were sent. */
async function remind({ store = db, today, wants, firstDelivery, managersFor, notifyUser }) {
  const rows = await store.prepare(`SELECT v.id, v.customer_id, v.vendor, v.case_number, v.subject, v.severity, v.status, v.owner_id, v.next_follow_up, v.last_update_at,
      c.name AS customer_name, mc.service_manager_id, u.active AS owner_active
    FROM vendor_cases v JOIN customers c ON c.id = v.customer_id
    LEFT JOIN users u ON u.id = v.owner_id
    LEFT JOIN managed_customer_configurations mc ON mc.customer_id = v.customer_id AND mc.managed_services_enabled = 1
    WHERE v.status IN (${OPEN.map(s => `'${s}'`).join(',')})`).all();
  let sent = 0;
  for (const row of rows) {
    const reason = attention(row, today);
    if (!reason) continue;
    const customer = decrypt(row.customer_name), subject = decrypt(row.subject), label = `${row.vendor} case ${row.case_number}`;
    const quiet = reason === 'quiet';
    const msg = {
      title: quiet ? `⏳ Vendor case gone quiet` : `🔔 Vendor case follow-up due`,
      body: quiet ? `**${label}** for **${customer}** has had no update for ${QUIET_DAYS}+ days: ${subject}.`
        : `Follow up **${label}** for **${customer}** (due ${row.next_follow_up}): ${subject}.`,
      facts: [{ name: 'Customer', value: customer }, { name: 'Case', value: label }, { name: 'Status', value: STATUSES[row.status] }, { name: 'Severity', value: SEVERITIES[row.severity] }],
    };
    // Once per follow-up date, or per quiet spell (a new update starts a new one).
    const occasion = quiet ? `quiet:${dayOf(row.last_update_at)}` : `follow_up:${row.next_follow_up}`;
    const people = row.owner_id && Number(row.owner_active) === 1 ? [Number(row.owner_id)] : await managersFor(store, row.service_manager_id);
    for (const userId of people) {
      if (!await wants(userId, 'vendor_case_follow_up', store) || !await firstDelivery(store, userId, 'vendor_case_follow_up', row.id, occasion)) continue;
      await notifyUser(userId, 'vendor_case_follow_up', msg, { title: `${customer}: ${label} ${quiet ? 'gone quiet' : 'follow-up due'}`, body: subject,
        link: `/customers/${row.customer_id}/service-profile?section=vendor-cases&case=${row.id}` });
      sent++;
    }
  }
  return sent;
}

module.exports = { STATUSES, OPEN, SEVERITIES, QUIET_DAYS, attention, casesFor, caseById, updatesOf, remind };
