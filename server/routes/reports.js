const router = require('express').Router();
const ExcelJS = require('exceljs');
const db = require('../db');
const { requireManager, requireDownloadManager } = require('../middleware/auth');
const { decrypt: decryptField } = require('../fieldCipher');
router.use('/custom', require('./custom-reports'));

router.get('/summary', requireManager, async (req, res) => {
  const total = (await db.prepare('SELECT COUNT(*) as c FROM projects').get()).c;
  const byStatus = (await db.prepare('SELECT status, COUNT(*) as count FROM projects GROUP BY status').all());
  const overdue = (await db.prepare(`SELECT COUNT(*) as c FROM projects WHERE deadline < app_today() AND status NOT IN ('closed','cancelled','pending_approval')`).get()).c;
  const taskStats = (await db.prepare(`SELECT
    COUNT(*) as total,
    SUM(CASE WHEN status IN ('completed','closed') THEN 1 ELSE 0 END) as done,
    SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) as open,
    SUM(CASE WHEN status='in_progress' THEN 1 ELSE 0 END) as in_progress,
    SUM(CASE WHEN is_adhoc=1 THEN 1 ELSE 0 END) as adhoc
  FROM tasks WHERE status != 'cancelled'`).get());
  const engineerLoad = (await db.prepare(`SELECT u.name, COUNT(t.id) as task_count,
    SUM(CASE WHEN t.status IN ('completed','closed') THEN 1 ELSE 0 END) as done_count
    FROM users u LEFT JOIN tasks t ON t.assigned_to = u.id AND t.status != 'cancelled'
    WHERE u.role = 'engineer' GROUP BY u.id ORDER BY task_count DESC`).all());
  const pendingClosure = (await db.prepare(`SELECT p.*, u.name as created_by_name FROM projects p JOIN users u ON p.created_by = u.id WHERE p.status = 'pending_approval'`).all());
  const kpiHealth = (await db.prepare(`SELECT p.title, k.name, k.target_value, k.current_value, k.unit,
    ROUND(CASE WHEN k.target_value > 0 THEN (k.current_value * 100.0 / k.target_value) ELSE 0 END, 1) as pct
    FROM kpis k JOIN projects p ON k.project_id = p.id ORDER BY pct ASC`).all());
  res.json({ total, byStatus, overdue, taskStats, engineerLoad, pendingClosure, kpiHealth });
});

router.get('/projects', requireManager, async (req, res) => {
  const rows = (await db.prepare(`SELECT p.*, u.name as created_by_name,
    (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND status != 'cancelled') as task_count,
    (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND status IN ('completed','closed')) as done_count,
    (SELECT COUNT(*) FROM project_assignments WHERE project_id = p.id) as member_count
    FROM projects p JOIN users u ON p.created_by = u.id ORDER BY p.deadline ASC, p.created_at DESC`).all());
  res.json(rows);
});

