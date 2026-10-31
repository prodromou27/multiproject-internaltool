const router = require('express').Router();
// Escape LIKE wildcards so a literal % or _ typed in the search box matches itself.
const escapeLike = value => value.replace(/[\\%_]/g, m => '\\' + m);
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { decrypt } = require('../fieldCipher');
const { ownTasksSql, ownTasksParams } = require('../taskAccess');
const { accessibleCustomerIds } = require('../customerAccess');
const { hasPermission } = require('../permissions');
const { candidateAssetIds } = require('../assetSearchIndex');
const { candidateCustomerIds } = require('../customerSearchIndex');

/* Assets: name, hostname, serial, tag, IP, MAC and model are encrypted at rest.
   The blind index (assetSearchIndex.js) picks the assets that hold every 3-letter
   piece of the term; SQL limits them to the customers this person may see; only
   those are decrypted and checked. Without the index (a 2-letter term, or no field
   key) at most SCAN_LIMIT of the newest assets are checked. Managers (assets.access)
   search every customer's assets; engineers those of the customers they work with —
   the same rule as Customer 360 → Assets. Each hit says which field matched. */
const SCAN_LIMIT = 1000;
const ASSET_FIELDS = [['name', 'Name'], ['hostname', 'Hostname'], ['serial_number', 'Serial'], ['asset_tag', 'Asset tag'], ['ip_address', 'IP'], ['mac_address', 'MAC'], ['model', 'Model']];
async function searchAssets(user, term, limit) {
  const needle = term.toLowerCase();
  const all = await hasPermission(user, 'assets.access');
  const allowed = all ? null : user.role === 'engineer' ? await accessibleCustomerIds(user) : new Set();
  if (allowed && !allowed.size) return [];
  const candidates = await candidateAssetIds(db, term);
  if (candidates && !candidates.size) return [];
  const where = ['c.active = 1'], params = [];
  const inList = (column, ids) => { where.push(`${column} IN (${ids.map(() => '?').join(',')})`); params.push(...ids); };
  if (allowed) inList('a.customer_id', [...allowed]);
  if (candidates) inList('a.id', [...candidates]);
  const rows = await db.prepare(`SELECT a.id, a.customer_id, a.asset_type, a.lifecycle_status, ${ASSET_FIELDS.map(([f]) => `a.${f}`).join(', ')}, c.name AS customer_name
    FROM customer_assets a JOIN customers c ON c.id = a.customer_id WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT ?`).all(...params, SCAN_LIMIT);
  const out = [];
  for (const row of rows) {
    for (const [field, label] of ASSET_FIELDS) {
      const value = decrypt(row[field]);
      if (value && String(value).toLowerCase().includes(needle)) {
        out.push({ id: row.id, customer_id: row.customer_id, customer_name: decrypt(row.customer_name), name: decrypt(row.name), asset_type: row.asset_type,
          retired: ['retired', 'decommissioned'].includes(row.lifecycle_status), matched: field === 'name' ? null : { field: label, value } });
        break;
      }
    }
    if (out.length >= limit) break;
  }
  return out;
}

// Customer contact fields are encrypted at rest, so a SQL LIKE on them can't
// match. Instead we fetch the set the user is allowed to see, decrypt in the
// app layer, then substring-filter. Visibility mirrors the customers route:
// managers/planners see all; engineers see only customers tied to their own
// projects or maintenance visits.
async function searchCustomers(req, term, limit, offset = 0) {
  const needle = (term || '').trim().toLowerCase();

  // The customer blind index (customerSearchIndex.js) narrows the rows to likely
  // matches before anything is decrypted; without it (a 2-letter term, no field
  // key) every customer this person may see is checked.
  const candidates = needle ? await candidateCustomerIds(db, needle) : null;
  if (candidates && !candidates.size) return [];
  const only = candidates ? ` AND id IN (${[...candidates].map(() => '?').join(',')})` : '';
  const onlyParams = candidates ? [...candidates] : [];
  // Names are encrypted, so rows are sorted by the decrypted name below.
  let rows;
  if (req.user.role === 'engineer') {
    // The customers an engineer works with (customerAccess.js), as on Customers and Customer 360.
    const allowed = await accessibleCustomerIds(req.user);
    rows = (await db.prepare(`SELECT id, name, project_name, contact_name, contact_email, contact_phone FROM customers WHERE 1=1${only}`).all(...onlyParams)).filter(row => allowed.has(Number(row.id)));
  } else if (req.user.role === 'manager' || req.user.role === 'planner') {
    rows = await db.prepare(`SELECT id, name, project_name, contact_name, contact_email, contact_phone FROM customers WHERE 1=1${only}`).all(...onlyParams);
  } else {
    rows = await db.prepare(`SELECT id, name, project_name, contact_name, contact_email, contact_phone FROM customers
      WHERE (id IN (SELECT p.customer_id FROM projects p JOIN project_assignments pa ON pa.project_id = p.id WHERE pa.user_id = ?)
         OR id IN (SELECT mv.customer_id FROM maintenance_visits mv JOIN maintenance_visit_engineers mve ON mve.visit_id = mv.id WHERE mve.user_id = ?))${only}`).all(req.user.id, req.user.id, ...onlyParams);
  }
  rows = rows.map(row => ({ ...row, sortName: String(decrypt(row.name) || '').toLowerCase() })).sort((a, b) => a.sortName.localeCompare(b.sortName));

  const out = [];
  let matched=0;
  for (const { sortName, ...r } of rows) {
    const dec = {
      ...r,
      name:          decrypt(r.name),
      project_name:  decrypt(r.project_name) || null,
      contact_name:  decrypt(r.contact_name),
      contact_email: decrypt(r.contact_email),
      contact_phone: decrypt(r.contact_phone),
    };
    const hay = [dec.name, dec.project_name, dec.contact_name, dec.contact_email]
      .filter(Boolean).join(' ').toLowerCase();
    if (!needle || hay.includes(needle)) {
      if (matched >= offset) out.push(dec);
      matched += 1;
      if (out.length >= limit) break;
    }
  }
  return out;
}

