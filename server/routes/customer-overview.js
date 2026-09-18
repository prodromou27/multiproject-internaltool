const router = require('express').Router({ mergeParams: true });
const db = require('../db');
const { requireManager } = require('../middleware/auth');

router.get('/', requireManager, async (req, res) => {
  const id = Number(req.params.id);
  if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(id)) return res.status(400).json({ error: 'Invalid customer ID' });
  const customer = await db.prepare('SELECT id FROM customers WHERE id=?').get(id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  const rawPage = req.query.page ?? '1';
  if (typeof rawPage !== 'string' || !/^[1-9]\d*$/.test(rawPage) || !Number.isSafeInteger(Number(rawPage)) || !Number.isSafeInteger((Number(rawPage) - 1) * 25)) return res.status(400).json({ error: 'page must be a safe positive integer' });
  const page = Number(rawPage);
  // These are recorded events. Do not infer completion dates from updated_at.
  const events = `
    SELECT 'project' AS kind, p.id AS entity_id, p.title, p.created_at AS event_at, 'Project created' AS action FROM projects p WHERE p.customer_id=?
    UNION ALL SELECT 'task', t.id, t.title, t.created_at, 'Task created' FROM tasks t JOIN projects p ON p.id=t.project_id WHERE p.customer_id=?
    UNION ALL SELECT 'visit', mv.id, mv.title, mv.created_at, 'Visit scheduled' FROM maintenance_visits mv WHERE mv.customer_id=?
    UNION ALL SELECT 'visit_report', mv.id, mv.title, mv.report_sent_at, 'Report submitted' FROM maintenance_visits mv WHERE mv.customer_id=? AND mv.report_sent=1 AND mv.report_sent_at IS NOT NULL
    UNION ALL SELECT 'visit_forwarded', mv.id, mv.title, mv.report_sent_to_customer_at, 'Report forwarded' FROM maintenance_visits mv WHERE mv.customer_id=? AND mv.report_sent_to_customer=1 AND mv.report_sent_to_customer_at IS NOT NULL
    UNION ALL SELECT 'activity', sa.id, sa.title, sa.created_at, 'Service activity logged' FROM service_activities sa WHERE sa.customer_id=?
    UNION ALL SELECT 'project_event', pa.id, p.title, pa.created_at, pa.action FROM project_activity pa JOIN projects p ON p.id=pa.project_id WHERE p.customer_id=?
    UNION ALL SELECT 'document', a.id, a.original_name, a.created_at, 'Document uploaded' FROM attachments a JOIN projects p ON p.id=a.project_id WHERE p.customer_id=?
    UNION ALL SELECT 'recommendation', h.id, substr(r.finding,1,300), h.created_at, h.action FROM recommendation_history h JOIN customer_recommendations r ON r.id=h.recommendation_id WHERE r.customer_id=?`;
  const eventParams = Array(9).fill(id);
  const [projects, tasks, visits, documents, timeline, totals, counts] = await Promise.all([
    db.prepare('SELECT id,title,status,deadline FROM projects WHERE customer_id=? ORDER BY created_at DESC,id DESC LIMIT 25').all(id),
    db.prepare('SELECT t.id,t.title,t.status,t.deadline,t.project_id,u.name AS assignee FROM tasks t JOIN projects p ON p.id=t.project_id LEFT JOIN users u ON u.id=t.assigned_to WHERE p.customer_id=? ORDER BY t.created_at DESC,t.id DESC LIMIT 25').all(id),
    db.prepare('SELECT id,title,status,scheduled_date,report_sent,report_sent_to_customer FROM maintenance_visits WHERE customer_id=? ORDER BY scheduled_date DESC,id DESC LIMIT 25').all(id),
    db.prepare('SELECT a.id,a.original_name,a.created_at,p.id AS project_id,p.title AS project_title FROM attachments a JOIN projects p ON p.id=a.project_id WHERE p.customer_id=? ORDER BY a.created_at DESC,a.id DESC LIMIT 25').all(id),
    db.prepare(`SELECT * FROM (${events}) events ORDER BY event_at DESC,kind ASC,entity_id DESC LIMIT ? OFFSET ?`).all(...eventParams, 25, (page - 1) * 25),
    db.prepare(`SELECT COUNT(*) AS total FROM (${events}) events`).get(...eventParams),
    db.prepare(`SELECT
      (SELECT COUNT(*) FROM projects WHERE customer_id=?) AS projects,
      (SELECT COUNT(*) FROM tasks t JOIN projects p ON p.id=t.project_id WHERE p.customer_id=?) AS tasks,
      (SELECT COUNT(*) FROM maintenance_visits WHERE customer_id=?) AS visits,
      (SELECT COUNT(*) FROM attachments a JOIN projects p ON p.id=a.project_id WHERE p.customer_id=?) AS documents`).get(id,id,id,id),
  ]);
  res.json({ projects, tasks, visits, documents, timeline, counts: Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, Number(value)])), total: Number(totals.total), page, page_size: 25 });
});

module.exports = router;
