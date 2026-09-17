const router = require('express').Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { decrypt } = require('../fieldCipher');

// Returns all events for a given month: tasks (by deadline), project deadlines, maintenance visits
router.get('/', requireAuth, async (req, res) => {
  const { month } = req.query; // YYYY-MM
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)
    || Number(month.slice(0, 4)) < 1900 || Number(month.slice(0, 4)) > 9998) {
    return res.status(400).json({ error: 'month must be a valid YYYY-MM between 1900 and 9998' });
  }

  const start = month + '-01';
  // Last day: next month minus 1 day
  const [y, m] = month.split('-').map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  const end = nextMonth + '-01';

  const isManager = req.user.role === 'manager';
  const canReadAllVisits = ['manager', 'planner', 'pm'].includes(req.user.role);

  // Tasks with deadlines in the month
  let taskQ = `SELECT t.id, t.title, t.deadline as date, t.status, t.priority, t.is_adhoc, t.assigned_to,
    u.name as assigned_to_name, p.title as project_title
    FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id
    LEFT JOIN projects p ON t.project_id = p.id
    WHERE t.deadline >= ? AND t.deadline < ? AND t.status NOT IN ('completed','closed','cancelled')`;
  const taskParams = [start, end];
  if (!isManager) { taskQ += ' AND t.assigned_to = ?'; taskParams.push(req.user.id); }
  const tasks = ['manager', 'engineer'].includes(req.user.role)
    ? (await db.prepare(taskQ).all(...taskParams)).map(r => ({ ...r, type: 'task' })) : [];

  // Project deadlines in the month
  let projQ = `SELECT p.id, p.title, p.deadline as date, p.status, p.priority
    FROM projects p WHERE p.deadline >= ? AND p.deadline < ? AND p.status NOT IN ('closed','cancelled')`;
  const projParams = [start, end];
  if (!isManager && req.user.role !== 'pm') {
    projQ += ' AND p.id IN (SELECT project_id FROM project_assignments WHERE user_id = ?)';
    projParams.push(req.user.id);
  }
  const projects = req.user.role !== 'planner'
    ? (await db.prepare(projQ).all(...projParams)).map(r => ({ ...r, type: 'project' })) : [];

  // Maintenance visits in the month
  let mvQ = `SELECT mv.id, mv.title, mv.scheduled_date as date, mv.status, mv.report_sent,
    c.name as customer_name
    FROM maintenance_visits mv
    JOIN customers c ON mv.customer_id = c.id
    WHERE mv.scheduled_date >= ? AND mv.scheduled_date < ? AND mv.status != 'cancelled'`;
  const mvParams = [start, end];
  if (!canReadAllVisits) {
    mvQ += ' AND mv.id IN (SELECT visit_id FROM maintenance_visit_engineers WHERE user_id = ?)';
    mvParams.push(req.user.id);
  }
  const rows = await db.prepare(mvQ + ' ORDER BY mv.scheduled_date, mv.id').all(...mvParams);
  const names = new Map();
  if (rows.length) {
    const engineers = await db.prepare(`SELECT mve.visit_id, u.name FROM maintenance_visit_engineers mve
      JOIN users u ON u.id=mve.user_id WHERE mve.visit_id IN (${rows.map(() => '?').join(',')})
      ORDER BY u.name, u.id`).all(...rows.map(row => row.id));
    for (const engineer of engineers) {
      if (!names.has(engineer.visit_id)) names.set(engineer.visit_id, []);
      names.get(engineer.visit_id).push(engineer.name);
    }
  }
  const visits = rows.map(r => ({ ...r, engineer_names: (names.get(r.id) || []).join(', '), customer_name: decrypt(r.customer_name), type: 'maintenance' }));

  res.json({ tasks, projects, visits });
});

module.exports = router;