router.get('/monthly', requireManager, async (req, res) => {
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
  const taskCreated     = (await db.prepare(`SELECT substr(created_at,1,7) as ym, COUNT(*) as c FROM tasks WHERE substr(created_at,1,10) BETWEEN ? AND ? GROUP BY ym`).all(rangeStart, rangeEnd));
  const taskDone        = (await db.prepare(`SELECT substr(updated_at,1,7) as ym, COUNT(*) as c FROM tasks WHERE status IN ('completed','closed') AND substr(updated_at,1,10) BETWEEN ? AND ? GROUP BY ym`).all(rangeStart, rangeEnd));
  const taskDoneWithDl  = (await db.prepare(`SELECT substr(updated_at,1,7) as ym, COUNT(*) as c FROM tasks WHERE status IN ('completed','closed') AND deadline IS NOT NULL AND substr(updated_at,1,10) BETWEEN ? AND ? GROUP BY ym`).all(rangeStart, rangeEnd));
  const taskOnTime      = (await db.prepare(`SELECT substr(updated_at,1,7) as ym, COUNT(*) as c FROM tasks WHERE status IN ('completed','closed') AND deadline IS NOT NULL AND substr(updated_at,1,10) <= substr(deadline,1,10) AND substr(updated_at,1,10) BETWEEN ? AND ? GROUP BY ym`).all(rangeStart, rangeEnd));
  const mvTotal         = (await db.prepare(`SELECT substr(scheduled_date,1,7) as ym, COUNT(*) as c FROM maintenance_visits WHERE substr(scheduled_date,1,10) BETWEEN ? AND ? AND status != 'cancelled' GROUP BY ym`).all(rangeStart, rangeEnd));
  const mvCompleted     = (await db.prepare(`SELECT substr(scheduled_date,1,7) as ym, COUNT(*) as c FROM maintenance_visits WHERE status='completed' AND substr(scheduled_date,1,10) BETWEEN ? AND ? GROUP BY ym`).all(rangeStart, rangeEnd));
  const mvReported      = (await db.prepare(`SELECT substr(report_sent_at,1,7) as ym, COUNT(*) as c FROM maintenance_visits WHERE report_sent=1 AND report_sent_at IS NOT NULL AND substr(report_sent_at,1,10) BETWEEN ? AND ? GROUP BY ym`).all(rangeStart, rangeEnd));
  const hoursLogged     = (await db.prepare(`SELECT substr(logged_at,1,7) as ym, COALESCE(ROUND(SUM(hours),1),0) as h FROM time_logs WHERE substr(logged_at,1,10) BETWEEN ? AND ? GROUP BY ym`).all(rangeStart, rangeEnd));

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

/* ── Service Activity reports ─────────────────────────────────────────── */
function buildActivityFilters(query) {
  const { from, to, customer_id, team_id, category_id, engineer_id, technology_id } = query;
  let where = 'WHERE 1=1';
  const params = [];
  if (from)        { where += ' AND sa.activity_date >= ?'; params.push(from); }
  if (to)          { where += ' AND sa.activity_date <= ?'; params.push(to); }
  if (customer_id) { where += ' AND sa.customer_id = ?'; params.push(customer_id); }
  if (team_id)     { where += ' AND sa.team_id = ?'; params.push(team_id); }
  if (category_id) { where += ' AND sa.category_id = ?'; params.push(category_id); }
  if (engineer_id) { where += ' AND sa.engineer_id = ?'; params.push(engineer_id); }
  if (technology_id) {
    where += ' AND EXISTS (SELECT 1 FROM service_activity_technologies sat WHERE sat.service_activity_id = sa.id AND sat.technology_id = ?)';
    params.push(technology_id);
  }
  return { where, params };
}

async function activityReportRows(query) {
  const { where, params } = buildActivityFilters(query);
  const rows = await db.prepare(`
    SELECT sa.activity_date, u.name AS engineer, cat.name AS category, sa.title,
      sa.description AS notes, sa.duration_minutes, sa.billable_classification, sa.ticket_reference,
      c.name AS customer, t.name AS team
    FROM service_activities sa
    JOIN customers c ON c.id = sa.customer_id
    JOIN teams t ON t.id = sa.team_id
    JOIN activity_categories cat ON cat.id = sa.category_id
    JOIN users u ON u.id = sa.engineer_id
    ${where}
    ORDER BY sa.activity_date DESC
  `).all(...params);
  // customers.name is encrypted at rest (see fieldCipher.js) — decrypt for display.
  return rows.map(r => ({ ...r, customer: decryptField(r.customer) }));
}

async function activityReportSummary(query) {
  const { where, params } = buildActivityFilters(query);
  const [totals, byCategory, byEngineer, byTechnology, byCustomerRaw, byBillable] = await Promise.all([
    db.prepare(`
      SELECT COUNT(*) AS total_activities, COALESCE(ROUND(SUM(sa.duration_minutes) / 60.0, 1), 0) AS total_hours
      FROM service_activities sa ${where}
    `).get(...params),
    db.prepare(`
      SELECT cat.name, COUNT(*) AS count, COALESCE(ROUND(SUM(sa.duration_minutes) / 60.0, 1), 0) AS hours
      FROM service_activities sa JOIN activity_categories cat ON cat.id = sa.category_id
      ${where} GROUP BY cat.name ORDER BY hours DESC
    `).all(...params),
    db.prepare(`
      SELECT u.name, COUNT(*) AS count, COALESCE(ROUND(SUM(sa.duration_minutes) / 60.0, 1), 0) AS hours
      FROM service_activities sa JOIN users u ON u.id = sa.engineer_id
      ${where} GROUP BY u.name ORDER BY hours DESC
    `).all(...params),
    db.prepare(`
      SELECT tech.name, COUNT(*) AS count
      FROM service_activities sa
      JOIN service_activity_technologies sat ON sat.service_activity_id = sa.id
      JOIN technologies tech ON tech.id = sat.technology_id
      ${where} GROUP BY tech.name ORDER BY count DESC
    `).all(...params),
    db.prepare(`
      SELECT c.name, COUNT(*) AS count, COALESCE(ROUND(SUM(sa.duration_minutes) / 60.0, 1), 0) AS hours
      FROM service_activities sa JOIN customers c ON c.id = sa.customer_id
      ${where} GROUP BY c.name ORDER BY hours DESC
    `).all(...params),
    db.prepare(`
      SELECT COALESCE(sa.billable_classification, 'not_set') AS classification,
        COUNT(*) AS count, COALESCE(ROUND(SUM(sa.duration_minutes) / 60.0, 1), 0) AS hours
      FROM service_activities sa ${where} GROUP BY sa.billable_classification
    `).all(...params),
  ]);
  // customers.name is encrypted at rest — decrypt for display (grouping itself is
  // unaffected since the stored ciphertext is identical for every row of the same customer).
  const byCustomer = byCustomerRaw.map(r => ({ ...r, name: decryptField(r.name) }));
  return { ...totals, byCategory, byEngineer, byTechnology, byCustomer, byBillable };
}

// Management dashboard: month-to-date (or custom range) aggregate, no entity filter required.
router.get('/service-activity/overview', requireManager, async (req, res) => {
  const now = new Date();
  const defaultFrom = req.query.from || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const query = { ...req.query, from: defaultFrom };
  const summary = await activityReportSummary(query);

  const { where, params } = buildActivityFilters(query);
  const byTeam = await db.prepare(`
    SELECT t.name, COUNT(*) AS count, COALESCE(ROUND(SUM(sa.duration_minutes) / 60.0, 1), 0) AS hours
    FROM service_activities sa JOIN teams t ON t.id = sa.team_id
    ${where} GROUP BY t.name ORDER BY hours DESC
  `).all(...params);
  const customersSupported = await db.prepare(`
    SELECT COUNT(DISTINCT sa.customer_id) AS c FROM service_activities sa ${where}
  `).get(...params);
  const internalVsCustomer = await db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN sa.billable_classification = 'internal' THEN sa.duration_minutes ELSE 0 END), 0) AS internal_minutes,
      COALESCE(SUM(CASE WHEN sa.billable_classification IS NULL OR sa.billable_classification != 'internal' THEN sa.duration_minutes ELSE 0 END), 0) AS customer_minutes
    FROM service_activities sa ${where}
  `).get(...params);

  res.json({
    ...summary,
    byTeam,
    customers_supported: customersSupported.c,
    internal_hours: Math.round((internalVsCustomer.internal_minutes / 60) * 10) / 10,
    customer_facing_hours: Math.round((internalVsCustomer.customer_minutes / 60) * 10) / 10,
  });
});

// Customer / Engineer / Team activity reports share the same filter+summary shape.
router.get('/service-activity/customer', requireManager, async (req, res) => {
  if (!req.query.customer_id) return res.status(400).json({ error: 'customer_id is required' });
  const [rows, summary] = await Promise.all([activityReportRows(req.query), activityReportSummary(req.query)]);
  res.json({ rows, summary });
});

router.get('/service-activity/engineer', requireManager, async (req, res) => {
  if (!req.query.engineer_id) return res.status(400).json({ error: 'engineer_id is required' });
  const [rows, summary] = await Promise.all([activityReportRows(req.query), activityReportSummary(req.query)]);
  res.json({ rows, summary });
});

router.get('/service-activity/team', requireManager, async (req, res) => {
  if (!req.query.team_id) return res.status(400).json({ error: 'team_id is required' });
  const [rows, summary] = await Promise.all([activityReportRows(req.query), activityReportSummary(req.query)]);
  res.json({ rows, summary });
});

router.get('/service-activity/export', requireDownloadManager, async (req, res) => {
  const rows = await activityReportRows(req.query);
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Service Activity Report');
  worksheet.addRow(['Date', 'Customer', 'Team', 'Engineer', 'Category', 'Title', 'Notes', 'Duration (min)', 'Billable', 'Ticket']);
  rows.forEach(r => worksheet.addRow([r.activity_date, r.customer, r.team, r.engineer, r.category, r.title, r.notes, r.duration_minutes, r.billable_classification, r.ticket_reference]));
  const buf = await workbook.xlsx.writeBuffer();
  res.setHeader('Content-Disposition', 'attachment; filename="service_activity_report.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

module.exports = router;
