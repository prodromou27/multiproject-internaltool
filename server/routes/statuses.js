const router = require('express').Router();
const db = require('../db');
const { requireAuth, requireManager } = require('../middleware/auth');

/* ── Default status configuration ───────────────────────── */
const DEFAULT_CONFIG = {
  project: [
    { value: 'not_started',       label: 'Not Started',                  bg: '#f1f5f9', text: '#475569', dot: '#94a3b8', requires_reason: false, is_terminal: false },
    { value: 'in_progress',       label: 'In Progress',                  bg: '#fef9c3', text: '#854d0e', dot: '#eab308', requires_reason: false, is_terminal: false },
    { value: 'waiting_customer',  label: 'Waiting for Customer',         bg: '#fff7ed', text: '#9a3412', dot: '#f97316', requires_reason: true,  is_terminal: false },
    { value: 'waiting_vendor',    label: 'Waiting for Vendor',           bg: '#faf5ff', text: '#6b21a8', dot: '#a855f7', requires_reason: true,  is_terminal: false },
    { value: 'on_hold',           label: 'On Hold',                      bg: '#f1f5f9', text: '#475569', dot: '#94a3b8', requires_reason: false, is_terminal: false },
    { value: 'delayed',           label: 'Delayed',                      bg: '#fee2e2', text: '#991b1b', dot: '#f87171', requires_reason: false, is_terminal: false },
    { value: 'completed_engineer',label: 'Completed by Engineer',        bg: '#dcfce7', text: '#166534', dot: '#22c55e', requires_reason: false, is_terminal: false },
    { value: 'pending_approval',  label: 'Pending Management Approval',  bg: '#fef3c7', text: '#92400e', dot: '#f59e0b', requires_reason: false, is_terminal: false },
    { value: 'closed',            label: 'Closed',                       bg: '#d1fae5', text: '#065f46', dot: '#10b981', requires_reason: false, is_terminal: true  },
    { value: 'reopened',          label: 'Reopened',                     bg: '#dbeafe', text: '#1d4ed8', dot: '#3b82f6', requires_reason: false, is_terminal: false },
    { value: 'cancelled',         label: 'Cancelled',                    bg: '#fee2e2', text: '#991b1b', dot: '#ef4444', requires_reason: false, is_terminal: true  },
  ],
  task: [
    { value: 'open',             label: 'Open',               bg: '#eff6ff', text: '#1e40af', dot: '#3b82f6', requires_reason: false, is_terminal: false },
    { value: 'in_progress',      label: 'In Progress',        bg: '#fef9c3', text: '#854d0e', dot: '#eab308', requires_reason: false, is_terminal: false },
    { value: 'waiting_customer', label: 'Waiting for Customer',bg: '#fff7ed', text: '#9a3412', dot: '#f97316', requires_reason: true,  is_terminal: false },
    { value: 'waiting_vendor',   label: 'Waiting for Vendor', bg: '#faf5ff', text: '#6b21a8', dot: '#a855f7', requires_reason: true,  is_terminal: false },
    { value: 'completed',        label: 'Completed',          bg: '#dcfce7', text: '#166534', dot: '#22c55e', requires_reason: false, is_terminal: false },
    { value: 'pending_approval', label: 'Pending Approval',   bg: '#fef3c7', text: '#92400e', dot: '#f59e0b', requires_reason: false, is_terminal: false },
    { value: 'closed',           label: 'Closed',             bg: '#d1fae5', text: '#065f46', dot: '#10b981', requires_reason: false, is_terminal: true  },
    { value: 'cancelled',        label: 'Cancelled',          bg: '#fee2e2', text: '#991b1b', dot: '#ef4444', requires_reason: false, is_terminal: true  },
  ],
  visit: [
    { value: 'scheduled',  label: 'Scheduled',  bg: '#eff6ff', text: '#1e40af', dot: '#3b82f6', requires_reason: false, is_terminal: false },
    { value: 'in_progress',label: 'In Progress',bg: '#fef9c3', text: '#854d0e', dot: '#eab308', requires_reason: false, is_terminal: false },
    { value: 'completed',  label: 'Completed',  bg: '#dcfce7', text: '#166534', dot: '#22c55e', requires_reason: false, is_terminal: false },
    { value: 'cancelled',  label: 'Cancelled',  bg: '#fee2e2', text: '#991b1b', dot: '#ef4444', requires_reason: false, is_terminal: true  },
  ],
};

router.get('/', requireAuth, (req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key='status_config'").get();
  if (row) {
    try { return res.json(JSON.parse(row.value)); } catch {}
  }
  res.json(DEFAULT_CONFIG);
});

router.put('/', requireManager, (req, res) => {
  const config = req.body;
  if (!config || typeof config !== 'object') return res.status(400).json({ error: 'Invalid config' });
  // Basic validation
  for (const key of ['project', 'task', 'visit']) {
    if (!Array.isArray(config[key])) return res.status(400).json({ error: `Missing ${key} array` });
    for (const s of config[key]) {
      if (!s.value || !s.label) return res.status(400).json({ error: 'Each status needs value and label' });
    }
  }
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('status_config', ?)").run(JSON.stringify(config));
  res.json({ ok: true });
});

module.exports = router;
