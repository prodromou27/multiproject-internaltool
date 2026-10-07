/**
 * Request Tracker users ↔ TeamHub users. A ticket's RT owner (their RT
 * username) is linked to a TeamHub user, either because a manager chose it
 * (users.ticketing_username) or automatically when the RT user's email is a
 * TeamHub user's email. The link is stored on each ticket (owner_user_id), so
 * workload and reports can count tickets per engineer.
 */
const db = require('./db');
const appTime = require('./appTime');
const { decrypt } = require('./fieldCipher');

// RT's placeholder for "no owner".
const UNOWNED = new Set(['nobody', '']);
const key = value => String(value ?? '').trim().toLowerCase();

async function rtOwners(store) {
  const rows = await store.prepare(`SELECT owner_external_id, MAX(owner_name) AS owner_name, MAX(owner_email) AS owner_email, COUNT(*) AS tickets,
      SUM(CASE WHEN status_group='open' THEN 1 ELSE 0 END) AS open_tickets, MAX(owner_user_id) AS owner_user_id
    FROM external_tickets WHERE owner_external_id IS NOT NULL GROUP BY owner_external_id`).all();
  return rows.filter(row => !UNOWNED.has(key(row.owner_external_id)));
}

/** Who each RT user is: { user_id, how: 'chosen' | 'email' } or null. */
function resolver(users) {
  const byUsername = new Map(), byEmail = new Map();
  for (const user of users) {
    if (user.ticketing_username) byUsername.set(key(user.ticketing_username), user.id);
    if (user.email) byEmail.set(key(user.email), user.id);
  }
  return owner => {
    const chosen = byUsername.get(key(owner.owner_external_id));
    if (chosen) return { user_id: chosen, how: 'chosen' };
    const byMail = owner.owner_email && byEmail.get(key(owner.owner_email));
    // The RT username may itself be an email address.
    const byName = byEmail.get(key(owner.owner_external_id));
    return byMail ? { user_id: byMail, how: 'email' } : byName ? { user_id: byName, how: 'email' } : null;
  };
}

/** Stores the TeamHub user on every ticket; run after each sync and after a link changes. */
async function linkOwners(store = db) {
  const users = await store.prepare('SELECT id, email, ticketing_username FROM users WHERE active=1').all();
  const resolve = resolver(users);
  let changed = 0;
  for (const owner of await rtOwners(store)) {
    const match = resolve(owner);
    const result = await store.prepare('UPDATE external_tickets SET owner_user_id=? WHERE owner_external_id=? AND COALESCE(owner_user_id,0)<>?')
      .run(match ? match.user_id : null, owner.owner_external_id, match ? match.user_id : 0);
    changed += Number(result.changes || 0);
  }
  // Tickets nobody owns are never anyone's.
  await store.prepare("UPDATE external_tickets SET owner_user_id=NULL WHERE owner_user_id IS NOT NULL AND (owner_external_id IS NULL OR LOWER(owner_external_id)='nobody')").run();
  return changed;
}

/** The RT users seen on tickets, with who they are in TeamHub. */
async function listOwners(store = db) {
  const users = await store.prepare('SELECT id, name, email, role, ticketing_username FROM users WHERE active=1 ORDER BY name').all();
  const resolve = resolver(users);
  const names = new Map(users.map(user => [user.id, user.name]));
  const rows = (await rtOwners(store)).map(owner => {
    const match = resolve(owner);
    return { username: owner.owner_external_id, name: owner.owner_name, email: owner.owner_email || null, tickets: Number(owner.tickets), open_tickets: Number(owner.open_tickets),
      user_id: match?.user_id ?? null, user_name: match ? names.get(match.user_id) : null, linked_by: match?.how ?? null };
  }).sort((a, b) => Number(!!a.user_id) - Number(!!b.user_id) || b.tickets - a.tickets || a.username.localeCompare(b.username));
  return { rows, users: users.map(({ id, name, role }) => ({ id, name, role })) };
}

/** Links an RT username to a TeamHub user (or removes the chosen link with userId null). */
async function setOwner(username, userId, store = db) {
  const name = String(username ?? '').trim();
  if (!name || name.length > 500 || UNOWNED.has(key(name))) throw Object.assign(new Error('Choose a Request Tracker user'), { status: 400 });
  await store.transaction(async tx => {
    // One RT user is one TeamHub user, and one TeamHub user one RT user.
    for (const row of await tx.prepare('SELECT id, ticketing_username FROM users WHERE ticketing_username IS NOT NULL').all())
      if (key(row.ticketing_username) === key(name) || (userId && Number(row.id) === Number(userId)))
        await tx.prepare('UPDATE users SET ticketing_username=NULL WHERE id=?').run(row.id);
    if (userId) {
      const user = await tx.prepare('SELECT id FROM users WHERE id=? AND active=1').get(userId);
      if (!user) throw Object.assign(new Error('That TeamHub user was not found'), { status: 400 });
      await tx.prepare('UPDATE users SET ticketing_username=? WHERE id=?').run(name, userId);
    }
  });
  await linkOwners(store);
}

