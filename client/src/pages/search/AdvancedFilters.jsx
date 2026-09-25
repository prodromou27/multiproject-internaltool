
// ─────────────────────────────────────────────────────────────────────────────
// Example queries
// ─────────────────────────────────────────────────────────────────────────────
export const EXAMPLES = [
  { label: 'Open projects',                   q: 'open projects' },
  { label: 'Overdue tasks',                   q: 'overdue tasks' },
  { label: 'High priority tasks',             q: 'high priority tasks' },
  { label: 'Unassigned tasks',                q: 'unassigned tasks' },
  { label: 'Projects pending approval',       q: 'projects pending approval' },
  { label: 'Reports not sent',                q: 'maintenance visits reports not sent' },
  { label: 'Visits awaiting approval',        q: 'visits awaiting approval' },
  { label: 'Closed projects',                 q: 'closed projects' },
  { label: 'My tasks',                        q: 'my tasks' },
  { label: 'In progress tasks',               q: 'tasks in progress' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Advanced filter panel
// ─────────────────────────────────────────────────────────────────────────────
export function AdvancedFilters({ filters, setFilters, users, customers, isManager }) {
  const engineers = users.filter(u => u.role === 'engineer');
  const set = (k, v) => setFilters(f => ({ ...f, [k]: v }));

  return (
    <div className="u-4e40d28">
      {/* Entity */}
      <div className="form-group m-0">
        <label className="u-11a5081">Type</label>
        <select value={filters.entity || 'all'} onChange={e => set('entity', e.target.value)}>
          <option value="all">All types</option>
          <option value="projects">Projects</option>
          <option value="tasks">Tasks</option>
          <option value="mv">Maintenance Visits</option>
          {isManager && <option value="customers">Customers</option>}
        </select>
      </div>

      {/* Status */}
      <div className="form-group m-0">
        <label className="u-11a5081">Status</label>
        <select value={filters.status || ''} onChange={e => set('status', e.target.value)}>
          <option value="">Any status</option>
          <optgroup label="Projects">
            <option value="active">Active</option>
            <option value="on_hold">On Hold</option>
            <option value="pending_closure">Pending Closure</option>
            <option value="closed">Closed</option>
          </optgroup>
          <optgroup label="Tasks">
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="done">Done</option>
            <option value="cancelled">Cancelled</option>
          </optgroup>
          <optgroup label="Visits">
            <option value="scheduled">Scheduled</option>
            <option value="completed">Completed</option>
          </optgroup>
        </select>
      </div>

      {/* Priority */}
      <div className="form-group m-0">
        <label className="u-11a5081">Priority</label>
        <select value={filters.priority || ''} onChange={e => set('priority', e.target.value)}>
          <option value="">Any priority</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      {/* Customer */}
      {isManager && customers.length > 0 && (
        <div className="form-group m-0">
          <label className="u-11a5081">Customer</label>
          <select value={filters.customer_id || ''} onChange={e => set('customer_id', e.target.value)}>
            <option value="">Any customer</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}

      {/* Engineer */}
      {isManager && engineers.length > 0 && (
        <div className="form-group m-0">
          <label className="u-11a5081">Assigned to</label>
          <select value={filters.engineer_id || ''} onChange={e => set('engineer_id', e.target.value)}>
            <option value="">Anyone</option>
            {engineers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      )}

      {/* Report status */}
      <div className="form-group m-0">
        <label className="u-11a5081">Report Status</label>
        <select value={filters.report_status || ''} onChange={e => set('report_status', e.target.value)}>
          <option value="">Any</option>
          <option value="pending">Report Pending</option>
          <option value="complete">Report Complete</option>
          <option value="sent_to_pm">Sent to PM</option>
        </select>
      </div>

      {/* Date range */}
      <div className="form-group m-0">
        <label className="u-11a5081">From Date</label>
        <input type="date" value={filters.date_from || ''} onChange={e => set('date_from', e.target.value)} />
      </div>
      <div className="form-group m-0">
        <label className="u-11a5081">To Date</label>
        <input type="date" value={filters.date_to || ''} onChange={e => set('date_to', e.target.value)} />
      </div>

      {/* Boolean toggles */}
      <div className="u-40dd1a7">
        <label className="u-2c7d7c4">
          <input type="checkbox" checked={!!filters.overdue} onChange={e => set('overdue', e.target.checked ? '1' : '')} className="u-30e741d" />
          Overdue only
        </label>
        <label className="u-2c7d7c4">
          <input type="checkbox" checked={!!filters.unassigned} onChange={e => set('unassigned', e.target.checked ? '1' : '')} className="u-30e741d" />
          Unassigned only
        </label>
        {isManager && (
          <label className="u-2c7d7c4">
            <input type="checkbox" checked={!!filters.my_tasks} onChange={e => set('my_tasks', e.target.checked ? '1' : '')} className="u-30e741d" />
            My items only
          </label>
        )}
      </div>
    </div>
  );
}
