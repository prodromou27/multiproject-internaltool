const router = require('express').Router();
const db = require('../db');
const { requireManager } = require('../middleware/auth');
const { decrypt } = require('../fieldCipher');
const { workingDaysBetween } = require('../workingDays');
const { getTeamSlaTargets } = require('../teamSla');
const { evaluateActivitySla, summarizeByTeam } = require('../serviceActivitySla');
const { getStatusConfig } = require('../serviceActivityStatus');

router.get('/overview', requireManager, async (req, res) => {
  const today = (await db.prepare('SELECT app_today() AS d').get()).d;

  // ── 1. MV Report Complete SLA (7 working days from scheduled_date) ────
  const MV_SLA = 7;
  const allMVs = (await db.prepare(`
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

  // ── 2. Project Status Update SLA (every 7 calendar days) ─────────────
  const PROJ_SLA = 7;
  const activeProjects = (await db.prepare(`
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

  // ── 3. High-priority task first response (1 working day) ─────────────
  const TASK_SLA = 1;
  const highPriTasks = (await db.prepare(`
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

  // ── 4. Closure approval SLA (3 working days) ──────────────────────────
  const CLOSURE_SLA = 3;
  const pendingClosure = (await db.prepare(`
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

  // ── 5. Service Activity SLA, targets configurable per team ───────────
  const activityStatuses = await getStatusConfig();
  const completedValue = activityStatuses.find(s => s.is_terminal && /complet/i.test(s.value))?.value || 'completed';
  const initialValue = activityStatuses[0]?.value || 'planned';
  const cancelledValue = activityStatuses.find(s => s.is_terminal && /cancel/i.test(s.value))?.value || 'cancelled';

  // Every still-open activity counts regardless of age (an old one is exactly what
  // should show as badly breached); completed ones are windowed to the last 90 days
  // so "late complete" stats stay about recent performance, not the whole history.
  const cutoff90 = new Date(today + 'T12:00:00'); cutoff90.setDate(cutoff90.getDate() - 90);
  const cutoff90Str = cutoff90.toISOString().slice(0, 10);
  const openActivities = (await db.prepare(`
    SELECT sa.id, sa.activity_reference, sa.title, sa.status, sa.team_id, sa.created_at, sa.completed_at,
           t.name AS team_name, c.name AS customer_name
    FROM service_activities sa
    JOIN teams t ON t.id = sa.team_id
    JOIN customers c ON c.id = sa.customer_id
    WHERE sa.status NOT IN (?, ?)
       OR (sa.status = ? AND sa.completed_at >= ?)
  `).all(cancelledValue, completedValue, completedValue, cutoff90Str));

  const slaTargets = await getTeamSlaTargets(openActivities.map(a => a.team_id));
  const activityItems = openActivities.map(a => evaluateActivitySla(
    { ...a, customer_name: decrypt(a.customer_name) },
    slaTargets[a.team_id],
    { completedValue, initialValue },
  ));

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
      at_risk:  taskItems.filter(r => r.at_risk).length,
      ok:       taskItems.filter(r => !r.breached && !r.at_risk).length,
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
    // Targets are per-team (Settings → Teams → SLA), not fixed like the four blocks
    // above — response_hours/resolution_hours vary per team, defaulting to 8h/48h.
    service_activities: {
      total:              activityItems.length,
      ok:                 activityItems.filter(r => !r.breached && !r.at_risk && !r.response_breached).length,
      at_risk:            activityItems.filter(r => r.at_risk).length,
      breached:           activityItems.filter(r => r.breached).length,
      response_breached:  activityItems.filter(r => r.response_breached).length,
      late_complete:      activityItems.filter(r => r.late_complete).length,
      by_team:            summarizeByTeam(activityItems),
      items:              activityItems,
    },
    forecast: {
      predicted_breaches_next_working_day:
        mvItems.filter(r => r.at_risk).length +
        projItems.filter(r => r.at_risk).length +
        taskItems.filter(r => r.at_risk).length +
        closureItems.filter(r => r.at_risk).length +
        activityItems.filter(r => r.at_risk).length,
      current_breaches:
        mvItems.filter(r => r.breached).length +
        projItems.filter(r => r.breached).length +
        taskItems.filter(r => r.breached).length +
        closureItems.filter(r => r.breached).length +
        activityItems.filter(r => r.breached).length,
      escalation_recommended: [
        ...mvItems.filter(r => r.breached).map(r => ({ type: 'maintenance', id: r.id, title: r.title })),
        ...projItems.filter(r => r.breached).map(r => ({ type: 'project', id: r.id, title: r.title })),
        ...taskItems.filter(r => r.breached).map(r => ({ type: 'task', id: r.id, title: r.title })),
        ...closureItems.filter(r => r.breached).map(r => ({ type: 'closure', id: r.id, title: r.title })),
        ...activityItems.filter(r => r.breached).map(r => ({ type: 'service_activity', id: r.id, title: r.title })),
      ].slice(0, 20),
    },
  });
});

module.exports = router;
