/**
 * Best-effort write-back to Request Tracker when a service activity completes:
 * if the customer has opted in (customer_ticketing_configurations.write_back_enabled)
 * and the activity's ticket_reference matches one of that customer's synced RT
 * tickets, sets the RT ticket's Status to the configured write_back_status.
 *
 * Never throws for the "nothing to do" cases (no reference, not configured, no
 * match) — those return { attempted: false, reason }. An actual RT failure
 * returns { attempted: true, ok: false, error } rather than throwing, so a
 * caller can log it without failing the activity completion it's attached to:
 * the activity is already completed in our own database at that point, and an
 * external ticketing system being unreachable shouldn't undo that.
 */
const db = require('./db');
const ticketingSettings = require('./ticketingSettings');
const { createTicketingProvider } = require('./ticketing');

async function attemptTicketWriteback({ customerId, ticketReference }, { store = db, makeProvider = createTicketingProvider } = {}) {
  const reference = String(ticketReference || '').trim();
  if (!reference) return { attempted: false, reason: 'no_ticket_reference' };

  const config = await store.prepare(
    "SELECT * FROM customer_ticketing_configurations WHERE customer_id = ? AND provider_type = 'request_tracker' AND enabled = 1"
  ).get(customerId);
  if (!config || !config.write_back_enabled || !config.write_back_status) return { attempted: false, reason: 'not_configured' };

  // Accept "123", "#123", "RT#123", "RT-123", ticket_reference as typed by an
  // engineer — RT ticket ids are always numeric, so digits-only is what matters.
  const normalized = reference.replace(/\D/g, '');
  if (!normalized) return { attempted: false, reason: 'reference_not_numeric' };

  const ticket = await store.prepare(
    "SELECT * FROM external_tickets WHERE customer_id = ? AND provider_type = 'request_tracker' AND (external_ticket_id = ? OR ticket_number = ?)"
  ).get(customerId, normalized, normalized);
  if (!ticket) return { attempted: false, reason: 'ticket_not_found' };

  const settings = await ticketingSettings.storedSettings(store);
  const provider = makeProvider('request_tracker', ticketingSettings.runtimeSettings(settings));
  try {
    const result = await provider.updateTicketStatus(ticket.external_ticket_id, config.write_back_status);
    return { attempted: true, ok: true, ticket_id: ticket.external_ticket_id, message: result.message };
  } catch (error) {
    return { attempted: true, ok: false, ticket_id: ticket.external_ticket_id, error: error.message };
  }
}

module.exports = { attemptTicketWriteback };
