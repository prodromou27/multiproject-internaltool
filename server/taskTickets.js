/**
 * A task may name a ticket (tasks.ticket_reference, e.g. "12345" or "RT#12345").
 * It is optional: tasks are not tied to tickets. When the reference matches a
 * synced ticket of the task's own customer (external_tickets), the task shows
 * that ticket's subject and state and links to it.
 */
const db = require('./db');

const MAX_LENGTH = 50;

/** Checks a reference from a request: undefined (unchanged), null (none) or text. */
function checkReference(value) {
  if (value === undefined) return { value: undefined };
  if (value === null || value === '') return { value: null };
  if (typeof value !== 'string' || value.trim().length > MAX_LENGTH) return { error: `The ticket reference must be at most ${MAX_LENGTH} characters` };
  return { value: value.trim() || null };
}

/** The ticket number in a reference: "RT#12345", "#12345", "12345" → "12345". */
const numberOf = reference => (String(reference || '').match(/\d+/) || [null])[0];

/** Adds `ticket` ({ number, subject, status_group, url }) to task rows whose reference matches a ticket of their customer. */
async function withTickets(rows, store = db) {
  const wanted = rows.filter(row => row.ticket_reference && row.customer_id && numberOf(row.ticket_reference));
  if (!wanted.length) return rows;
  const numbers = [...new Set(wanted.map(row => numberOf(row.ticket_reference)))];
  const customers = [...new Set(wanted.map(row => Number(row.customer_id)))];
  const tickets = await store.prepare(`SELECT customer_id, ticket_number, subject, status_group, external_url FROM external_tickets
    WHERE ticket_number IN (${numbers.map(() => '?').join(',')}) AND customer_id IN (${customers.map(() => '?').join(',')})`).all(...numbers, ...customers);
  const byKey = new Map(tickets.map(t => [`${Number(t.customer_id)}:${t.ticket_number}`, t]));
  return rows.map(row => {
    const found = row.ticket_reference && row.customer_id ? byKey.get(`${Number(row.customer_id)}:${numberOf(row.ticket_reference)}`) : null;
    return found ? { ...row, ticket: { number: found.ticket_number, subject: found.subject, status_group: found.status_group, url: found.external_url || null } } : row;
  });
}

module.exports = { MAX_LENGTH, checkReference, numberOf, withTickets };
