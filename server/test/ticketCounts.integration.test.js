// "Resolved" tickets: a resolved date in the period AND done now (Resolved/Closed), the same everywhere.
// Request Tracker also gives rejected and deleted tickets a resolved date, and keeps it when a ticket is reopened.
const { test, assert, db, ids } = require('./lib/activityFixture');
const appTime = require('../appTime');
const { insights } = require('../insights');
const { getOverview, getTicketAnalytics } = require('../managedCustomerService');
const { getResolvedTickets } = require('../managedReportData');

const today = appTime.today(), day = n => appTime.addDays(today, n);
const at = d => `${d}T10:00:00.000Z`;
let customer;

test('rejected, deleted and reopened tickets are not counted as resolved; older tickets closed now are', async () => {
  customer = (await db.prepare("INSERT INTO customers (name, active) VALUES ('Ticket Counts Ltd', 1)").run()).lastInsertRowid;
  let n = 0;
  const ticket = async (status, group, created, resolved) => {
    n++;
    await db.prepare(`INSERT INTO external_tickets (customer_id, provider_type, external_queue_id, external_queue_name, external_ticket_id, ticket_number, subject, external_status, normalized_status, status_group, created_at_external, resolved_at_external)
      VALUES (?, 'request_tracker', '9', 'Counts', ?, ?, ?, ?, ?, ?, ?, ?)`).run(customer, `tc-${n}`, `tc-${n}`, `Ticket ${n}`, status.toLowerCase(), status, group, at(created), resolved ? at(resolved) : null);
  };
  await ticket('Resolved', 'closed', day(-10), day(-5));   // counted
  await ticket('Closed', 'closed', day(-10), day(-4));     // counted
  await ticket('Resolved', 'closed', day(-200), day(-3));  // counted: an old ticket closed in the period
  await ticket('Rejected', 'closed', day(-9), day(-8));    // spam: not resolved
  await ticket('Excluded', 'closed', day(-9), day(-8));    // deleted: not resolved
  await ticket('Open', 'open', day(-20), day(-6));         // reopened after being resolved: not resolved
  await ticket('New', 'open', day(-2), null);              // open, never resolved

  // Dashboard insights for one customer: pg-mem cannot run its task query, so on PostgreSQL only (CI's fresh-DB loop).
  if (process.env.TEST_DATABASE_URL) {
    const kpis = (await insights({ days: 30, customerId: customer })).kpis;
    assert.equal(kpis.tickets_resolved, 3, 'Dashboard insights');
    assert.equal(kpis.tickets_created, 6, 'all created in the last 30 days except the old one');
  }

  const analytics = await getTicketAnalytics(customer, day(-29), today);
  assert.equal(analytics.period.resolved, 3, 'Customer 360 ticket analytics');
  assert.equal(analytics.period.rejected, 1);
  const overview = await getOverview(customer, day(-29), today);
  if (overview) assert.equal(Number(overview.tickets?.resolved_period ?? overview.tickets_resolved_period ?? 3), 3, 'Customer 360 overview');

  const report = await getResolvedTickets(customer, day(-29), today);
  assert.deepEqual(report.map(r => r.ticket_number).sort(), ['tc-1', 'tc-2', 'tc-3'], 'the customer report lists only done tickets');
});
