/**
 * A customer's vendor licences, subscriptions (Check Point blades, FortiGuard…)
 * and certificates (SSL, VPN), each with the date it expires.
 * Routes: routes/customer-licences.js; the list across customers: routes/renewals.js.
 *
 * Status from the date: active; expiring in its last 60 days; expired after it.
 * "Not renewing" (the customer decided to let it go) stops the reminders.
 * Reminders go to the customer's service manager (else all managers) 60, 30 and
 * 7 days before, and once after it expires: each is sent once per expiry date, so
 * a renewal (a new date) starts them again, and a missed morning catches up.
 */
const db = require('./db');
const appTime = require('./appTime');
const { decrypt } = require('./fieldCipher');

const KINDS = Object.freeze({ licence: 'Licence', subscription: 'Subscription', certificate: 'Certificate' });
const EXPIRING_DAYS = 60;
const REMIND_AT = Object.freeze([60, 30, 7]);
// An expiry is reported as "expired" for a week after the date, not for ever.
const EXPIRED_NOTICE_DAYS = 7;

const dayNumber = iso => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86400000);
const daysLeft = (expiresOn, today = appTime.today()) => dayNumber(expiresOn) - dayNumber(today);

function licenceStatus(row, today = appTime.today()) {
  const left = daysLeft(row.expires_on, today);
  if (left < 0) return 'expired';
  if (left <= EXPIRING_DAYS) return 'expiring';
  return 'active';
}

function present(row, today = appTime.today()) {
  return {
    id: Number(row.id), customer_id: Number(row.customer_id), asset_id: row.asset_id ? Number(row.asset_id) : null,
    kind: row.kind, name: decrypt(row.name), vendor: row.vendor || null, reference: decrypt(row.reference) || null,
    quantity: row.quantity == null ? null : Number(row.quantity), expires_on: row.expires_on,
    not_renewing: !!Number(row.not_renewing), notes: decrypt(row.notes) || null, renewed_at: row.renewed_at || null,
    status: licenceStatus(row, today), days_left: daysLeft(row.expires_on, today),
    updated_at: row.updated_at, updated_by_name: row.updated_by_name || null, edit_version: Number(row.edit_version || 1),
  };
}

/** Licences of the given customers (null: all), soonest expiry first. */
async function licencesFor(customerIds = null, store = db, today = appTime.today()) {
  if (Array.isArray(customerIds) && !customerIds.length) return [];
  const where = customerIds ? `WHERE l.customer_id IN (${customerIds.map(() => '?').join(',')})` : '';
  const rows = await store.prepare(`SELECT l.*, u.name AS updated_by_name FROM customer_licences l
    LEFT JOIN users u ON u.id = COALESCE(l.updated_by, l.created_by) ${where} ORDER BY l.expires_on, l.id`).all(...(customerIds || []));
  return rows.map(row => present(row, today));
}

// The reminder for today, if one is due: the nearest of 60/30/7 days crossed, or "expired".
function occasionOf(left) {
  if (left < 0) return left >= -EXPIRED_NOTICE_DAYS ? 'expired' : null;
  const crossed = REMIND_AT.filter(days => left <= days);
  return crossed.length ? `${Math.min(...crossed)}_days` : null;
}

/** The daily reminders (reminders.js); returns how many were sent. */
async function remind({ store = db, today, wants, firstDelivery, managersFor, notifyUser, notifyShared }) {
  const rows = await store.prepare(`SELECT l.id, l.customer_id, l.kind, l.name, l.vendor, l.expires_on, c.name AS customer_name, mc.service_manager_id
    FROM customer_licences l JOIN customers c ON c.id = l.customer_id
    LEFT JOIN managed_customer_configurations mc ON mc.customer_id = l.customer_id AND mc.managed_services_enabled = 1
    WHERE c.active = 1 AND l.not_renewing = 0 AND l.expires_on >= ? AND l.expires_on <= ?`)
    .all(appTime.addDays(today, -EXPIRED_NOTICE_DAYS), appTime.addDays(today, Math.max(...REMIND_AT)));
  let sent = 0;
  for (const row of rows) {
    const left = daysLeft(row.expires_on, today), occasion = occasionOf(left);
    if (!occasion) continue;
    const customer = decrypt(row.customer_name), name = decrypt(row.name), kind = KINDS[row.kind] || 'Licence';
    const expired = occasion === 'expired';
    const msg = {
      title: expired ? `⚠️ ${kind} expired` : `🔑 ${kind} expiring`,
      body: expired ? `${kind} **${name}** for **${customer}** expired on ${row.expires_on}.`
        : `${kind} **${name}** for **${customer}** expires on ${row.expires_on} (in ${left} day${left === 1 ? '' : 's'}).`,
      facts: [{ name: 'Customer', value: customer }, { name: kind, value: name }, ...(row.vendor ? [{ name: 'Vendor', value: row.vendor }] : []), { name: 'Expires', value: row.expires_on }],
    };
    const ref = `${row.id}:${row.expires_on}`;
    notifyShared('licence_expiring', msg, { dedupeKey: `${ref}:${occasion}` });
    for (const userId of await managersFor(store, row.service_manager_id)) {
      if (!await wants(userId, 'licence_expiring', store) || !await firstDelivery(store, userId, 'licence_expiring', ref, occasion)) continue;
      await notifyUser(userId, 'licence_expiring', msg, { title: `${customer}: ${kind.toLowerCase()} ${name} ${expired ? 'expired' : 'expiring'}`,
        body: `${expired ? 'Expired' : 'Expires'} ${row.expires_on}`, link: `/customers/${row.customer_id}/service-profile?section=contracts` });
      sent++;
    }
  }
  return sent;
}

module.exports = { KINDS, EXPIRING_DAYS, REMIND_AT, licenceStatus, licencesFor, occasionOf, remind, daysLeft };
