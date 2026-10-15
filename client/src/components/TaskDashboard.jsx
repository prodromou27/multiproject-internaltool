import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarClock, CheckCheck, CheckSquare, Clock, Hourglass, ListChecks, ListTodo, UserX } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api';
import { fmtDate, sentenceCase } from './Shared';
import { Attention, Chart, Figure, PERIODS, bucketLabel, plural, tick, tooltip } from './ManagementInsights';
import { useLiveVersion } from '../live';
import './ManagementInsights.css';

/* Reports → Tasks: a Monday.com-style dashboard of the tasks for a period, with
   filters (customer, team, engineer). Server: taskInsights.js (/api/insights/tasks). */

const STATUS_LABELS = { open: 'Open', in_progress: 'In progress', waiting_customer: 'Waiting on customer', waiting_vendor: 'Waiting on vendor', pending_approval: 'Pending approval' };
const STATUS_COLORS = { open: 'var(--primary)', in_progress: 'var(--success)', waiting_customer: 'var(--warning)', waiting_vendor: 'var(--warning)', pending_approval: 'var(--gray-500)' };
const PRIORITY_COLORS = { critical: 'var(--danger)', high: 'var(--warning)', medium: 'var(--primary)', low: 'var(--gray-400)' };
const taskLink = task => (task.customer_id ? `/customers/${task.customer_id}/service-profile?section=tasks&task=${task.id}` : task.project_id ? `/projects/${task.project_id}` : '/tasks');

