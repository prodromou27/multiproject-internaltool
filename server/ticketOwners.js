/**
 * TeamHub users ↔ Request Tracker users, and each engineer's ticket workload.
 *
 * A manager picks, for a TeamHub user, their RT user (users.ticketing_username)
 * from the users RT lists. For every linked user the app then reads, from RT,
 * the tickets they own in any queue (open now, or resolved in the last 13
 * months) into engineer_tickets, whether or not the queue belongs to a customer.
 * Customer-queue tickets (external_tickets) also get owner_user_id.
 */
const db = require('./db');
const appTime = require('./appTime');
const { decrypt } = require('./fieldCipher');

const key = value => String(value ?? '').trim().toLowerCase();
const HISTORY_MONTHS = 13;

const monthsBack = (iso, months) => {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 - months, 1));
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(d, last));
  return date.toISOString().slice(0, 10);
};

async function rtProvider(store) {
  const settings = require('./ticketingSettings');
  const stored = await settings.storedSettings(store);
  if (!stored.enabled) throw Object.assign(new Error('Request Tracker integration is disabled'), { status: 409 });
  return require('./ticketing').createTicketingProvider('request_tracker', settings.runtimeSettings(stored));
}

// RT's user list changes rarely; it is kept for a few minutes between page loads.
let rtUserCache = null;
async function rtUsers({ refresh = false, provider } = {}) {
  if (!refresh && !provider && rtUserCache && Date.now() - rtUserCache.at < 5 * 60_000) return rtUserCache.rows;
  const rows = await (provider || await rtProvider(db)).getUsers();
  if (!provider) rtUserCache = { at: Date.now(), rows };
  return rows;
}

/** Stores the linked TeamHub user on customer-queue tickets (by RT username). */
async function linkOwners(store = db) {
  const users = await store.prepare('SELECT id, ticketing_username FROM users WHERE active=1 AND ticketing_username IS NOT NULL').all();
  const byName = new Map(users.map(user => [key(user.ticketing_username), Number(user.id)]));
  const owners = await store.prepare('SELECT DISTINCT owner_external_id FROM external_tickets WHERE owner_external_id IS NOT NULL').all();
  for (const { owner_external_id: owner } of owners) {
    const userId = byName.get(key(owner)) ?? null;
    await store.prepare('UPDATE external_tickets SET owner_user_id=? WHERE owner_external_id=? AND COALESCE(owner_user_id,0)<>?').run(userId, owner, userId ?? 0);
  }
}

/** Reads one linked user's tickets from RT into engineer_tickets. */
async function syncEngineer(userId, { provider, store = db, today = appTime.today() } = {}) {
  const user = await store.prepare('SELECT id, ticketing_username FROM users WHERE id=? AND active=1').get(userId);
  if (!user?.ticketing_username) return { tickets: 0 };
  try {
    const client = provider || await rtProvider(store);
    const { normalizeStatus, normalizeDate } = require('./ticketSync');
    const mappings = await require('./ticketMappings').loadMappings(store);
    const tickets = await client.getOwnedTickets(user.ticketing_username, { since: monthsBack(today, HISTORY_MONTHS) });
    await store.transaction(async tx => {
      await tx.prepare('DELETE FROM engineer_tickets WHERE user_id=?').run(user.id);
      const upsert = tx.prepare(`INSERT INTO engineer_tickets (external_ticket_id, user_id, queue_name, subject, external_status, normalized_status, status_group, created_at_external, resolved_at_external, synced_at)
        VALUES (?,?,?,?,?,?,?,?,?,app_now()) ON CONFLICT (external_ticket_id) DO UPDATE SET user_id=EXCLUDED.user_id, queue_name=EXCLUDED.queue_name, subject=EXCLUDED.subject,
        external_status=EXCLUDED.external_status, normalized_status=EXCLUDED.normalized_status, status_group=EXCLUDED.status_group,
        created_at_external=EXCLUDED.created_at_external, resolved_at_external=EXCLUDED.resolved_at_external, synced_at=app_now()`);
      for (const ticket of tickets) {
        const id = String(ticket.id ?? '');
        if (!/^\d+$/.test(id)) continue;
        const status = normalizeStatus(ticket.Status || ticket.status, mappings);
        const queue = ticket.Queue && typeof ticket.Queue === 'object' ? ticket.Queue.Name || ticket.Queue.id : ticket.Queue;
        await upsert.run(id, user.id, queue ? String(queue).slice(0, 500) : null, String(ticket.Subject || `Ticket ${id}`).slice(0, 2000), status.external, status.normalized, status.group,
          normalizeDate(ticket.Created), normalizeDate(ticket.Resolved));
      }
      await tx.prepare('UPDATE users SET ticketing_synced_at=app_now(), ticketing_sync_error=NULL WHERE id=?').run(user.id);
    });
    return { tickets: tickets.length };
  } catch (error) {
    const message = error.status ? String(error.message).slice(0, 1000) : 'Could not read tickets from Request Tracker';
    await store.prepare('UPDATE users SET ticketing_sync_error=? WHERE id=?').run(message, user.id);
    throw error;
  }
}

