const router = require('express').Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { decrypt } = require('../fieldCipher');

// Customer contact fields are encrypted at rest, so a SQL LIKE on them can't
// match. Instead we fetch the set the user is allowed to see, decrypt in the
// app layer, then substring-filter. Visibility mirrors the customers route:
// managers/planners see all; engineers see only customers tied to their own
// projects or maintenance visits.
async function searchCustomers(req, term, limit) {
  const needle = (term || '').trim().toLowerCase();

  let rows;
  if (req.user.role === 'manager' || req.user.role === 'planner') {
    rows = (await db.prepare(`
      SELECT cu.id, cu.name, cu.contact_name, cu.contact_email, cu.contact_phone,
             (SELECT COUNT(*) FROM projects           WHERE customer_id = cu.id) AS project_count,
             (SELECT COUNT(*) FROM maintenance_visits WHERE customer_id = cu.id) AS visit_count
      FROM customers cu ORDER BY cu.name ASC
    `).all());
  } else {
    rows = (await db.prepare(`
      SELECT DISTINCT cu.id, cu.name, cu.contact_name, cu.contact_email, cu.contact_phone,
             (SELECT COUNT(*) FROM projects           WHERE customer_id = cu.id) AS project_count,
             (SELECT COUNT(*) FROM maintenance_visits WHERE customer_id = cu.id) AS visit_count
      FROM customers cu
      WHERE EXISTS (SELECT 1 FROM projects p JOIN project_assignments pa ON pa.project_id = p.id WHERE p.customer_id = cu.id AND pa.user_id = ?)
         OR EXISTS (SELECT 1 FROM maintenance_visits mv JOIN maintenance_visit_engineers mve ON mve.visit_id = mv.id WHERE mv.customer_id = cu.id AND mve.user_id = ?)
      ORDER BY cu.name ASC
    `).all(req.user.id, req.user.id));
  }

  const out = [];
  for (const r of rows) {
    const dec = {
      ...r,
      name:          decrypt(r.name),
      contact_name:  decrypt(r.contact_name),
      contact_email: decrypt(r.contact_email),
      contact_phone: decrypt(r.contact_phone),
    };
    const hay = [dec.name, dec.contact_name, dec.contact_email]
      .filter(Boolean).join(' ').toLowerCase();
    if (!needle || hay.includes(needle)) {
      out.push(dec);
      if (out.length >= limit) break;
    }
  }
  return out;
}

// ── Quick search (top bar dropdown) ──────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ projects: [], tasks: [], customers: [] });

  const like = `%${q}%`;

  let projects;
  if (req.user.role === 'manager') {
    projects = (await db.prepare(`
      SELECT p.id, p.title, p.status, p.priority, p.deadline, cu.name as customer_name
      FROM projects p
      LEFT JOIN customers cu ON p.customer_id = cu.id
      WHERE p.title LIKE ? OR p.description LIKE ?
      ORDER BY p.updated_at DESC LIMIT 8
    `).all(like, like));
  } else {
    projects = (await db.prepare(`
      SELECT p.id, p.title, p.status, p.priority, p.deadline, cu.name as customer_name
      FROM projects p
      JOIN project_assignments pa ON pa.project_id = p.id AND pa.user_id = ?
      LEFT JOIN customers cu ON p.customer_id = cu.id
      WHERE p.title LIKE ? OR p.description LIKE ?
      ORDER BY p.updated_at DESC LIMIT 8
    `).all(req.user.id, like, like));
  }

  let tasks;
  if (req.user.role === 'manager') {
    tasks = (await db.prepare(`
      SELECT t.id, t.title, t.status, t.priority, t.deadline, t.project_id,
             p.title as project_title, u.name as assigned_to_name
      FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      LEFT JOIN users u ON t.assigned_to = u.id
      WHERE t.title LIKE ? OR t.description LIKE ?
      ORDER BY t.updated_at DESC LIMIT 8
    `).all(like, like));
  } else {
    tasks = (await db.prepare(`
      SELECT t.id, t.title, t.status, t.priority, t.deadline, t.project_id,
             p.title as project_title, u.name as assigned_to_name
      FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      LEFT JOIN users u ON t.assigned_to = u.id
      WHERE t.assigned_to = ? AND (t.title LIKE ? OR t.description LIKE ?)
      ORDER BY t.updated_at DESC LIMIT 8
    `).all(req.user.id, like, like));
  }

  // Customers — decrypt-and-filter (PII columns are encrypted at rest).
  // Visibility is enforced inside searchCustomers().
  const customers = (await searchCustomers(req, q, 5))
    .map(({ contact_phone, project_count, visit_count, ...rest }) => rest);

  projects = projects.map(p => ({ ...p, customer_name: decrypt(p.customer_name) }));
  res.json({ projects, tasks, customers });
});

