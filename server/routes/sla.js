const router = require('express').Router();
const db = require('../db');
const { requireManager } = require('../middleware/auth');
const { decrypt } = require('../fieldCipher');
const { workingDaysBetween } = require('../workingDays');
const { getPolicy, validatePolicy, catalogue } = require('../slaPolicy');
const { logAudit } = require('../auditLog');

// The SLAs and their limits, as set in Settings (slaPolicy.js).
router.get('/policy', requireManager, async (req, res) => res.json({ policy: await getPolicy(), slas: catalogue() }));
router.put('/policy', requireManager, async (req, res) => {
  try {
    const policy = validatePolicy(req.body);
    await db.prepare("INSERT INTO settings (key, value) VALUES ('sla_policy', ?) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value").run(JSON.stringify(policy));
    await logAudit(db, req, 'settings', 'sla_policy', 'SLA settings', 'sla_policy_updated', Object.entries(policy).map(([key, value]) => `${key}=${value.enabled ? value.limit : 'off'}`).join('; '));
    res.json({ policy, slas: catalogue() });
  } catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'Could not save the SLA settings' }); }
});

router.get('/overview', requireManager, async (req, res) => {
  const today = (await db.prepare('SELECT app_today() AS d').get()).d;
  const policy = await getPolicy();
  // A switched-off SLA is reported as such, with nothing in it.
  const on = key => policy[key].enabled;

  // ── 1. MV Report Complete SLA (working days from scheduled_date) ─────
  const MV_SLA = policy.visit_report.limit;
  const allMVs = !on('visit_report') ? [] : (await db.prepare(`
    SELECT mv.id, mv.title, mv.scheduled_date, mv.report_sent, mv.report_sent_at,
           mv.report_sent_to_customer, mv.status,
           c.name AS customer_name,
           (SELECT string_agg(u.name, ', ')
            FROM maintenance_visit_engineers mve JOIN users u ON mve.user_id = u.id
            WHERE mve.visit_id = mv.id) AS engineer_names
    FROM maintenance_visits mv
    JOIN customers c ON mv.customer_id = c.id
    WHERE mv.status != 'cancelled'
  `).all());

  const mvItems = allMVs.map(mv => {
    // If report already complete, measure days to completion; otherwise days elapsed so far
    const refDate = (mv.report_sent && mv.report_sent_at) ? mv.report_sent_at.slice(0, 10) : today;
    const wd = workingDaysBetween(mv.scheduled_date, refDate);
    return {
      id: mv.id,
      title: mv.title,
      customer_name: decrypt(mv.customer_name),
      engineer_names: mv.engineer_names,
      scheduled_date: mv.scheduled_date,
      report_sent: mv.report_sent,
      report_sent_at: mv.report_sent_at,
      report_sent_to_pm: mv.report_sent_to_customer,
      status: mv.status,
      working_days: wd,
      // "Breached" = pending (not yet sent) and past the deadline
      breached: !mv.report_sent && wd > MV_SLA,
      // "At risk" = pending and 1 working day left
      at_risk: !mv.report_sent && wd >= MV_SLA - 1 && wd <= MV_SLA,
      // "Late complete" = was completed but took more than SLA days
      late_complete: mv.report_sent && wd > MV_SLA,
    };
  });

  // ── 2. Project Status Update SLA (every N calendar days) ─────────────
  const PROJ_SLA = policy.project_update.limit;
  const activeProjects = !on('project_update') ? [] : (await db.prepare(`
    SELECT p.id, p.title, p.status, p.created_at,
      (SELECT MAX(psu.created_at) FROM project_status_updates psu
       WHERE psu.project_id = p.id) AS last_status_update
    FROM projects p
    WHERE p.status NOT IN ('closed', 'cancelled', 'pending_approval')
  `).all());

  const projItems = activeProjects.map(p => {
    const lastUpdate = (p.last_status_update || p.created_at).slice(0, 10);
    const daysSince  = Math.floor((new Date(today + 'T12:00:00') - new Date(lastUpdate + 'T12:00:00')) / 86400000);
    return {
      id: p.id,
      title: p.title,
      status: p.status,
      last_update: p.last_status_update || p.created_at,
      days_since: daysSince,
      breached: daysSince > PROJ_SLA,
      at_risk:  daysSince >= PROJ_SLA - 1 && daysSince <= PROJ_SLA,
    };
  });

  // ── 3. High-priority task first response (N working days) ────────────
  const TASK_SLA = policy.task_response.limit;
  const highPriTasks = !on('task_response') ? [] : (await db.prepare(`
    SELECT t.id, t.title, t.created_at, t.status,
           p.title AS project_title,
           u.name  AS assigned_to_name
    FROM tasks t
    LEFT JOIN projects p ON t.project_id = p.id
    LEFT JOIN users u ON t.assigned_to = u.id
    WHERE t.priority = 'high' AND t.status = 'open'
  `).all());

  const taskItems = highPriTasks.map(t => {
    const wd = workingDaysBetween(t.created_at.slice(0, 10), today);
    return {
      id: t.id,
      title: t.title,
      project_title: t.project_title,
      assigned_to_name: t.assigned_to_name,
      created_at: t.created_at,
      working_days: wd,
      breached: wd >= TASK_SLA,
      at_risk: wd === TASK_SLA - 1,
    };
  });

  // ── 4. Closure approval SLA (N working days) ──────────────────────────
  const CLOSURE_SLA = policy.closure_review.limit;
  const pendingClosure = !on('closure_review') ? [] : (await db.prepare(`
    SELECT p.id, p.title, p.closure_requested_at
    FROM projects p
    WHERE p.status = 'pending_approval' AND p.closure_requested_at IS NOT NULL
  `).all());

  const closureItems = pendingClosure.map(p => {
    const wd = workingDaysBetween(p.closure_requested_at.slice(0, 10), today);
    return {
      id: p.id,
      title: p.title,
      closure_requested_at: p.closure_requested_at,
      working_days: wd,
      breached: wd > CLOSURE_SLA,
      at_risk:  wd >= CLOSURE_SLA - 1 && wd <= CLOSURE_SLA,
    };
  });

  // ── 5. Tickets: resolved by their Request Tracker due date ───────────
  // Open tickets past due are breached, those due within the warning window at
  // risk; resolved tickets of the last 30 days count as on time or late.
  const warnHours = policy.tickets.limit;
  const ticketRows = !on('tickets') ? [] : (await db.prepare(`
    SELECT t.id, t.ticket_number, t.subject, t.status_group, t.normalized_status, t.sla_due_at, t.resolved_at_external, t.owner_name, t.external_url, c.name AS customer_name, u.name AS engineer_name
    FROM external_tickets t JOIN customers c ON c.id = t.customer_id LEFT JOIN users u ON u.id = t.owner_user_id
    WHERE t.sla_due_at IS NOT NULL AND (t.status_group = 'open' OR substr(t.resolved_at_external,1,10) >= ?)
  `).all(require('../appTime').addDays(today, -30)));
  const nowMs = Date.now();
  const ticketItems = ticketRows.map(t => {
    const due = Date.parse(t.sla_due_at), resolved = t.resolved_at_external ? Date.parse(t.resolved_at_external) : null;
    const open = t.status_group === 'open';
    return {
      id: t.id, ticket_number: t.ticket_number, subject: t.subject, customer_name: decrypt(t.customer_name), engineer_name: t.engineer_name || t.owner_name || null,
      status: t.normalized_status, due_at: t.sla_due_at, resolved_at: t.resolved_at_external, external_url: t.external_url,
      hours_left: open ? Math.round((due - nowMs) / 360000) / 10 : null,
      breached: open && due < nowMs,
      at_risk: open && due >= nowMs && due - nowMs <= warnHours * 3600000,
      late_complete: !open && resolved !== null && resolved > due,
      on_time: !open && resolved !== null && resolved <= due,
    };
  });

  res.json({
    generated_at: new Date().toISOString(),
    policy,
    mv: {
      enabled: on('visit_report'),
      sla_days: MV_SLA,
      total:         mvItems.length,
      on_time:       mvItems.filter(r => r.report_sent && !r.late_complete).length,
      late_complete: mvItems.filter(r => r.late_complete).length,
      at_risk:       mvItems.filter(r => r.at_risk).length,
      breached:      mvItems.filter(r => r.breached).length,
      items:         mvItems,
    },
    project_status: {
      enabled: on('project_update'),
      sla_days: PROJ_SLA,
      total:    projItems.length,
      ok:       projItems.filter(r => !r.breached && !r.at_risk).length,
      at_risk:  projItems.filter(r => r.at_risk).length,
      breached: projItems.filter(r => r.breached).length,
      items:    projItems,
    },
    high_priority_tasks: {
      enabled: on('task_response'),
      sla_days: TASK_SLA,
      total:    taskItems.length,
      breached: taskItems.filter(r => r.breached).length,
      at_risk:  taskItems.filter(r => r.at_risk).length,
      ok:       taskItems.filter(r => !r.breached && !r.at_risk).length,
      items:    taskItems,
    },
    closure_approval: {
      enabled: on('closure_review'),
      sla_days: CLOSURE_SLA,
      total:    closureItems.length,
      ok:       closureItems.filter(r => !r.breached && !r.at_risk).length,
      at_risk:  closureItems.filter(r => r.at_risk).length,
      breached: closureItems.filter(r => r.breached).length,
      items:    closureItems,
    },
    tickets: {
      enabled: on('tickets'),
      warning_hours: warnHours,
      total:         ticketItems.length,
      open:          ticketItems.filter(r => r.hours_left !== null).length,
      on_time:       ticketItems.filter(r => r.on_time).length,
      late_complete: ticketItems.filter(r => r.late_complete).length,
      at_risk:       ticketItems.filter(r => r.at_risk).length,
      breached:      ticketItems.filter(r => r.breached).length,
      items:         ticketItems.filter(r => r.breached || r.at_risk || r.late_complete).sort((a, b) => String(a.due_at).localeCompare(String(b.due_at))).slice(0, 200),
    },
    forecast: {
      predicted_breaches_next_working_day:
        mvItems.filter(r => r.at_risk).length +
        projItems.filter(r => r.at_risk).length +
        taskItems.filter(r => r.at_risk).length +
        closureItems.filter(r => r.at_risk).length +
        ticketItems.filter(r => r.at_risk).length,
      current_breaches:
        mvItems.filter(r => r.breached).length +
        projItems.filter(r => r.breached).length +
        taskItems.filter(r => r.breached).length +
        closureItems.filter(r => r.breached).length +
        ticketItems.filter(r => r.breached).length,
      escalation_recommended: [
        ...mvItems.filter(r => r.breached).map(r => ({ type: 'maintenance', id: r.id, title: r.title })),
        ...projItems.filter(r => r.breached).map(r => ({ type: 'project', id: r.id, title: r.title })),
        ...taskItems.filter(r => r.breached).map(r => ({ type: 'task', id: r.id, title: r.title })),
        ...closureItems.filter(r => r.breached).map(r => ({ type: 'closure', id: r.id, title: r.title })),
        ...ticketItems.filter(r => r.breached).map(r => ({ type: 'ticket', id: r.id, title: `#${r.ticket_number} ${r.subject}` })),
      ].slice(0, 20),
    },
  });
});

module.exports = router;
