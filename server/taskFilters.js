const FILTERS = new Set(['all', 'open', 'done', 'adhoc', 'waiting_customer', 'overdue', 'due_week', 'due_today', 'pending_approval']);
const SORTS = { created: 't.created_at', task: 't.title', project: 'p.title', status: 't.status', priority: 't.priority', assignee: 'u.name', deadline: 't.deadline' };

function taskFilters(query, user) {
  const scalar = key => query[key] === undefined || typeof query[key] === 'string';
  for (const key of ['filter', 'priority', 'search', 'project_id', 'assigned_to', 'adhoc', 'as_of', 'sort', 'direction']) {
    if (!scalar(key)) return { error: `${key} must be a single value` };
  }
  const filter = query.filter ?? 'all';
  if (!FILTERS.has(filter)) return { error: 'Invalid task filter' };
  if (query.priority !== undefined && !['all', 'low', 'medium', 'high', 'critical'].includes(query.priority)) return { error: 'Invalid priority filter' };
  if (query.search?.length > 500) return { error: 'Search cannot exceed 500 characters' };
  for (const key of ['project_id', 'assigned_to']) {
    if (query[key] !== undefined && (!/^[1-9]\d*$/.test(query[key]) || !Number.isSafeInteger(Number(query[key])))) return { error: `${key} must be a positive integer` };
  }
  if (query.adhoc !== undefined && !['0', '1'].includes(query.adhoc)) return { error: 'adhoc must be 0 or 1' };
  const asOf = query.as_of ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || Number(asOf.slice(0, 4)) < 1900 || Number(asOf.slice(0, 4)) > 9998
    || Number.isNaN(Date.parse(asOf)) || new Date(asOf).toISOString().slice(0, 10) !== asOf) return { error: 'as_of must be a valid YYYY-MM-DD date' };
  const sort = query.sort ?? 'created';
  const direction = query.direction ?? (sort === 'created' ? 'desc' : 'asc');
  if (!Object.hasOwn(SORTS, sort) || !['asc', 'desc'].includes(direction)) return { error: 'Invalid task sort' };

  const clauses = ['1=1'];
  const params = [];
  const add = (sql, ...values) => { clauses.push(sql); params.push(...values); };
  if (user.role === 'engineer') add('t.assigned_to=?', user.id);
  else if (query.assigned_to) add('t.assigned_to=?', Number(query.assigned_to));
  if (query.project_id) add('t.project_id=?', Number(query.project_id));
  if (query.adhoc === '1' || filter === 'adhoc') add('t.is_adhoc=1');
  if (filter === 'open') add("t.status IN ('open','in_progress','waiting_customer','waiting_vendor')");
  if (filter === 'done') add("t.status IN ('completed','closed')");
  if (filter === 'waiting_customer') add("t.status IN ('waiting_customer','waiting_vendor')");
  if (filter === 'pending_approval') add("t.status='pending_approval'");
  if (['overdue', 'due_today', 'due_week'].includes(filter)) {
    add("t.status NOT IN ('completed','closed','cancelled')");
    if (filter === 'overdue') add('t.deadline<?', asOf);
    if (filter === 'due_today') add('t.deadline=?', asOf);
    if (filter === 'due_week') {
      const end = new Date(`${asOf}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + 6);
      add('t.deadline BETWEEN ? AND ?', asOf, end.toISOString().slice(0, 10));
    }
  }
  if (query.priority && query.priority !== 'all') add('t.priority=?', query.priority);
  const search = query.search?.trim().toLowerCase();
  if (search) {
    const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
    add("(LOWER(COALESCE(t.title,'')) ILIKE ? OR LOWER(COALESCE(u.name,'')) ILIKE ? OR LOWER(COALESCE(p.title,'')) ILIKE ?)", pattern, pattern, pattern);
  }
  return { where: clauses.join(' AND '), params, as_of: asOf, order: `${SORTS[sort]} ${direction.toUpperCase()} NULLS LAST, t.id ASC` };
}

function taskPagination(query) {
  if (query.page === undefined && query.page_size === undefined) return null;
  for (const key of ['page', 'page_size']) {
    if (query[key] !== undefined && (typeof query[key] !== 'string' || !/^[1-9]\d*$/.test(query[key]) || !Number.isSafeInteger(Number(query[key])))) return { error: `${key} must be a positive integer` };
  }
  const page = Number(query.page || 1);
  const pageSize = Number(query.page_size || 25);
  if (pageSize > 100 || !Number.isSafeInteger((page - 1) * pageSize)) return { error: 'page_size must be at most 100 and the page offset must be safe' };
  return { page, page_size: pageSize, offset: (page - 1) * pageSize };
}

module.exports = { taskFilters, taskPagination };
