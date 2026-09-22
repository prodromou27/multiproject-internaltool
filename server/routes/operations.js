const router = require('express').Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { getEnabledTeamIdsForUser } = require('../serviceActivities');
const { decrypt } = require('../fieldCipher');

const placeholders = values => values.map(() => '?').join(',');
const numbers = row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value || 0)]));
const iso = date => date.toISOString().slice(0, 10);

router.get('/overview', requireAuth, async (req, res) => {
  if (!['manager', 'engineer'].includes(req.user.role)) return res.status(403).json({ error: 'This overview is available to managers and engineers' });
  const asOf = req.query.as_of === undefined ? iso(new Date()) : req.query.as_of;
  if (typeof asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(Date.parse(asOf)) || iso(new Date(asOf)) !== asOf || Number(asOf.slice(0, 4)) < 1900 || Number(asOf.slice(0, 4)) > 9998) return res.status(400).json({ error: 'as_of must be a valid date (YYYY-MM-DD, years 1900–9998)' });
  const today = new Date(`${asOf}T00:00:00Z`);
  const shifted = days => { const date = new Date(today); date.setUTCDate(date.getUTCDate() + days); return iso(date); };
  const soon = shifted(7);
  const weekFrom = shifted(-((today.getUTCDay() + 6) % 7));
  const weekToDate = new Date(`${weekFrom}T00:00:00Z`); weekToDate.setUTCDate(weekToDate.getUTCDate() + 6);
  const weekTo = iso(weekToDate);
  const setting = await db.prepare("SELECT value FROM settings WHERE key='status_config'").get();
  let config;
  try { config = JSON.parse(setting?.value || '{}') || {}; } catch { config = {}; }
  const statuses = type => Array.isArray(config[type]) ? config[type] : [];
  const terminal = (type, extras) => [...new Set([...extras, ...statuses(type).filter(status => status?.is_terminal).map(status => status.value)])];
  const taskDone = terminal('task', ['completed', 'closed', 'cancelled']);
  const projectDone = terminal('project', ['closed', 'cancelled']);
  const manager = req.user.role === 'manager';
  const owned = manager ? '' : ' AND t.assigned_to=?';
  const taskParams = [...taskDone, ...(manager ? [] : [req.user.id])];
  const taskWhere = `t.status NOT IN (${placeholders(taskDone)})${owned}`;
  const projectFrom = `projects p${manager ? '' : ' JOIN project_assignments pa ON pa.project_id=p.id AND pa.user_id=?'}`;
  const projectParams = [...(manager ? [] : [req.user.id]), ...projectDone];
  const projectWhere = `p.status NOT IN (${placeholders(projectDone)})`;
  const visitFrom = `maintenance_visits mv${manager ? '' : ' JOIN maintenance_visit_engineers mve ON mve.visit_id=mv.id AND mve.user_id=?'}`;
  const visitParams = manager ? [] : [req.user.id];
  const reportWhere = "mv.status IN ('completed','in_progress') AND mv.report_sent=0 AND mv.scheduled_date<=?";
  const serviceEnabled = manager || (await getEnabledTeamIdsForUser(req.user.id)).size > 0;

  const [taskStats, tasks, projectStats, projects, visitStats, visits, reports, reportReviewStats, reportReviews] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS open, SUM(CASE WHEN t.deadline<? THEN 1 ELSE 0 END) AS overdue,
      SUM(CASE WHEN t.deadline=? THEN 1 ELSE 0 END) AS due_today,
      SUM(CASE WHEN t.status='waiting_customer' THEN 1 ELSE 0 END) AS waiting_customer,
      SUM(CASE WHEN t.status='pending_approval' THEN 1 ELSE 0 END) AS awaiting_approval
      FROM tasks t WHERE ${taskWhere}`).get(asOf, asOf, ...taskParams),
    db.prepare(`SELECT t.id, t.title, t.deadline, t.priority, t.status FROM tasks t WHERE ${taskWhere}
      AND t.deadline<=? ORDER BY t.deadline ASC, t.id ASC LIMIT 5`).all(...taskParams, asOf),
    db.prepare(`SELECT COUNT(*) AS active, SUM(CASE WHEN p.deadline<? AND p.status!='pending_approval' THEN 1 ELSE 0 END) AS overdue,
      SUM(CASE WHEN p.status='pending_approval' THEN 1 ELSE 0 END) AS awaiting_approval,
      SUM(CASE WHEN p.status='waiting_customer' THEN 1 ELSE 0 END) AS waiting_customer,
      SUM(CASE WHEN p.updated_at<? THEN 1 ELSE 0 END) AS stale
      FROM ${projectFrom} WHERE ${projectWhere}`).get(asOf, `${shifted(-7)} 00:00:00`, ...projectParams),
    db.prepare(`SELECT p.id, p.title, p.deadline, p.priority, p.status FROM ${projectFrom} WHERE ${projectWhere}
      AND p.status!='pending_approval' AND p.deadline<=? ORDER BY p.deadline ASC, p.id ASC LIMIT 5`).all(...projectParams, soon),
    db.prepare(`SELECT SUM(CASE WHEN mv.status NOT IN ('cancelled','completed') AND mv.scheduled_date BETWEEN ? AND ? THEN 1 ELSE 0 END) AS upcoming,
      SUM(CASE WHEN ${reportWhere} THEN 1 ELSE 0 END) AS reports_pending,
      SUM(CASE WHEN mv.status!='cancelled' AND mv.report_sent=1 AND mv.report_sent_to_customer=0 THEN 1 ELSE 0 END) AS customer_delivery_pending
      FROM ${visitFrom}`).get(asOf, soon, asOf, ...visitParams),
    db.prepare(`SELECT mv.id, mv.title, mv.scheduled_date, mv.status FROM ${visitFrom}
      WHERE mv.status NOT IN ('cancelled','completed') AND mv.scheduled_date BETWEEN ? AND ?
      ORDER BY mv.scheduled_date ASC, mv.id ASC LIMIT 5`).all(...visitParams, asOf, soon),
    db.prepare(`SELECT mv.id, mv.title, mv.scheduled_date FROM ${visitFrom} WHERE ${reportWhere}
      ORDER BY mv.scheduled_date ASC, mv.id ASC LIMIT 5`).all(...visitParams, asOf),
    manager ? db.prepare("SELECT COUNT(*) AS active FROM managed_report_history WHERE workflow_status IN ('in_review','approved')").get() : Promise.resolve({ active: 0 }),
    manager ? db.prepare(`SELECT h.id,h.customer_id,c.name AS customer_name,h.original_name,h.workflow_status AS status,
      COALESCE(h.submitted_at,h.generated_at) AS submitted_at FROM managed_report_history h JOIN customers c ON c.id=h.customer_id
      WHERE h.workflow_status IN ('in_review','approved')
      ORDER BY CASE h.workflow_status WHEN 'in_review' THEN 0 ELSE 1 END,COALESCE(h.submitted_at,h.generated_at),h.id LIMIT 5`).all() : Promise.resolve([]),
  ]);

  let service = { enabled: false };
  if (serviceEnabled) {
    const scope = manager ? '' : ' AND sa.engineer_id=?';
    const scopeParams = manager ? [] : [req.user.id];
    const cancelled = [...new Set(['cancelled', ...statuses('service_activity').filter(status => /cancel/i.test(status?.value)).map(status => status.value)])];
    // Completing an activity does not complete its follow-up. A linked completed
    // task resolves it; unlinked follow-ups remain pending until the flag is cleared.
    const followWhere = `sa.follow_up_required=1 AND sa.status NOT IN (${placeholders(cancelled)})
      AND (sa.follow_up_task_id IS NULL OR ft.status NOT IN (${placeholders(taskDone)}))${scope}`;
    const followParams = [...cancelled, ...taskDone, ...scopeParams];
    const [stats, pending, followUps, recent] = await Promise.all([
      db.prepare(`SELECT COUNT(CASE WHEN sa.activity_date=? THEN 1 ELSE NULL END) AS today,
        COUNT(*) AS week, SUM(COALESCE(sa.duration_minutes,0)) AS minutes, COUNT(DISTINCT sa.customer_id) AS customers
        FROM service_activities sa WHERE sa.activity_date BETWEEN ? AND ?${scope}`).get(asOf, weekFrom, weekTo, ...scopeParams),
      db.prepare(`SELECT COUNT(*) AS pending, SUM(CASE WHEN sa.follow_up_date<=? THEN 1 ELSE 0 END) AS due
        FROM service_activities sa LEFT JOIN tasks ft ON ft.id=sa.follow_up_task_id WHERE ${followWhere}`).get(asOf, ...followParams),
      db.prepare(`SELECT sa.id, sa.title, sa.follow_up_date FROM service_activities sa LEFT JOIN tasks ft ON ft.id=sa.follow_up_task_id
        WHERE ${followWhere} AND sa.follow_up_date<=? ORDER BY sa.follow_up_date ASC, sa.id ASC LIMIT 5`).all(...followParams, asOf),
      db.prepare(`SELECT sa.id, sa.title, sa.activity_date, sa.duration_minutes FROM service_activities sa
        WHERE sa.activity_date BETWEEN ? AND ?${scope} ORDER BY sa.activity_date DESC, sa.id DESC LIMIT 5`).all(weekFrom, weekTo, ...scopeParams),
    ]);
    const totals = numbers(stats);
    service = { enabled: true, ...totals, hours: Math.round(totals.minutes / 6) / 10, ...numbers(pending), follow_ups: followUps, recent };
  }
  res.json({ as_of: asOf, week_from: weekFrom, week_to: weekTo, through: soon, scope: manager ? 'management' : 'personal',
    tasks: { ...numbers(taskStats), attention: tasks }, projects: { ...numbers(projectStats), commitments: projects },
    visits: { ...numbers(visitStats), upcoming_items: visits, reports },
    approvals: { managed_reports: Number(reportReviewStats.active || 0), reports: reportReviews.map(report => ({ ...report,customer_name:decrypt(report.customer_name) })) },service });
});

module.exports = router;