/** Every linked user, one after another; one failure does not stop the rest. */
async function syncAllEngineers({ provider, store = db } = {}) {
  const users = await store.prepare('SELECT id FROM users WHERE active=1 AND ticketing_username IS NOT NULL ORDER BY ticketing_synced_at NULLS FIRST, id').all();
  let synced = 0, failed = 0;
  for (const user of users) {
    try { await syncEngineer(Number(user.id), { provider, store }); synced++; } catch { failed++; }
  }
  return { synced, failed };
}

/** TeamHub users with their RT user, when it was last read and what they own. */
async function listLinks(store = db, today = appTime.today()) {
  const [users, counts] = await Promise.all([
    store.prepare('SELECT id, name, email, role, ticketing_username, ticketing_synced_at, ticketing_sync_error FROM users WHERE active=1 ORDER BY name, id').all(),
    store.prepare(`SELECT user_id, SUM(CASE WHEN status_group='open' THEN 1 ELSE 0 END) AS open_tickets,
        SUM(CASE WHEN normalized_status IN ('Resolved','Closed') AND substr(resolved_at_external,1,10)>=? THEN 1 ELSE 0 END) AS resolved_3m
      FROM engineer_tickets GROUP BY user_id`).all(monthsBack(today, 3)),
  ]);
  const byUser = new Map(counts.map(row => [Number(row.user_id), row]));
  return { rows: users.map(user => ({ id: Number(user.id), name: user.name, email: user.email || null, role: user.role, rt_username: user.ticketing_username || null,
    synced_at: user.ticketing_synced_at || null, sync_error: user.ticketing_sync_error || null,
    open_tickets: Number(byUser.get(Number(user.id))?.open_tickets || 0), resolved_3m: Number(byUser.get(Number(user.id))?.resolved_3m || 0) })) };
}