// customers.name is encrypted at rest, so it can't be matched with SQL LIKE.
// Returns the ids of customers whose decrypted name contains `term` — callers
// OR this into their WHERE clause (e.g. `p.customer_id IN (...)`) alongside
// their own plaintext-column LIKE conditions.
async function matchingCustomerIds(term) {
  const needle = (term || '').trim().toLowerCase();
  if (!needle) return [];
  // The blind index narrows the names to decrypt (all of them for a 2-letter term).
  const candidates = await candidateCustomerIds(db, needle);
  if (candidates && !candidates.size) return [];
  const rows = candidates
    ? await db.prepare(`SELECT id, name, project_name FROM customers WHERE id IN (${[...candidates].map(() => '?').join(',')})`).all(...candidates)
    : await db.prepare('SELECT id, name, project_name FROM customers').all();
  // The name or the project name (a customer's nickname).
  return rows.filter(r => [decrypt(r.name), decrypt(r.project_name)].some(v => v?.toLowerCase().includes(needle))).map(r => r.id);
}

// ── Quick search (top bar dropdown) ──────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  if (req.query.q !== undefined && (typeof req.query.q !== 'string' || req.query.q.length > 200))
    return res.status(400).json({ error: 'Search must be text of at most 200 characters' });
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ projects: [], tasks: [], customers: [], assets: [], visits: [], tickets: [] });

  const like = `%${escapeLike(q)}%`;
  // Every group follows its module permission, as the module's own pages do.
  const [canProjects, canTasks, canCustomers, canVisits] = await Promise.all(['projects.access', 'tasks.access', 'customers.access', 'visits.access'].map(key => hasPermission(req.user, key)));

  let projects;
  if (!canProjects) projects = [];
  else if (req.user.role === 'manager' || req.user.role === 'pm') {
    projects = (await db.prepare(`
      SELECT p.id, p.title, p.status, p.priority, p.deadline, cu.name as customer_name
      FROM projects p
      LEFT JOIN customers cu ON p.customer_id = cu.id
      WHERE p.title ILIKE ? OR p.description ILIKE ?
      ORDER BY p.updated_at DESC LIMIT 8
    `).all(like, like));
  } else {
    projects = (await db.prepare(`
      SELECT p.id, p.title, p.status, p.priority, p.deadline, cu.name as customer_name
      FROM projects p
      JOIN project_assignments pa ON pa.project_id = p.id AND pa.user_id = ?
      LEFT JOIN customers cu ON p.customer_id = cu.id
      WHERE p.title ILIKE ? OR p.description ILIKE ?
      ORDER BY p.updated_at DESC LIMIT 8
    `).all(req.user.id, like, like));
  }

  let tasks;
  if (!canTasks) tasks = [];
  else if (req.user.role === 'manager') {
    tasks = (await db.prepare(`
      SELECT t.id, t.title, t.status, t.priority, t.deadline, t.project_id, COALESCE(t.customer_id, p.customer_id) AS customer_id,
             p.title as project_title, u.name as assigned_to_name
      FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      LEFT JOIN users u ON t.assigned_to = u.id
      WHERE t.title ILIKE ? OR t.description ILIKE ?
      ORDER BY t.updated_at DESC LIMIT 8
    `).all(like, like));
  } else if (req.user.role === 'planner' || req.user.role === 'pm') {
    tasks = [];
  } else {
    tasks = (await db.prepare(`
      SELECT t.id, t.title, t.status, t.priority, t.deadline, t.project_id, COALESCE(t.customer_id, p.customer_id) AS customer_id,
             p.title as project_title, u.name as assigned_to_name
      FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      LEFT JOIN users u ON t.assigned_to = u.id
      WHERE ${ownTasksSql('t')} AND (t.title ILIKE ? OR t.description ILIKE ?)
      ORDER BY t.updated_at DESC LIMIT 8
    `).all(...ownTasksParams(req.user.id), like, like));
  }

  // Customers — decrypt-and-filter (PII columns are encrypted at rest).
  // Visibility is enforced inside searchCustomers().
  const customers = !canCustomers ? [] : (await searchCustomers(req, q, 5))
    .map(({ contact_phone, ...rest }) => rest);

  projects = projects.map(p => ({ ...p, customer_name: decrypt(p.customer_name) }));

  const assets = await searchAssets(req.user, q, 8);

  // Maintenance visits: by title or customer; engineers see the visits they are on.
  const visitCustomers = await matchingCustomerIds(q);
  const visitWhere = `(mv.title ILIKE ?${visitCustomers.length ? ` OR mv.customer_id IN (${visitCustomers.map(() => '?').join(',')})` : ''})`;
  const visits = !canVisits ? [] : req.user.role === 'engineer'
    ? await db.prepare(`SELECT mv.id, mv.title, mv.status, mv.scheduled_date, mv.customer_id, cu.name AS customer_name FROM maintenance_visits mv JOIN maintenance_visit_engineers e ON e.visit_id = mv.id AND e.user_id = ? JOIN customers cu ON cu.id = mv.customer_id
        WHERE ${visitWhere} ORDER BY mv.scheduled_date DESC LIMIT 6`).all(req.user.id, like, ...visitCustomers)
    : await db.prepare(`SELECT mv.id, mv.title, mv.status, mv.scheduled_date, mv.customer_id, cu.name AS customer_name FROM maintenance_visits mv JOIN customers cu ON cu.id = mv.customer_id
          WHERE ${visitWhere} ORDER BY mv.scheduled_date DESC LIMIT 6`).all(like, ...visitCustomers);

  // Tickets synced from Request Tracker: by number or subject (people who may see managed customers).
  const tickets = await hasPermission(req.user, 'managed_customers.view')
    ? await db.prepare(`SELECT t.id, t.ticket_number, t.subject, t.status_group, t.customer_id, cu.name AS customer_name FROM external_tickets t JOIN customers cu ON cu.id = t.customer_id
        WHERE t.ticket_number ILIKE ? OR t.subject ILIKE ? ORDER BY t.id DESC LIMIT 6`).all(like, like)
    : [];

  res.json({ projects, tasks, customers, assets,
    visits: visits.map(v => ({ ...v, customer_name: decrypt(v.customer_name) })),
    tickets: tickets.map(t => ({ ...t, customer_name: decrypt(t.customer_name) })) });
});

