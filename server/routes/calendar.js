const router = require('express').Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { decrypt } = require('../fieldCipher');

// Returns all events for a given month: tasks (by deadline), project deadlines, maintenance visits
router.get('/', requireAuth, async (req, res) => {
  const { month } = req.query; // YYYY-MM
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month param required (YYYY-MM)' });

  const start = month + '-01';
  // Last day: next month minus 1 day
  const [y, m] = month.split('-').map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  const end = nextMonth + '-01';

  const isManager = req.user.role === 'manager';
  const isManagerOrPlanner = req.user.role === 'manager' || req.user.role === 'planner';

  // Tasks with deadlines in the month
  let taskQ = `SELECT t.id, t.title, t.deadline as date, t.status, t.priority, t.is_adhoc, t.assigned_to,
    u.name as assigned_to_name, p.title as project_title
    FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id
    LEFT JOIN projects p ON t.project_id = p.id
    WHERE t.deadline >= ? AND t.deadline < ? AND t.status NOT IN ('completed','closed','cancelled')`;
  const taskParams = [start, end];
  if (!isManager) { taskQ += ' AND t.assigned_to = ?'; taskParams.push(req.user.id); }
  const tasks = (await db.prepare(taskQ).all(...taskParams)).map(r => ({ ...r, type: 'task' }));

  // Project deadlines in the month
  let projQ = `SELECT p.id, p.title, p.deadline as date, p.status, p.priority
    FROM projects p WHERE p.deadline >= ? AND p.deadline < ? AND p.status NOT IN ('closed','cancelled')`;
  const projParams = [start, end];
  if (!isManager) {
    projQ += ' AND EXISTS (SELECT 1 FROM project_assignments pa WHERE pa.project_id = p.id AND pa.user_id = ?)';
    projParams.push(req.user.id);
  }
  const projects = (await db.prepare(projQ).all(...projParams)).map(r => ({ ...r, type: 'project' }));

  // Maintenance visits in the month
  let mvQ = `SELECT mv.id, mv.title, mv.scheduled_date as date, mv.status, mv.report_sent,
    c.name as customer_name,
    (SELECT GROUP_CONCAT(u2.name, ', ')
     FROM maintenance_visit_engineers mve2
     JOIN users u2 ON mve2.user_id = u2.id
     WHERE mve2.visit_id = mv.id) as engineer_names
    FROM maintenance_visits mv
    JOIN customers c ON mv.customer_id = c.id
    WHERE mv.scheduled_date >= ? AND mv.scheduled_date < ? AND mv.status != 'cancelled'`;
  const mvParams = [start, end];
  if (!isManagerOrPlanner) {
    mvQ += ' AND EXISTS (SELECT 1 FROM maintenance_visit_engineers WHERE visit_id = mv.id AND user_id = ?)';
    mvParams.push(req.user.id);
  }
  const visits = (await db.prepare(mvQ).all(...mvParams)).map(r => ({ ...r, customer_name: decrypt(r.customer_name), type: 'maintenance' }));

  res.json({ tasks, projects, visits });
});

module.exports = router;
