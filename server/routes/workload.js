const router = require('express').Router();
const db = require('../db');
const { requireManager } = require('../middleware/auth');

// GET /api/workload — full engineer workload snapshot
// Replaces 4N individual queries with 4 batched queries (was: 80 queries for 20 engineers)
router.get('/', requireManager, (req, res) => {
  const engineers = db.prepare(
    "SELECT id, name, email FROM users WHERE role = 'engineer' AND active = 1 ORDER BY name ASC"
  ).all();

  if (!engineers.length) return res.json([]);

  const engineerIds = engineers.map(e => e.id);
  const ph = engineerIds.map(() => '?').join(',');
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM

  // Batch 1: all open/in-progress tasks for all engineers
  const allTasks = db.prepare(`
    SELECT t.id, t.title, t.status, t.priority, t.deadline, t.assigned_to,
           p.title AS project_title
    FROM tasks t
    LEFT JOIN projects p ON t.project_id = p.id
    WHERE t.assigned_to IN (${ph}) AND t.status IN ('open', 'in_progress')
    ORDER BY t.deadline ASC NULLS LAST
  `).all(...engineerIds);

  // Batch 2: done-this-month count per engineer
  const doneCounts = db.prepare(`
    SELECT assigned_to, COUNT(*) AS c FROM tasks
    WHERE assigned_to IN (${ph}) AND status IN ('completed','closed')
      AND strftime('%Y-%m', updated_at) = ?
    GROUP BY assigned_to
  `).all(...engineerIds, month);

  // Batch 3: upcoming visits for all engineers
  const allVisits = db.prepare(`
    SELECT mv.id, mv.title, mv.scheduled_date, mv.status,
           c.name AS customer_name, mve.user_id
    FROM maintenance_visits mv
    JOIN maintenance_visit_engineers mve ON mve.visit_id = mv.id
    JOIN customers c ON mv.customer_id = c.id
    WHERE mve.user_id IN (${ph}) AND mv.status IN ('scheduled', 'in_progress')
    ORDER BY mv.scheduled_date ASC
  `).all(...engineerIds);

  // Batch 4: hours logged this month per engineer
  const allHours = db.prepare(`
    SELECT user_id, COALESCE(SUM(hours), 0) AS total FROM time_logs
    WHERE user_id IN (${ph}) AND strftime('%Y-%m', logged_at) = ?
    GROUP BY user_id
  `).all(...engineerIds, month);

  // Build lookup maps
  const tasksMap  = {}, doneMap = {}, visitsMap = {}, hoursMap = {};
  engineerIds.forEach(id => { tasksMap[id] = []; visitsMap[id] = []; doneMap[id] = 0; hoursMap[id] = 0; });
  allTasks.forEach(t  => tasksMap[t.assigned_to].push(t));
  doneCounts.forEach(r => { doneMap[r.assigned_to] = r.c; });
  allVisits.forEach(v => visitsMap[v.user_id].push(v));
  allHours.forEach(r  => { hoursMap[r.user_id] = Math.round(r.total * 10) / 10; });

  const result = engineers.map(eng => ({
    ...eng,
    open_tasks:       tasksMap[eng.id],
    visits:           visitsMap[eng.id],
    done_this_month:  doneMap[eng.id],
    hours_this_month: hoursMap[eng.id],
  }));

  res.json(result);
});

// GET /api/workload/forecast — 4-week capacity grid
// Replaces 8N queries with 8 batched queries (was: 160 queries for 20 engineers)
router.get('/forecast', requireManager, (req, res) => {
  const engineers = db.prepare(
    "SELECT id, name FROM users WHERE role = 'engineer' AND active = 1 ORDER BY name ASC"
  ).all();

  if (!engineers.length) return res.json([]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayOfWeek   = today.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(today);
  monday.setDate(monday.getDate() + mondayOffset);

  const weeks = Array.from({ length: 4 }, (_, i) => {
    const start = new Date(monday);
    start.setDate(start.getDate() + i * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return {
      label:      i === 0 ? 'This week' : i === 1 ? 'Next week' : `+${i}w`,
      date_range: start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      start:      start.toISOString().slice(0, 10),
      end:        end.toISOString().slice(0, 10),
    };
  });

  const rangeStart = weeks[0].start;
  const rangeEnd   = weeks[weeks.length - 1].end;
  const engineerIds = engineers.map(e => e.id);
  const ph = engineerIds.map(() => '?').join(',');

  // Batch 1: all upcoming tasks in the 4-week window for all engineers
  const allTasks = db.prepare(`
    SELECT t.id, t.title, t.priority, t.deadline, t.assigned_to,
           p.title AS project_title
    FROM tasks t
    LEFT JOIN projects p ON t.project_id = p.id
    WHERE t.assigned_to IN (${ph})
      AND t.status NOT IN ('completed','closed','cancelled')
      AND t.deadline >= ? AND t.deadline <= ?
    ORDER BY t.deadline ASC
  `).all(...engineerIds, rangeStart, rangeEnd);

  // Batch 2: all upcoming visits in the 4-week window for all engineers
  const allVisits = db.prepare(`
    SELECT mv.id, mv.title, mv.scheduled_date, mv.status,
           c.name AS customer_name, mve.user_id
    FROM maintenance_visits mv
    JOIN maintenance_visit_engineers mve ON mve.visit_id = mv.id
    JOIN customers c ON mv.customer_id = c.id
    WHERE mve.user_id IN (${ph})
      AND mv.status NOT IN ('completed','cancelled')
      AND mv.scheduled_date >= ? AND mv.scheduled_date <= ?
    ORDER BY mv.scheduled_date ASC
  `).all(...engineerIds, rangeStart, rangeEnd);

  const result = engineers.map(eng => {
    const weekData = weeks.map(w => {
      const tasks  = allTasks.filter(t => t.assigned_to === eng.id && t.deadline  >= w.start && t.deadline  <= w.end);
      const visits = allVisits.filter(v => v.user_id    === eng.id && v.scheduled_date >= w.start && v.scheduled_date <= w.end);
      return { ...w, tasks, visits, total: tasks.length + visits.length };
    });
    return { ...eng, weeks: weekData };
  });

  res.json(result);
});

module.exports = router;