// ── Smart structured search ──────────────────────────────────────────────────
router.get('/smart', requireAuth, async (req, res) => {
  if (Object.values(req.query).some(value => typeof value !== 'string') || (req.query.q || '').length > 200)
    return res.status(400).json({ error: 'Search filters must be text; search is limited to 200 characters' });
  if (req.query.entity && !['all', 'projects', 'tasks', 'mv', 'customers'].includes(req.query.entity))
    return res.status(400).json({ error: 'Invalid search entity' });
  const page=Number(req.query.page || 1),pageSize=Number(req.query.page_size || 25);
  if (!Number.isSafeInteger(page) || page<1 || page>10_000 || !Number.isSafeInteger(pageSize) || pageSize<1 || pageSize>50 || !Number.isSafeInteger((page-1)*pageSize))
    return res.status(400).json({ error:'Invalid search pagination' });
  const offset=(page-1)*pageSize,fetchSize=pageSize+1,hasMore={ projects:false,tasks:false,mv:false,customers:false };
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

  const like   = q.trim() ? `%${escapeLike(q.trim())}%` : null;
  const today  = (await db.prepare('SELECT app_today() AS d').get()).d;
  const isMgr  = req.user.role === 'manager';
  const results = {};

  // ── Projects ──────────────────────────────────────────────────────────────
  if (entity === 'all' || entity === 'projects') {
    const c = [], p = [];

    if (!isMgr && req.user.role !== 'pm') {
      c.push('EXISTS (SELECT 1 FROM project_assignments WHERE project_id = p.id AND user_id = ?)');
      p.push(req.user.id);
    }
    if (like) {
      const customerIds = await matchingCustomerIds(q);
      if (customerIds.length) {
        c.push(`(p.title ILIKE ? OR p.description ILIKE ? OR p.customer_id IN (${customerIds.map(() => '?').join(',')}))`);
        p.push(like, like, ...customerIds);
      } else {
        c.push('(p.title ILIKE ? OR p.description ILIKE ?)');
        p.push(like, like);
      }
    }
    if (status)      { c.push('p.status = ?');           p.push(status); }
    if (customer_id) { c.push('p.customer_id = ?');      p.push(customer_id); }
    if (priority)    { c.push('p.priority = ?');         p.push(priority); }
    if (overdue === '1') {
      c.push("p.deadline IS NOT NULL AND p.deadline < ? AND p.status NOT IN ('closed','cancelled')");
      p.push(today);
    }
    if (date_from) { c.push('substr(p.created_at,1,10) >= ?'); p.push(date_from); }
    if (date_to)   { c.push('substr(p.created_at,1,10) <= ?'); p.push(date_to); }

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
      ORDER BY p.updated_at DESC LIMIT ? OFFSET ?
    `).all(...p,fetchSize,offset)).map(r => ({ ...r, customer_name: decrypt(r.customer_name) }));
    hasMore.projects=results.projects.length>pageSize;results.projects=results.projects.slice(0,pageSize);
  }

  // ── Tasks ─────────────────────────────────────────────────────────────────
  if (entity === 'all' || entity === 'tasks') {
    const c = [], p = [];

    // Role-based security
    if (req.user.role === 'engineer') {
      c.push(ownTasksSql('t'));
      p.push(...ownTasksParams(req.user.id));
    } else if (req.user.role === 'planner' || req.user.role === 'pm') {
      c.push('1=0');
    } else {
      // Manager — unrestricted; allow optional filters
      if (my_tasks === '1') {
        c.push('t.assigned_to = ?'); p.push(req.user.id);
      } else if (engineer_id) {
        c.push('t.assigned_to = ?'); p.push(engineer_id);
      }
    }

    if (like) {
      c.push('(t.title ILIKE ? OR t.description ILIKE ? OR p.title ILIKE ?)');
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
    if (date_from) { c.push('substr(t.created_at,1,10) >= ?'); p.push(date_from); }
    if (date_to)   { c.push('substr(t.created_at,1,10) <= ?'); p.push(date_to); }

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
      LIMIT ? OFFSET ?
    `).all(...p,fetchSize,offset)).map(r => ({ ...r, customer_name: decrypt(r.customer_name) }));
    hasMore.tasks=results.tasks.length>pageSize;results.tasks=results.tasks.slice(0,pageSize);
  }

  // ── Maintenance Visits ────────────────────────────────────────────────────
  if (entity === 'all' || entity === 'mv') {
    const c = [], p = [];

    if (req.user.role === 'engineer') {
      c.push('EXISTS (SELECT 1 FROM maintenance_visit_engineers WHERE visit_id = mv.id AND user_id = ?)');
      p.push(req.user.id);
    }
    if (like) {
      const customerIds = await matchingCustomerIds(q);
      if (customerIds.length) {
        c.push(`(mv.title ILIKE ? OR mv.description ILIKE ? OR mv.customer_id IN (${customerIds.map(() => '?').join(',')}))`);
        p.push(like, like, ...customerIds);
      } else {
        c.push('(mv.title ILIKE ? OR mv.description ILIKE ?)');
        p.push(like, like);
      }
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
             (SELECT string_agg(u2.name, ', ')
              FROM maintenance_visit_engineers mve2 JOIN users u2 ON mve2.user_id = u2.id
              WHERE mve2.visit_id = mv.id) AS engineer_names
      FROM maintenance_visits mv
      JOIN customers cu ON mv.customer_id = cu.id
      ${where}
      ORDER BY mv.scheduled_date DESC LIMIT ? OFFSET ?
    `).all(...p,fetchSize,offset)).map(r => ({ ...r, customer_name: decrypt(r.customer_name) }));
    hasMore.mv=results.mv.length>pageSize;results.mv=results.mv.slice(0,pageSize);
  }

  // ── Customers ─────────────────────────────────────────────────────────────
  // PII columns are encrypted at rest, so matching happens in the app layer
  // (decrypt-and-filter). Visibility + substring matching live in searchCustomers().
  if (entity === 'all' || entity === 'customers') {
    results.customers = await searchCustomers(req, q, fetchSize, offset);
    hasMore.customers=results.customers.length>pageSize;results.customers=results.customers.slice(0,pageSize);
  }

  res.json({
    projects:  results.projects  || [],
    tasks:     results.tasks     || [],
    mv:        results.mv        || [],
    customers: results.customers || [],
    pagination:{ page,page_size:pageSize,has_more:hasMore },
  });
});

module.exports = router;
