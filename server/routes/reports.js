const router = require('express').Router();
const db = require('../db');
const { requireManager } = require('../middleware/auth');

router.get('/summary', requireManager, (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as c FROM projects').get().c;
  const byStatus = db.prepare('SELECT status, COUNT(*) as count FROM projects GROUP BY status').all();
  const overdue = db.prepare(`SELECT COUNT(*) as c FROM projects WHERE deadline < date('now') AND status NOT IN ('closed','cancelled','pending_approval')`).get().c;
  const taskStats = db.prepare(`SELECT
    COUNT(*) as total,
    SUM(CASE WHEN status IN ('completed','closed') THEN 1 ELSE 0 END) as done,
    SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) as open,
    SUM(CASE WHEN status='in_progress' THEN 1 ELSE 0 END) as in_progress,
    SUM(CASE WHEN is_adhoc=1 THEN 1 ELSE 0 END) as adhoc
  FROM tasks WHERE status != 'cancelled'`).get();
  const engineerLoad = db.prepare(`SELECT u.name, COUNT(t.id) as task_count,
    SUM(CASE WHEN t.status IN ('completed','closed') THEN 1 ELSE 0 END) as done_count
    FROM users u LEFT JOIN tasks t ON t.assigned_to = u.id AND t.status != 'cancelled'
    WHERE u.role = 'engineer' GROUP BY u.id ORDER BY task_count DESC`).all();
  const pendingClosure = db.prepare(`SELECT p.*, u.name as created_by_name FROM projects p JOIN users u ON p.created_by = u.id WHERE p.status = 'pending_approval'`).all();
  const kpiHealth = db.prepare(`SELECT p.title, k.name, k.target_value, k.current_value, k.unit,
    ROUND(CASE WHEN k.target_value > 0 THEN (k.current_value * 100.0 / k.target_value) ELSE 0 END, 1) as pct
    FROM kpis k JOIN projects p ON k.project_id = p.id ORDER BY pct ASC`).all();
  res.json({ total, byStatus, overdue, taskStats, engineerLoad, pendingClosure, kpiHealth });
});

router.get('/projects', requireManager, (req, res) => {
  const rows = db.prepare(`SELECT p.*, u.name as created_by_name,
    (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND status != 'cancelled') as task_count,
    (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND status IN ('completed','closed')) as done_count,
    (SELECT COUNT(*) FROM project_assignments WHERE project_id = p.id) as member_count
    FROM projects p JOIN users u ON p.created_by = u.id ORDER BY p.deadline ASC, p.created_at DESC`).all();
  res.json(rows);
});

router.get('/monthly', requireManager, (req, res) => {
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d        = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year     = d.getFullYear();
    const month    = String(d.getMonth() + 1).padStart(2, '0');
    const lastDay  = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    months.push({
      label: `${MONTH_NAMES[d.getMonth()]} '${String(year).slice(2)}`,
      ym:    `${year}-${month}`,
      start: `${year}-${month}-01`,
      end:   `${year}-${month}-${String(lastDay).padStart(2, '0')}`,
    });
  }

  const rangeStart = months[0].start;
  const rangeEnd   = months[months.length - 1].end;

  // 8 batched queries spanning the full 6-month range instead of 48 individual queries
  const taskCreated     = db.prepare(`SELECT strftime('%Y-%m',created_at) as ym, COUNT(*) as c FROM tasks WHERE date(created_at) BETWEEN ? AND ? GROUP BY ym`).all(rangeStart, rangeEnd);
  const taskDone        = db.prepare(`SELECT strftime('%Y-%m',updated_at) as ym, COUNT(*) as c FROM tasks WHERE status IN ('completed','closed') AND date(updated_at) BETWEEN ? AND ? GROUP BY ym`).all(rangeStart, rangeEnd);
  const taskDoneWithDl  = db.prepare(`SELECT strftime('%Y-%m',updated_at) as ym, COUNT(*) as c FROM tasks WHERE status IN ('completed','closed') AND deadline IS NOT NULL AND date(updated_at) BETWEEN ? AND ? GROUP BY ym`).all(rangeStart, rangeEnd);
  const taskOnTime      = db.prepare(`SELECT strftime('%Y-%m',updated_at) as ym, COUNT(*) as c FROM tasks WHERE status IN ('completed','closed') AND deadline IS NOT NULL AND date(updated_at) <= date(deadline) AND date(updated_at) BETWEEN ? AND ? GROUP BY ym`).all(rangeStart, rangeEnd);
  const mvTotal         = db.prepare(`SELECT strftime('%Y-%m',scheduled_date) as ym, COUNT(*) as c FROM maintenance_visits WHERE date(scheduled_date) BETWEEN ? AND ? AND status != 'cancelled' GROUP BY ym`).all(rangeStart, rangeEnd);
  const mvCompleted     = db.prepare(`SELECT strftime('%Y-%m',scheduled_date) as ym, COUNT(*) as c FROM maintenance_visits WHERE status='completed' AND date(scheduled_date) BETWEEN ? AND ? GROUP BY ym`).all(rangeStart, rangeEnd);
  const mvReported      = db.prepare(`SELECT strftime('%Y-%m',report_sent_at) as ym, COUNT(*) as c FROM maintenance_visits WHERE report_sent=1 AND report_sent_at IS NOT NULL AND date(report_sent_at) BETWEEN ? AND ? GROUP BY ym`).all(rangeStart, rangeEnd);
  const hoursLogged     = db.prepare(`SELECT strftime('%Y-%m',logged_at) as ym, COALESCE(ROUND(SUM(hours),1),0) as h FROM time_logs WHERE date(logged_at) BETWEEN ? AND ? GROUP BY ym`).all(rangeStart, rangeEnd);

  // Index each result by YYYY-MM
  const idx = arr => Object.fromEntries(arr.map(r => [r.ym, r]));
  const tcIdx = idx(taskCreated), tdIdx = idx(taskDone), tdDlIdx = idx(taskDoneWithDl),
        totIdx = idx(taskOnTime), mvtIdx = idx(mvTotal), mvcIdx = idx(mvCompleted),
        mvrIdx = idx(mvReported), hlIdx  = idx(hoursLogged);

  const result = months.map(({ label, ym }) => {
    const tasks_done         = tdIdx[ym]?.c  || 0;
    const tasks_done_with_dl = tdDlIdx[ym]?.c || 0;
    const tasks_on_time      = totIdx[ym]?.c  || 0;
    const mv_total           = mvtIdx[ym]?.c  || 0;
    const mv_completed       = mvcIdx[ym]?.c  || 0;
    return {
      label,
      tasks_created: tcIdx[ym]?.c  || 0,
      tasks_done,
      on_time_rate:  tasks_done_with_dl > 0 ? Math.round((tasks_on_time / tasks_done_with_dl) * 100) : null,
      mv_total,
      mv_completed,
      mv_rate:       mv_total > 0 ? Math.round((mv_completed / mv_total) * 100) : null,
      mv_reported:   mvrIdx[ym]?.c  || 0,
      hours_logged:  hlIdx[ym]?.h   || 0,
    };
  });

  res.json(result);
});

module.exports = router;