// ── Smart structured search ──────────────────────────────────────────────────
router.get('/smart', requireAuth, async (req, res) => {
  const {
    q = '',
    entity = 'all',     // all | projects | tasks | mv | customers
    status,             // project/task/mv status value
    customer_id,
    engineer_id,
    priority,           // low | medium | high
    overdue,            // '1' = overdue items only
    report_status,      // pending | complete | sent_to_pm
    my_tasks,           // '1' = current user's tasks
    unassigned,         // '1' = unassigned tasks
    date_from,          // YYYY-MM-DD
    date_to,
  } = req.query;

  const like   = q.trim() ? `%${q.trim()}%` : null;
  const today  = new Date().toISOString().slice(0, 10);
  const isMgr  = req.user.role === 'manager';
  const results = {};

  // ── Projects ──────────────────────────────────────────────────────────────
  if (entity === 'all' || entity === 'projects') {
    const c = [], p = [];

    if (!isMgr) {
      c.push('EXISTS (SELECT 1 FROM project_assignments WHERE project_id = p.id AND user_id = ?)');
      p.push(req.user.id);
    }
    if (like) {
      c.push('(p.title LIKE ? OR p.description LIKE ? OR cu.name LIKE ?)');
      p.push(like, like, like);
    }
    if (status)      { c.push('p.status = ?');           p.push(status); }
    if (customer_id) { c.push('p.customer_id = ?');      p.push(customer_id); }
    if (priority)    { c.push('p.priority = ?');         p.push(priority); }
    if (overdue === '1') {
      c.push("p.deadline IS NOT NULL AND p.deadline < ? AND p.status NOT IN ('closed','cancelled')");
      p.push(today);
    }
    if (date_from) { c.push('date(p.created_at) >= ?'); p.push(date_from); }
    if (date_to)   { c.push('date(p.created_at) <= ?'); p.push(date_to); }

    const where = c.length ? 'WHERE ' + c.join(' AND ') : '';
    results.projects = (await db.prepare(`
      SELECT p.id, p.title, p.status, p.priority, p.deadline,
             cu.name AS customer_name, u.name AS created_by_name,
             (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND status != 'cancelled') AS task_count,
             (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND status IN ('completed','closed')) AS done_count
      FROM projects p
      LEFT JOIN customers cu ON p.customer_id = cu.id
      LEFT JOIN users u ON p.created_by = u.id
      ${where}
      ORDER BY p.updated_at DESC LIMIT 50
    `).all(...p)).map(r => ({ ...r, customer_name: decrypt(r.customer_name) }));
  }

  // ── Tasks ─────────────────────────────────────────────────────────────────
  if (entity === 'all' || entity === 'tasks') {
    const c = [], p = [];

    // Role-based security
    if (req.user.role === 'engineer') {
      c.push('t.assigned_to = ?');
      p.push(req.user.id);
    } else if (req.user.role === 'planner' || req.user.role === 'pm') {
      // Scope to projects this user is assigned to (plus unlinked tasks)
      c.push('(t.project_id IS NULL OR t.project_id IN (SELECT project_id FROM project_assignments WHERE user_id = ?))');
      p.push(req.user.id);
      if (my_tasks === '1') {
        c.push('t.assigned_to = ?'); p.push(req.user.id);
      } else if (engineer_id) {
        c.push('t.assigned_to = ?'); p.push(engineer_id);
      }
    } else {
      // Manager — unrestricted; allow optional filters
      if (my_tasks === '1') {
        c.push('t.assigned_to = ?'); p.push(req.user.id);
      } else if (engineer_id) {
        c.push('t.assigned_to = ?'); p.push(engineer_id);
      }
    }

    if (like) {
      c.push('(t.title LIKE ? OR t.description LIKE ? OR p.title LIKE ?)');
      p.push(like, like, like);
    }
    if (status) {
      if (status === 'open') {
        c.push("t.status IN ('open','in_progress')");
      } else {
        c.push('t.status = ?'); p.push(status);
      }
    }
    if (customer_id) { c.push('p.customer_id = ?');    p.push(customer_id); }
    if (priority)    { c.push('t.priority = ?');       p.push(priority); }
    if (unassigned === '1') { c.push('t.assigned_to IS NULL'); }
    if (overdue === '1') {
      c.push("t.deadline IS NOT NULL AND t.deadline < ? AND t.status NOT IN ('completed','closed','cancelled')");
      p.push(today);
    }
    if (date_from) { c.push('date(t.created_at) >= ?'); p.push(date_from); }
    if (date_to)   { c.push('date(t.created_at) <= ?'); p.push(date_to); }

    const where = c.length ? 'WHERE ' + c.join(' AND ') : '';
    results.tasks = (await db.prepare(`
      SELECT t.id, t.title, t.status, t.priority, t.deadline, t.project_id, t.is_adhoc,
             t.created_at,
             p.title AS project_title, p.status AS project_status,
             u.name  AS assigned_to_name, u.id AS assigned_to_id,
             cu.name AS customer_name
      FROM tasks t
      LEFT JOIN projects p  ON t.project_id  = p.id
      LEFT JOIN users u     ON t.assigned_to = u.id
      LEFT JOIN customers cu ON p.customer_id = cu.id
      ${where}
      ORDER BY CASE t.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
               t.deadline ASC, t.updated_at DESC
      LIMIT 50
    `).all(...p)).map(r => ({ ...r, customer_name: decrypt(r.customer_name) }));
  }

  // ── Maintenance Visits ────────────────────────────────────────────────────
  if (entity === 'all' || entity === 'mv') {
    const c = [], p = [];

    if (req.user.role === 'engineer') {
      c.push('EXISTS (SELECT 1 FROM maintenance_visit_engineers WHERE visit_id = mv.id AND user_id = ?)');
      p.push(req.user.id);
    }
    if (like) {
      c.push('(mv.title LIKE ? OR cu.name LIKE ? OR mv.description LIKE ?)');
      p.push(like, like, like);
    }
    if (status)      { c.push('mv.status = ?');      p.push(status); }
    if (customer_id) { c.push('mv.customer_id = ?'); p.push(customer_id); }
    if (engineer_id) {
      c.push('EXISTS (SELECT 1 FROM maintenance_visit_engineers WHERE visit_id = mv.id AND user_id = ?)');
      p.push(engineer_id);
    }
    if (report_status === 'pending')   c.push("mv.report_sent = 0 AND mv.status != 'cancelled'");
    if (report_status === 'complete')  c.push('mv.report_sent = 1 AND mv.report_sent_to_customer = 0');
    if (report_status === 'sent_to_pm') c.push('mv.report_sent_to_customer = 1');
    if (overdue === '1') {
      c.push("mv.scheduled_date < ? AND mv.status NOT IN ('completed','cancelled')");
      p.push(today);
    }
    if (date_from) { c.push('mv.scheduled_date >= ?'); p.push(date_from); }
    if (date_to)   { c.push('mv.scheduled_date <= ?'); p.push(date_to); }

    const where = c.length ? 'WHERE ' + c.join(' AND ') : '';
    results.mv = (await db.prepare(`
      SELECT mv.id, mv.title, mv.status, mv.scheduled_date,
             mv.report_sent, mv.report_sent_to_customer,
             cu.name AS customer_name,
             (SELECT GROUP_CONCAT(u2.name, ', ')
              FROM maintenance_visit_engineers mve2 JOIN users u2 ON mve2.user_id = u2.id
              WHERE mve2.visit_id = mv.id) AS engineer_names
      FROM maintenance_visits mv
      JOIN customers cu ON mv.customer_id = cu.id
      ${where}
      ORDER BY mv.scheduled_date DESC LIMIT 50
    `).all(...p)).map(r => ({ ...r, customer_name: decrypt(r.customer_name) }));
  }

  // ── Customers ─────────────────────────────────────────────────────────────
  // PII columns are encrypted at rest, so matching happens in the app layer
  // (decrypt-and-filter). Visibility + substring matching live in searchCustomers().
  if (entity === 'all' || entity === 'customers') {
    results.customers = await searchCustomers(req, q, 20);
  }

  res.json({
    projects:  results.projects  || [],
    tasks:     results.tasks     || [],
    mv:        results.mv        || [],
    customers: results.customers || [],
  });
});

module.exports = router;