const monthsBack = (iso, months) => {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 - months, 1));
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(d, last));
  return date.toISOString().slice(0, 10);
};
const RESOLVED = "normalized_status IN ('Resolved','Closed')";

/**
 * Tickets resolved per engineer over the last `months` months, by month, with
 * how long they took and what each engineer owns now. `userId` limits it to one.
 */
async function workload({ months = 3, userId = null, today = appTime.today() } = {}, store = db) {
  const from = monthsBack(today, months);
  const monthKeys = [];
  for (let month = from.slice(0, 7); month <= today.slice(0, 7);) {
    monthKeys.push(month);
    const [y, m] = month.split('-').map(Number);
    month = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  }
  const only = userId ? ' AND owner_user_id=?' : '';
  const args = userId ? [userId] : [];
  const [resolved, open, users, customers, unlinked] = await Promise.all([
    store.prepare(`SELECT owner_user_id, customer_id, created_at_external, resolved_at_external FROM external_tickets
      WHERE owner_user_id IS NOT NULL AND ${RESOLVED} AND substr(resolved_at_external,1,10)>=? AND substr(resolved_at_external,1,10)<=?${only}`).all(from, today, ...args),
    store.prepare(`SELECT owner_user_id, COUNT(*) AS count FROM external_tickets WHERE owner_user_id IS NOT NULL AND status_group='open'${only} GROUP BY owner_user_id`).all(...args),
    store.prepare(`SELECT id, name, role FROM users WHERE active=1 AND (ticketing_username IS NOT NULL OR id IN (SELECT DISTINCT owner_user_id FROM external_tickets WHERE owner_user_id IS NOT NULL))${userId ? ' AND id=?' : ''} ORDER BY name`).all(...args),
    store.prepare('SELECT id, name FROM customers').all(),
    userId ? Promise.resolve([]) : store.prepare(`SELECT owner_external_id, COUNT(*) AS count FROM external_tickets
      WHERE owner_user_id IS NULL AND owner_external_id IS NOT NULL AND LOWER(owner_external_id)<>'nobody' AND ${RESOLVED} AND substr(resolved_at_external,1,10)>=? GROUP BY owner_external_id`).all(from),
  ]);
  const customerName = new Map(customers.map(row => [Number(row.id), decrypt(row.name)]));
  const openBy = new Map(open.map(row => [Number(row.owner_user_id), Number(row.count)]));
  const engineers = users.map(user => {
    const mine = resolved.filter(row => Number(row.owner_user_id) === Number(user.id));
    const byMonth = new Map(monthKeys.map(month => [month, 0]));
    const perCustomer = new Map();
    let days = 0, timed = 0;
    for (const row of mine) {
      const month = String(row.resolved_at_external).slice(0, 7);
      if (byMonth.has(month)) byMonth.set(month, byMonth.get(month) + 1);
      perCustomer.set(Number(row.customer_id), (perCustomer.get(Number(row.customer_id)) || 0) + 1);
      const took = (Date.parse(row.resolved_at_external) - Date.parse(row.created_at_external)) / 86400000;
      if (Number.isFinite(took) && took >= 0) { days += took; timed++; }
    }
    return { id: Number(user.id), name: user.name, role: user.role, resolved: mine.length, open_now: openBy.get(Number(user.id)) || 0,
      avg_days_to_resolve: timed ? Math.round(days / timed * 10) / 10 : null,
      by_month: [...byMonth].map(([month, count]) => ({ month, count })),
      customers: [...perCustomer].map(([id, count]) => ({ id, name: customerName.get(id) || `Customer ${id}`, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)) };
  }).sort((a, b) => b.resolved - a.resolved || a.name.localeCompare(b.name));
  return { from, to: today, months: monthKeys, engineers,
    unlinked: { owners: unlinked.length, resolved: unlinked.reduce((sum, row) => sum + Number(row.count), 0) } };
}

module.exports = { linkOwners, listOwners, setOwner, workload, monthsBack };
