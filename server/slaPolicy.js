/**
 * The SLAs a manager sets in Settings: each can be switched off, and its time
 * limit changed. Stored as settings 'sla_policy'. Missing values fall back to
 * the long-standing defaults, so nothing changes until a manager changes it.
 */
const db = require('./db');

const SLAS = Object.freeze({
  visit_report: { label: 'Maintenance visit report', unit: 'working days', default: 7, description: 'The engineer submits the visit report within this many working days of the visit.' },
  project_update: { label: 'Project status update', unit: 'days', default: 7, description: 'Every open project gets a status update at least this often.' },
  task_response: { label: 'High-priority task response', unit: 'working days', default: 1, description: 'A high-priority task is picked up (no longer "open") within this many working days.' },
  closure_review: { label: 'Project closure review', unit: 'working days', default: 3, description: 'A manager approves or rejects a closure request within this many working days.' },
  tickets: { label: 'Ticket due dates (Request Tracker)', unit: 'hours warning', default: 24, description: 'Tickets are resolved by their RT due date; flagged as at risk this many hours before it.' },
});

const defaults = () => Object.fromEntries(Object.entries(SLAS).map(([key, sla]) => [key, { enabled: true, limit: sla.default }]));

async function getPolicy(store = db) {
  const row = await store.prepare("SELECT value FROM settings WHERE key='sla_policy'").get();
  let stored = {};
  try { stored = JSON.parse(row?.value || '{}'); } catch { /* defaults */ }
  const policy = defaults();
  for (const key of Object.keys(SLAS)) if (stored[key] && typeof stored[key] === 'object') policy[key] = { ...policy[key], ...stored[key] };
  return policy;
}

function validatePolicy(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('SLA settings are required'), { status: 400 });
  const out = defaults();
  for (const [key, value] of Object.entries(body)) {
    const sla = SLAS[key];
    if (!sla) throw Object.assign(new Error(`Unknown SLA: ${key}`), { status: 400 });
    if (!value || typeof value.enabled !== 'boolean') throw Object.assign(new Error(`${sla.label}: on or off is required`), { status: 400 });
    const limit = Number(value.limit);
    if (!Number.isFinite(limit) || limit <= 0 || limit > 365 * (key === 'tickets' ? 24 : 1)) throw Object.assign(new Error(`${sla.label}: the limit must be a positive number of ${sla.unit}`), { status: 400 });
    out[key] = { enabled: value.enabled, limit: Math.round(limit * 10) / 10 };
  }
  return out;
}

const catalogue = () => Object.entries(SLAS).map(([key, sla]) => ({ key, label: sla.label, unit: sla.unit, default: sla.default, description: sla.description }));

module.exports = { SLAS, getPolicy, validatePolicy, catalogue };
