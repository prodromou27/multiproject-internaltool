const appTime = require('./appTime');
const { ownTasksSql, ownTasksParams } = require('./taskAccess');
const FILTERS = new Set(['all', 'open', 'done', 'adhoc', 'waiting_customer', 'overdue', 'due_week', 'due_today', 'pending_approval']);
const SORTS = { created: 't.created_at', task: 't.title', project: 'p.title', status: 't.status', priority: 't.priority', assignee: 'u.name', deadline: 't.deadline' };

function taskFilters(query, user) {
  const scalar = key => query[key] === undefined || typeof query[key] === 'string';
  for (const key of ['filter', 'priority', 'search', 'project_id', 'customer_id', 'assigned_to', 'team_id', 'status', 'due_from', 'due_to', 'adhoc', 'as_of', 'sort', 'direction']) {
    if (!scalar(key)) return { error: `${key} must be a single value` };
  }
  const filter = query.filter ?? 'all';
  if (!FILTERS.has(filter)) return { error: 'Invalid task filter' };
  if (query.priority !== undefined && !['all', 'low', 'medium', 'high', 'critical'].includes(query.priority)) return { error: 'Invalid priority filter' };
  if (query.search?.length > 500) return { error: 'Search cannot exceed 500 characters' };
  for (const key of ['project_id', 'customer_id', 'assigned_to', 'team_id']) {
    if (query[key] !== undefined && (!/^[1-9]\d*$/.test(query[key]) || !Number.isSafeInteger(Number(query[key])))) return { error: `${key} must be a positive integer` };
  }
  if (query.adhoc !== undefined && !['0', '1'].includes(query.adhoc)) return { error: 'adhoc must be 0 or 1' };
  if (query.status !== undefined && !/^[a-z_]{1,40}$/.test(query.status)) return { error: 'Invalid status' };
  for (const key of ['due_from', 'due_to']) {
    const value = query[key];
    if (value !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) return { error: `${key} must be a YYYY-MM-DD date` };
  }
  const asOf = query.as_of ?? appTime.today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || Number(asOf.slice(0, 4)) < 1900 || Number(asOf.slice(0, 4)) > 9998
    || Number.isNaN(Date.parse(asOf)) || new Date(asOf).toISOString().slice(0, 10) !== asOf) return { error: 'as_of must be a valid YYYY-MM-DD date' };
  const sort = query.sort ?? 'created';
  const direction = query.direction ?? (sort === 'created' ? 'desc' : 'asc');
  if (!Object.hasOwn(SORTS, sort) || !['asc', 'desc'].includes(direction)) return { error: 'Invalid task sort' };

  const clauses = ['1=1'];
  const params = [];
  const add = (sql, ...values) => { clauses.push(sql); params.push(...values); };
  if (user.role === 'engineer') add(ownTasksSql('t'), ...ownTasksParams(user.id));
  else if (query.assigned_to) add('t.assigned_to=?', Number(query.assigned_to));
  if (query.project_id) add('t.project_id=?', Number(query.project_id));
  if (query.customer_id) add('COALESCE(t.customer_id,p.customer_id)=?', Number(query.customer_id));
  // A team's tasks: given to the team, or assigned to one of its members.
  if (query.team_id) add('(t.team_id=? OR t.assigned_to IN (SELECT user_id FROM team_members WHERE team_id=?))', Number(query.team_id), Number(query.team_id));
  if (query.status) add('t.status=?', query.status);
  if (query.due_from) add('t.deadline>=?', query.due_from);
  if (query.due_to) add('t.deadline<=?', query.due_to);
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
    add("(LOWER(COALESCE(t.title,'')) ILIKE ? OR LOWER(COALESCE(u.name,'')) ILIKE ? OR LOWER(COALESCE(p.title,'')) ILIKE ? OR LOWER(COALESCE(t.ticket_reference,'')) ILIKE ?)", pattern, pattern, pattern, pattern);
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