export default function TaskDashboard() {
  const [days, setDays] = useState(90), [filters, setFilters] = useState({ customer_id: '', team_id: '', engineer_id: '' });
  const [options, setOptions] = useState(null), [data, setData] = useState(null), [error, setError] = useState('');
  const live = useLiveVersion();
  useEffect(() => {
    Promise.all([api.customers().catch(() => []), api.teams().catch(() => []), api.users().catch(() => [])]).then(([customers, teams, users]) => setOptions({
      customers: (Array.isArray(customers) ? customers : customers.rows || []).filter(c => c.active !== 0).sort((a, b) => a.name.localeCompare(b.name)),
      teams: teams || [], engineers: (users || []).filter(u => u.role === 'engineer' && u.active !== 0),
    }));
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    api.taskInsights(days, filters, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) { setData(result); setError(''); } })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [days, filters, live]);

  const set = key => event => setFilters(current => ({ ...current, [key]: event.target.value }));
  const header = <div className="mi-head">
    <div><h2><ListTodo size={18} aria-hidden="true" /> Tasks</h2>{data && <p className="text-muted text-sm">{fmtDate(data.period.from)} – {fmtDate(data.period.to)} · open work as of today</p>}</div>
    {options && <div className="mi-filters">
      <label>Customer<select value={filters.customer_id} onChange={set('customer_id')}><option value="">All customers</option>{options.customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>Team<select value={filters.team_id} onChange={set('team_id')}><option value="">All teams</option>{options.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <label>Engineer<select value={filters.engineer_id} onChange={set('engineer_id')}><option value="">All engineers</option>{options.engineers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
    </div>}
    <div className="mi-periods" role="group" aria-label="Period">{PERIODS.map(([value, label]) => <button key={value} type="button" aria-pressed={days === value} onClick={() => setDays(value)}>{label}</button>)}</div>
  </div>;
  if (error) return <section className="mi">{header}<p className="error-msg" role="alert">{error}</p></section>;
  if (!data) return <section className="mi">{header}<p className="text-muted">Loading the tasks dashboard…</p></section>;

  const k = data.kpis, unit = data.period.unit, by = unit === 'month' ? 'by month' : 'by week';
  const series = data.series.map(b => ({ ...b, label: bucketLabel(b.key, unit) }));
  const statuses = data.by_status.filter(s => s.count).map(s => ({ ...s, name: STATUS_LABELS[s.status] || s.status }));
  const priorities = data.by_priority.filter(p => p.count).map(p => ({ ...p, name: p.priority[0].toUpperCase() + p.priority.slice(1) }));
  return <section className="mi" aria-label="Tasks dashboard">
    {header}
    <div className="mi-figures">
      <Figure icon={ListTodo} label="Open" value={k.open} note={`${k.due_this_week} due this week`} />
      <Figure icon={AlertTriangle} label="Overdue" value={k.overdue} note={k.open ? `${Math.round(k.overdue / k.open * 100)}% of open work` : 'nothing open'} tone={k.overdue ? 'danger' : undefined} />
      <Figure icon={Hourglass} label="Waiting" value={k.waiting} note="on the customer or a vendor" tone={k.waiting ? 'warning' : undefined} />
      <Figure icon={UserX} label="Unassigned" value={k.unassigned} note="open, nobody on them (team tasks included)" tone={k.unassigned ? 'warning' : undefined} />
      <Figure icon={CheckCheck} label="Completed" value={k.completed} note={`${k.created} created in the period`} />
      <Figure icon={CheckSquare} label="On time" value={k.on_time_rate == null ? '—' : `${k.on_time_rate}%`} note="of completed tasks with a due date" tone={k.on_time_rate != null && k.on_time_rate < 80 ? 'warning' : undefined} />
      <Figure icon={Clock} label="Days to complete" value={k.avg_days_to_complete ?? '—'} note="average, created to completed" />
      <Figure icon={ListChecks} label="Open subtasks" value={k.open_subtasks} note={k.overdue_subtasks ? `${k.overdue_subtasks} past their due date` : 'none overdue'} tone={k.overdue_subtasks ? 'danger' : undefined} />
    </div>

    <div className="mi-charts">
      <Chart title="Created and completed" note={`${by}; completed split on time / late`} wide>
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={series} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--gray-100)" />
            <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} tick={tick} tickLine={false} axisLine={false} />
            <Tooltip {...tooltip} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="on_time" name="Completed on time" stackId="done" fill="var(--success)" />
            <Bar dataKey="late" name="Completed late" stackId="done" fill="var(--warning)" radius={[3, 3, 0, 0]} />
            <Line dataKey="created" name="Created" stroke="var(--primary)" strokeWidth={2} dot={false} type="monotone" />
          </ComposedChart>
        </ResponsiveContainer>
      </Chart>
      <Chart title="Open work by status" note={plural(k.open, 'open task')}>
        {statuses.length ? <ResponsiveContainer width="100%" height={Math.max(120, statuses.length * 40)}>
          <BarChart data={statuses} layout="vertical" margin={{ top: 0, right: 16, left: 20, bottom: 0 }}>
            <XAxis type="number" allowDecimals={false} tick={tick} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="name" width={130} tick={tick} tickLine={false} axisLine={false} />
            <Tooltip {...tooltip} />
            <Bar dataKey="count" name="Tasks" radius={[0, 3, 3, 0]} fill="var(--primary)" shape={props => <rect {...props} fill={STATUS_COLORS[props.payload.status]} />} />
          </BarChart>
        </ResponsiveContainer> : <p className="text-muted text-sm">Nothing open.</p>}
      </Chart>
      <Chart title="Open work by priority">
        {priorities.length ? <ResponsiveContainer width="100%" height={Math.max(120, priorities.length * 40)}>
          <BarChart data={priorities} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
            <XAxis type="number" allowDecimals={false} tick={tick} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="name" width={80} tick={tick} tickLine={false} axisLine={false} />
            <Tooltip {...tooltip} />
            <Bar dataKey="count" name="Tasks" radius={[0, 3, 3, 0]} shape={props => <rect {...props} fill={PRIORITY_COLORS[props.payload.priority]} />} />
          </BarChart>
        </ResponsiveContainer> : <p className="text-muted text-sm">Nothing open.</p>}
      </Chart>
      <Chart title="People" note="open work now; done and on time in the period" wide>
        {data.people.length ? <div className="table-wrap"><table className="mi-table">
          <thead><tr><th scope="col">Engineer</th><th scope="col" className="num">Open</th><th scope="col" className="num">Overdue</th><th scope="col" className="num">Done</th><th scope="col" className="num">On time</th><th scope="col" className="num">Subtasks open</th></tr></thead>
          <tbody>{data.people.map(p => <tr key={p.id}>
            <th scope="row">{p.name}</th><td className="num">{p.open}</td><td className={`num${p.overdue ? ' mi-bad' : ''}`}>{p.overdue}</td><td className="num">{p.done}</td>
            <td className="num">{p.on_time_rate == null ? '—' : `${p.on_time_rate}%`}</td><td className={`num${p.overdue_subtasks ? ' mi-bad' : ''}`}>{p.open_subtasks}{p.overdue_subtasks ? ` (${p.overdue_subtasks} late)` : ''}</td>
          </tr>)}</tbody>
        </table></div> : <p className="text-muted text-sm">No one has tasks in this view.</p>}
      </Chart>
      <Chart title="Open work by customer" note="top 8">
        {data.by_customer.length ? <ul className="mi-hbars">{data.by_customer.map(c => <li key={c.id}>
          <Link to={`/customers/${c.id}/service-profile?section=tasks`}>{c.name}</Link>
          <span className="mi-hbar"><span style={{ width: `${(c.open / Math.max(...data.by_customer.map(x => x.open), 1)) * 100}%` }} /></span>
          <strong>{c.open}{c.overdue ? <small className="mi-bad"> · {c.overdue} late</small> : null}</strong>
        </li>)}</ul> : <p className="text-muted text-sm">No customer tasks open.</p>}
      </Chart>
    </div>

    <div className="mi-attentions">
      <Attention title="Overdue tasks" icon={AlertTriangle} items={data.overdue} empty="Nothing overdue." to="/tasks?filter=overdue"
        render={t => <li key={t.id}><Link to={taskLink(t)}>{t.title}</Link><span>{t.who || (t.team_task ? 'Team task, not taken' : 'Unassigned')}{t.customer_name ? ` · ${t.customer_name}` : ''}</span>
          <span className="ui-badge is-danger">{plural(t.days_overdue, 'day')} late</span></li>} />
      <Attention title={`Waiting more than ${data.stuck_days} days`} icon={CalendarClock} items={data.stuck} empty="Nothing has been waiting that long."
        render={t => <li key={t.id}><Link to={taskLink(t)}>{t.title}</Link><span>{t.reason ? `Waiting for: ${t.reason}` : STATUS_LABELS[t.status]}{t.customer_name ? ` · ${t.customer_name}` : ''}</span>
          <span className="ui-badge is-warning">{sentenceCase(plural(t.waiting_days, 'day'))}</span></li>} />
    </div>
  </section>;
}

