/**
 * Service Activity status-config lookup — shared by routes/serviceActivities.js
 * (create/update/complete/duplicate) and routes/sla.js (per-team SLA evaluation),
 * so both agree on what "the terminal Completed value" and "the initial value"
 * currently are, per whatever a manager has configured under Status Workflow.
 */
const db = require('./db');

const TERMINAL_COMPLETED_FALLBACK = 'completed';

async function getStatusConfig() {
  const row = await db.prepare("SELECT value FROM settings WHERE key='status_config'").get();
  if (!row) return [];
  try { return JSON.parse(row.value).service_activity || []; } catch { return []; }
}

// Accepts an already-fetched statuses array when the caller has one (avoids a
// redundant settings-table round trip on the hot create/update paths); falls
// back to fetching it itself otherwise.
async function terminalCompletedValue(statuses) {
  const list = statuses || await getStatusConfig();
  const completed = list.find(s => s.is_terminal && /complet/i.test(s.value));
  return completed?.value || TERMINAL_COMPLETED_FALLBACK;
}

module.exports = { TERMINAL_COMPLETED_FALLBACK, getStatusConfig, terminalCompletedValue };
