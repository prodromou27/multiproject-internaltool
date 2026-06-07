const router = require('express').Router();
const db = require('../db');
const { requireManager } = require('../middleware/auth');

// Count Mon–Fri days from startStr (exclusive) to endStr (inclusive)
function workingDaysBetween(startStr, endStr) {
  const start = new Date(startStr.slice(0, 10) + 'T12:00:00');
  const end   = new Date(endStr.slice(0, 10)   + 'T12:00:00');
  if (end <= start) return 0;
  let count = 0;
  const cur = new Date(start);
  cur.setDate(cur.getDate() + 1);
  while (cur <= end) {
    const d = cur.getDay(); // 0=Sun, 6=Sat
    if (d !== 0 && d !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

router.get('/overview', requireManager, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);

  // ── 1. MV Report Complete SLA (7 working days from scheduled_date) ────
  const MV_SLA = 7;
  const allMVs = db.prepare(`
    SELECT mv.id, mv.title, mv.scheduled_date, mv.report_sent, mv.report_sent_at,
           mv.report_sent_to_customer, mv.status,
           c.name AS customer_name,
           (SELECT GROUP_CONCAT(u.name, ', ')
            FROM maintenance_visit_engineers mve JOIN users u ON mve.user_id = u.id
            WHERE mve.visit_id = mv.id) AS engineer_names
    FROM maintenance_visits mv
    JOIN customers c ON mv.customer_id = c.id
    WHERE mv.status != 'cancelled'
  `).all();

  const mvItems = allMVs.map(mv => {
    // If report already complete, measure days to completion; otherwise days elapsed so far
    const refDate = (mv.report_sent && mv.report_sent_at) ? mv.report_sent_at.slice(0, 10) : today;
    const wd = workingDaysBetween(mv.scheduled_date, refDate);
    return {
      id: mv.id,
      title: mv.title,
      customer_name: mv.customer_name,
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

  // ── 2. Project Status Update SLA (every 7 calendar days) ─────────────
  const PROJ_SLA = 7;
  const activeProjects = db.prepare(`
    SELECT p.id, p.title, p.status, p.created_at,
      (SELECT MAX(psu.created_at) FROM project_status_updates psu
       WHERE psu.project_id = p.id) AS last_status_update
    FROM projects p
    WHERE p.status NOT IN ('closed', 'cancelled', 'pending_approval')
  `).all();

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

  // ── 3. High-priority task first response (1 working day) ─────────────
  const TASK_SLA = 1;
  const highPriTasks = db.prepare(`
    SELECT t.id, t.title, t.created_at, t.status,
           p.title AS project_title,
           u.name  AS assigned_to_name
    FROM tasks t
    LEFT JOIN projects p ON t.project_id = p.id
    LEFT JOIN users u ON t.assigned_to = u.id
    WHERE t.priority = 'high' AND t.status = 'open'
  `).all();

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
    };
  });

  // ── 4. Closure approval SLA (3 working days) ──────────────────────────
  const CLOSURE_SLA = 3;
  const pendingClosure = db.prepare(`
    SELECT p.id, p.title, p.closure_requested_at
    FROM projects p
    WHERE p.status = 'pending_approval' AND p.closure_requested_at IS NOT NULL
  `).all();

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

  res.json({
    generated_at: new Date().toISOString(),
    mv: {
      sla_days: MV_SLA,
      total:         mvItems.length,
      on_time:       mvItems.filter(r => r.report_sent && !r.late_complete).length,
      late_complete: mvItems.filter(r => r.late_complete).length,
      at_risk:       mvItems.filter(r => r.at_risk).length,
      breached:      mvItems.filter(r => r.breached).length,
      items:         mvItems,
    },
    project_status: {
      sla_days: PROJ_SLA,
      total:    projItems.length,
      ok:       projItems.filter(r => !r.breached && !r.at_risk).length,
      at_risk:  projItems.filter(r => r.at_risk).length,
      breached: projItems.filter(r => r.breached).length,
      items:    projItems,
    },
    high_priority_tasks: {
      sla_days: TASK_SLA,
      total:    taskItems.length,
      breached: taskItems.filter(r => r.breached).length,
      ok:       taskItems.filter(r => !r.breached).length,
      items:    taskItems,
    },
    closure_approval: {
      sla_days: CLOSURE_SLA,
      total:    closureItems.length,
      ok:       closureItems.filter(r => !r.breached && !r.at_risk).length,
      at_risk:  closureItems.filter(r => r.at_risk).length,
      breached: closureItems.filter(r => r.breached).length,
      items:    closureItems,
    },
  });
});

module.exports = router;
