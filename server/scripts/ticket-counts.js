/**
 * What makes up the "tickets created" and "tickets resolved" figures for a period.
 * Read-only.
 *
 *   docker compose -f docker-compose.yml -f docker-compose.prod.yml exec app \
 *     node scripts/ticket-counts.js 2026-09-01 2026-09-30 [customer id]
 *
 * "Resolved" counts tickets whose Request Tracker resolved date is in the period and
 * whose status is now Resolved or Closed. RT also gives rejected and deleted tickets
 * a resolved date, and keeps it when a ticket is reopened; those are listed apart.
 */
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  });
}

const db = require('../db');
const { decrypt } = require('../fieldCipher');

const [from, to, customerArg] = process.argv.slice(2);
const isDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '');

async function main() {
  if (!isDay(from) || !isDay(to) || (customerArg && !/^\d+$/.test(customerArg))) {
    console.error('Usage: node scripts/ticket-counts.js <from YYYY-MM-DD> <to YYYY-MM-DD> [customer id]');
    process.exit(2);
  }
  const where = customerArg ? 'WHERE customer_id = ?' : '';
  const rows = await db.prepare(`SELECT customer_id, external_ticket_id, normalized_status, status_group, created_at_external, resolved_at_external FROM external_tickets ${where}`)
    .all(...(customerArg ? [Number(customerArg)] : []));
  const day = value => (value ? String(value).slice(0, 10) : null);
  const inPeriod = value => !!value && value >= from && value <= to;

  const created = rows.filter(r => inPeriod(day(r.created_at_external)));
  const dated = rows.filter(r => inPeriod(day(r.resolved_at_external)));
  const done = dated.filter(r => ['Resolved', 'Closed'].includes(r.normalized_status));
  const reopened = dated.filter(r => r.status_group === 'open');
  const notDone = dated.filter(r => r.status_group !== 'open' && !['Resolved', 'Closed'].includes(r.normalized_status));
  const olderDone = done.filter(r => day(r.created_at_external) < from);
  const byStatus = {};
  for (const r of notDone) byStatus[r.normalized_status] = (byStatus[r.normalized_status] || 0) + 1;

  let scope = 'all customers';
  if (customerArg) scope = decrypt((await db.prepare('SELECT name FROM customers WHERE id = ?').get(Number(customerArg)))?.name) || `customer ${customerArg}`;
  console.log(`Tickets ${from} to ${to} (${scope}), ${rows.length} tickets synced in all`);
  console.log(`  Created in the period:                         ${created.length}`);
  console.log(`  Resolved in the period (now Resolved/Closed):  ${done.length}`);
  console.log(`    of which created before the period:          ${olderDone.length}`);
  console.log(`    of which created in the period:              ${done.length - olderDone.length}`);
  console.log('  Also given a resolved date by RT, not counted as resolved:');
  console.log(`    rejected / deleted / other:                  ${notDone.length}${notDone.length ? ` (${Object.entries(byStatus).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}`);
  console.log(`    reopened since (open now):                   ${reopened.length}`);
}

main()
  .then(() => process.exit(0))
  .catch(error => { console.error('ERROR:', error.message); process.exit(1); });
