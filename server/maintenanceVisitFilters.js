const FILTERS = new Set(['all', 'upcoming', 'past', 'report_pending', 'awaiting_review', 'cancelled']);

function maintenanceVisitFilters(query, user) {
  for (const key of ['month', 'engineer_id', 'customer_id', 'review_pending', 'not_completed', 'overview', 'pending_report', 'filter', 'search', 'as_of']) {
    if (query[key] !== undefined && typeof query[key] !== 'string') return { error: `${key} must be a single value` };
  }
  for (const key of ['engineer_id', 'customer_id']) {
    if (query[key] !== undefined && (!/^[1-9]\d*$/.test(query[key]) || !Number.isSafeInteger(Number(query[key])))) return { error: `${key} must be a positive integer` };
  }
  for (const key of ['review_pending', 'not_completed', 'overview', 'pending_report']) {
    if (query[key] !== undefined && !['0', '1'].includes(query[key])) return { error: `${key} must be 0 or 1` };
  }
  const filter = query.filter ?? 'all';
  if (!FILTERS.has(filter)) return { error: 'Invalid maintenance visit filter' };
  if (query.search?.length > 500) return { error: 'Search cannot exceed 500 characters' };
  const asOf = query.as_of ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || Number(asOf.slice(0, 4)) < 1900 || Number(asOf.slice(0, 4)) > 9998
    || Number.isNaN(Date.parse(asOf)) || new Date(asOf).toISOString().slice(0, 10) !== asOf) return { error: 'as_of must be a valid YYYY-MM-DD date' };
  if (query.month !== undefined && (!/^\d{4}-(0[1-9]|1[0-2])$/.test(query.month) || Number(query.month.slice(0, 4)) < 1900 || Number(query.month.slice(0, 4)) > 9998)) return { error: 'month must be a valid YYYY-MM month' };

  const clauses = ['1=1'];
  const params = [];
  const add = (sql, ...values) => { clauses.push(sql); params.push(...values); };
  // Caller-supplied engineer IDs never replace an engineer's own assignment scope.
  const engineerId = user.role === 'engineer' ? user.id : query.engineer_id && Number(query.engineer_id);
  if (engineerId) add('EXISTS (SELECT 1 FROM maintenance_visit_engineers WHERE visit_id=mv.id AND user_id=?)', engineerId);
  if (query.customer_id) add('mv.customer_id=?', Number(query.customer_id));
  if (query.month) {
    const next = new Date(`${query.month}-01T00:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    add('mv.scheduled_date>=? AND mv.scheduled_date<?', `${query.month}-01`, next.toISOString().slice(0, 10));
  }
  if (filter === 'upcoming') add("mv.status='scheduled' AND mv.scheduled_date>=?", asOf);
  if (filter === 'past') add("(mv.scheduled_date<? OR mv.status='completed')", asOf);
  if (filter === 'cancelled') add("mv.status='cancelled'");
  if (filter === 'report_pending' || query.pending_report === '1') add("mv.report_sent=0 AND mv.status NOT IN ('cancelled','scheduled')");
  if (filter === 'awaiting_review' || query.review_pending === '1') add('mv.report_sent=1 AND mv.report_sent_to_customer=0');
  if (query.not_completed === '1') add("mv.status NOT IN ('completed','cancelled')");
  return { where: clauses.join(' AND '), params, search: query.search?.trim().toLowerCase() || '' };
}

// Customer names are encrypted at rest. Search only already-authorized decrypted
// rows, using literal substring matching just like the visit list in the browser.
function searchMaintenanceVisits(rows, search) {
  if (!search) return rows;
  return rows.filter(row => ['customer_name', 'title', 'engineer_names'].some(key => (row[key] || '').toLowerCase().includes(search)));
}

module.exports = { maintenanceVisitFilters, searchMaintenanceVisits };