/** Links a TeamHub user to an RT user (or unlinks with username null). One RT user belongs to one TeamHub user. */
async function setLink(userId, username, store = db) {
  const name = username === null || username === undefined ? null : String(username).trim();
  if (name !== null && (!name || name.length > 200 || key(name) === 'nobody' || /['\\\r\n]/.test(name))) throw Object.assign(new Error('Choose a Request Tracker user'), { status: 400 });
  const user = await store.prepare('SELECT id, ticketing_username FROM users WHERE id=? AND active=1').get(userId);
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  if (name) {
    const taken = (await store.prepare('SELECT id, name, ticketing_username FROM users WHERE ticketing_username IS NOT NULL AND id<>?').all(userId)).find(row => key(row.ticketing_username) === key(name));
    if (taken) throw Object.assign(new Error(`${name} is already linked to ${taken.name}`), { status: 409 });
  }
  const changed = key(user.ticketing_username) !== key(name);
  await store.transaction(async tx => {
    await tx.prepare('UPDATE users SET ticketing_username=? WHERE id=?').run(name, userId);
    if (changed) {
      await tx.prepare('DELETE FROM engineer_tickets WHERE user_id=?').run(userId);
      await tx.prepare('UPDATE users SET ticketing_synced_at=NULL, ticketing_sync_error=NULL WHERE id=?').run(userId);
    }
  });
  await linkOwners(store);
  return { changed };
}

const RESOLVED = "normalized_status IN ('Resolved','Closed')";

/**
 * Tickets resolved per linked engineer over the last `months` months (any RT
 * queue), by month, with how long they took, what they own now, and the
 * customers (or RT queues) the work was for. `userId` limits it to one.
 */
async function workload({ months = 3, userId = null, today = appTime.today() } = {}, store = db) {
  const from = monthsBack(today, months);
  const monthKeys = [];
  for (let month = from.slice(0, 7); month <= today.slice(0, 7);) {
    monthKeys.push(month);
    const [y, m] = month.split('-').map(Number);
    month = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  }
  const only = userId ? ' AND t.user_id=?' : '';
  const args = userId ? [userId] : [];
  const [resolved, open, users, customers, unlinked] = await Promise.all([
    store.prepare(`SELECT t.user_id, t.queue_name, e.customer_id, t.created_at_external, t.resolved_at_external FROM engineer_tickets t
      LEFT JOIN external_tickets e ON e.external_ticket_id=t.external_ticket_id AND e.provider_type='request_tracker'
      WHERE t.${RESOLVED} AND substr(t.resolved_at_external,1,10)>=? AND substr(t.resolved_at_external,1,10)<=?${only}`).all(from, today, ...args),
    store.prepare(`SELECT t.user_id, COUNT(*) AS count FROM engineer_tickets t WHERE t.status_group='open'${only} GROUP BY t.user_id`).all(...args),
    store.prepare(`SELECT id, name, role, ticketing_username, ticketing_synced_at, ticketing_sync_error FROM users WHERE active=1 AND ticketing_username IS NOT NULL${userId ? ' AND id=?' : ''} ORDER BY name`).all(...args),
    store.prepare('SELECT id, name FROM customers').all(),
    userId ? Promise.resolve([]) : store.prepare("SELECT id FROM users WHERE active=1 AND role='engineer' AND ticketing_username IS NULL").all(),
  ]);
  const customerName = new Map(customers.map(row => [Number(row.id), decrypt(row.name)]));
  const openBy = new Map(open.map(row => [Number(row.user_id), Number(row.count)]));
  const engineers = users.map(user => {
    const mine = resolved.filter(row => Number(row.user_id) === Number(user.id));
    const byMonth = new Map(monthKeys.map(month => [month, 0]));
    const perTarget = new Map();
    let days = 0, timed = 0;
    for (const row of mine) {
      const month = String(row.resolved_at_external).slice(0, 7);
      if (byMonth.has(month)) byMonth.set(month, byMonth.get(month) + 1);
      // The customer when the queue is one of theirs, the RT queue otherwise.
      const label = row.customer_id ? customerName.get(Number(row.customer_id)) || `Customer ${row.customer_id}` : row.queue_name || 'Unknown queue';
      perTarget.set(label, (perTarget.get(label) || 0) + 1);
      const took = (Date.parse(row.resolved_at_external) - Date.parse(row.created_at_external)) / 86400000;
      if (Number.isFinite(took) && took >= 0) { days += took; timed++; }
    }
    return { id: Number(user.id), name: user.name, role: user.role, rt_username: user.ticketing_username, synced_at: user.ticketing_synced_at || null, sync_error: user.ticketing_sync_error || null,
      resolved: mine.length, open_now: openBy.get(Number(user.id)) || 0, avg_days_to_resolve: timed ? Math.round(days / timed * 10) / 10 : null,
      by_month: [...byMonth].map(([month, count]) => ({ month, count })),
      customers: [...perTarget].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)) };
  }).sort((a, b) => b.resolved - a.resolved || a.name.localeCompare(b.name));
  return { from, to: today, months: monthKeys, engineers, unlinked_engineers: unlinked.length };
}

module.exports = { HISTORY_MONTHS, monthsBack, rtUsers, linkOwners, syncEngineer, syncAllEngineers, listLinks, setLink, workload };
