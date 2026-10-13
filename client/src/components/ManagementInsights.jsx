import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, BarChart3, CalendarClock, CheckSquare, Clock, FileClock, GraduationCap, PackageCheck, Ticket, Wrench } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api';
import { fmtDate } from './Shared';
import { ToneBadge } from './EnterpriseUI';
import { useLiveVersion } from '../live';
import './ManagementInsights.css';

/* Dashboard → Insights (managers): the whole operation over a period — figures,
   charts and what needs attention. Server: insights.js (/api/insights). */

export const PERIODS = [[30, '30 days'], [90, '90 days'], [180, '6 months'], [365, '12 months']];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const tick = { fontSize: 11, fill: 'var(--gray-500)' };
export const tooltip = { contentStyle: { fontSize: 12, borderRadius: 8, border: '1px solid var(--gray-200)' }, cursor: { fill: 'var(--gray-50)' } };
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function bucketLabel(key, unit) {
  if (unit === 'month') return MONTHS[Number(key.slice(5, 7)) - 1];
  return `${Number(key.slice(8, 10))} ${MONTHS[Number(key.slice(5, 7)) - 1]}`;
}

export function Figure({ icon: Icon, label, value, note, to, tone }) {
  const body = <><span className="mi-figure-label"><Icon size={14} aria-hidden="true" /> {label}</span><strong>{value}</strong>{note && <small>{note}</small>}</>;
  // Zero recedes, so the figures that need someone stand out.
  const className = `mi-figure${tone ? ` is-${tone}` : ''}${Number(value) === 0 ? ' is-zero' : ''}`;
  return to ? <Link to={to} className={className}>{body}</Link> : <div className={className}>{body}</div>;
}

export function Chart({ title, note, children, wide }) {
  return <section className={`card mi-chart${wide ? ' is-wide' : ''}`} aria-label={title}>
    <header><h3>{title}</h3>{note && <span className="text-muted text-sm">{note}</span>}</header>
    <div className="mi-chart-body">{children}</div>
  </section>;
}

function HorizontalBars({ rows, empty, link }) {
  if (!rows.length) return <p className="text-muted text-sm">{empty}</p>;
  const max = Math.max(...rows.map(r => r.hours), 0.1);
  return <ul className="mi-hbars">{rows.map(r => <li key={r.id}>
    {link ? <Link to={link(r)}>{r.name}</Link> : <span>{r.name}</span>}
    <span className="mi-hbar"><span style={{ width: `${(r.hours / max) * 100}%` }} /></span>
    <strong>{r.hours} h</strong>
  </li>)}</ul>;
}

export function Attention({ title, icon: Icon, items, empty, render, to, limit, hidden }) {
  if (hidden) return null;
  const shown = limit ? items.slice(0, limit) : items;
  return <section className="card mi-attention" aria-label={title}>
    <header><h3><Icon size={15} aria-hidden="true" /> {title}</h3>{items.length > 0 && <span className="mi-count">{items.length}</span>}</header>
    {items.length ? <ul>{shown.map(render)}</ul> : <p className="text-muted text-sm">{empty}</p>}
    {to && items.length > 0 ? <Link className="text-sm" to={to}>View all</Link> : items.length > shown.length && <span className="text-muted text-sm">and {items.length - shown.length} more</span>}
  </section>;
}

/* compact (the dashboard): the figures and what needs attention; the charts open
   on request. Reports → Overview shows everything. */
export default function ManagementInsights({ filterable = false, compact = false }) {
  const [chartsOpen, setChartsOpen] = useState(() => { try { return localStorage.getItem('insights_charts') === 'open'; } catch { return false; } });
  const toggleCharts = () => setChartsOpen(open => { try { localStorage.setItem('insights_charts', open ? 'closed' : 'open'); } catch { /* not remembered */ } return !open; });
  const showCharts = !compact || chartsOpen;
  const [days, setDays] = useState(() => { try { return Number(localStorage.getItem('insights_days')) || 90; } catch { return 90; } });
  const [data, setData] = useState(null), [error, setError] = useState('');
  const [filters, setFilters] = useState({ customer_id: '', team_id: '', engineer_id: '' }), [options, setOptions] = useState(null);
  useEffect(() => {
    if (!filterable) return;
    Promise.all([api.customers().catch(() => []), api.teams().catch(() => []), api.users().catch(() => [])]).then(([customers, teams, users]) => setOptions({
      customers: (Array.isArray(customers) ? customers : customers.rows || []).filter(c => c.active !== 0).sort((a, b) => a.name.localeCompare(b.name)),
      teams: teams || [], engineers: (users || []).filter(u => u.role === 'engineer' && u.active !== 0),
    }));
  }, [filterable]);
  const live = useLiveVersion();
  useEffect(() => {
    const controller = new AbortController();
    api.insights(days, filters, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) { setData(result); setError(''); } })
      .catch(failure => { if (!controller.signal.aborted) { if (failure.status === 403) setData('forbidden'); else setError(failure.message); } });
    return () => controller.abort();
  }, [days, live, filters]);
  const choose = value => { setDays(value); try { localStorage.setItem('insights_days', String(value)); } catch { /* not remembered */ } };

  const header = <div className="mi-head">
    <div><h2><BarChart3 size={18} aria-hidden="true" /> Insights</h2>{data && <p className="text-muted text-sm">{fmtDate(data.period.from)} – {fmtDate(data.period.to)}</p>}</div>
    {filterable && options && <div className="mi-filters">
      <label>Customer<select value={filters.customer_id} onChange={e => setFilters(f => ({ ...f, customer_id: e.target.value }))}><option value="">All customers</option>{options.customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>Team<select value={filters.team_id} onChange={e => setFilters(f => ({ ...f, team_id: e.target.value }))}><option value="">All teams</option>{options.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <label>Engineer<select value={filters.engineer_id} onChange={e => setFilters(f => ({ ...f, engineer_id: e.target.value }))}><option value="">All engineers</option>{options.engineers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
    </div>}
    <div className="mi-head-actions">
      {compact && <button type="button" className="btn btn-ghost btn-sm" aria-expanded={chartsOpen} aria-controls="mi-charts" onClick={toggleCharts}><BarChart3 size={13} aria-hidden="true" /> {chartsOpen ? 'Hide charts' : 'Show charts'}</button>}
      <div className="mi-periods" role="group" aria-label="Period">{PERIODS.map(([value, label]) => <button key={value} type="button" aria-pressed={days === value} onClick={() => choose(value)}>{label}</button>)}</div>
    </div>
  </div>;
  if (data === 'forbidden') return null; // no reporting access: nothing to show
  if (error) return <section className="mi">{header}<p className="error-msg" role="alert">{error}</p></section>;
  if (!data) return <section className="mi">{header}<p className="text-muted">Loading insights…</p></section>;

  const k = data.kpis, unit = data.period.unit;
  const series = data.series.map(b => ({ ...b, label: bucketLabel(b.key, unit) }));
  const hasTickets = k.tickets_created + k.tickets_resolved + k.open_tickets > 0;
  const by = unit === 'month' ? 'by month' : 'by week';
  return <section className="mi" aria-label="Insights">
    {header}
    <div className="mi-figures">
      <Figure icon={Clock} label="Hours logged" value={k.hours} note={plural(k.activities, 'service activity', 'service activities')} to="/service-operations" />
      <Figure icon={CheckSquare} label="Tasks done" value={k.tasks_done} note={k.on_time_rate == null ? 'none finished in this period' : `${k.on_time_rate}% on time`} to="/tasks?filter=done" tone={k.on_time_rate != null && k.on_time_rate < 80 ? 'warning' : undefined} />
      <Figure icon={AlertTriangle} label="Overdue tasks" value={k.overdue_tasks} note={`${k.open_tasks} open${k.team_tasks_waiting ? `, ${k.team_tasks_waiting} waiting for a team member` : ''}`} to="/tasks?filter=overdue" tone={k.overdue_tasks ? 'danger' : undefined} />
      <Figure icon={Wrench} label="Visits done" value={k.visits_done} to="/maintenance-visits" />
      {hasTickets && <Figure icon={Ticket} label="Tickets" value={`${k.tickets_resolved} / ${k.tickets_created}`} note={`resolved / created · ${k.open_tickets} open now`} />}
      <Figure icon={FileClock} label="Reports owed" value={k.reports_owed} note={k.reports_overdue ? `${k.reports_overdue} overdue` : 'none overdue'} to="/approvals?view=reports" tone={k.reports_overdue ? 'danger' : k.reports_owed ? 'warning' : undefined} />
      <Figure icon={CalendarClock} label="Contracts ending" value={k.contracts_ending} note="within 30 days, or just ended" tone={k.contracts_ending ? 'warning' : undefined} />
      <Figure icon={PackageCheck} label="Devices behind" value={k.devices_behind + k.devices_eol} note={k.devices_eol ? `${k.devices_eol} on end-of-life versions` : 'on older software'} to="/software" tone={k.devices_eol ? 'danger' : k.devices_behind ? 'warning' : undefined} />
    </div>

    {showCharts && <div className="mi-charts" id="mi-charts">
      <Chart title="Work logged" note={`hours ${by}`}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={series} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-100)" vertical={false} />
            <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={tick} axisLine={false} tickLine={false} width={32} />
            <Tooltip {...tooltip} formatter={(value, _n, item) => [`${value} h · ${plural(item.payload.activities, 'activity', 'activities')}`, 'Logged']} />
            <Bar dataKey="hours" name="Hours" fill="var(--primary)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Chart>
      <Chart title="Tasks finished" note={`on time or late, and new tasks, ${by}`}>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={series} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-100)" vertical={false} />
            <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={tick} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
            <Tooltip {...tooltip} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="tasks_on_time" name="On time" stackId="done" fill="var(--success)" />
            <Bar dataKey="tasks_late" name="Late" stackId="done" fill="var(--danger)" radius={[3, 3, 0, 0]} />
            <Line dataKey="tasks_created" name="New tasks" type="monotone" stroke="var(--gray-500)" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </Chart>
      {hasTickets && <Chart title="Tickets" note={`created and resolved ${by}`}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={series} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-100)" vertical={false} />
            <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={tick} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
            <Tooltip {...tooltip} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="tickets_created" name="Created" fill="var(--warning)" radius={[3, 3, 0, 0]} />
            <Bar dataKey="tickets_resolved" name="Resolved" fill="var(--success)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Chart>}
      <Chart title="Hours by customer" note="top 8">
        <HorizontalBars rows={data.hours_by_customer} empty="No work logged in this period." link={r => `/customers/${r.id}/service-profile`} />
      </Chart>
      <Chart title="Hours by kind of work" note="activity categories">
        <HorizontalBars rows={data.hours_by_category} empty="No work logged in this period." />
      </Chart>
      <Chart title="Engineers" note="open work now; done and logged in this period" wide>
        {!data.engineers.length ? <p className="text-muted text-sm">No engineers yet.</p> : <div className="table-wrap"><table className="mi-table">
          <thead><tr><th scope="col">Engineer</th><th scope="col" className="num">Open tasks</th><th scope="col" className="num">Overdue</th><th scope="col" className="num">Tasks done</th><th scope="col" className="num">Hours logged</th><th scope="col" className="num">Activities</th></tr></thead>
          <tbody>{data.engineers.map(e => <tr key={e.id}><th scope="row">{e.name}</th><td className="num">{e.open_tasks}</td><td className="num">{e.overdue_tasks ? <ToneBadge tone="danger">{e.overdue_tasks}</ToneBadge> : 0}</td><td className="num">{e.done_tasks}</td><td className="num">{e.hours}</td><td className="num">{e.activities}</td></tr>)}</tbody>
        </table></div>}
      </Chart>
    </div>}

    {/* Only the lists with something in them, a few rows each (View all has the rest). */}
    <div className="mi-attentions">
      <Attention title="Customer reports owed" icon={FileClock} items={data.attention.reports_owed} limit={5} hidden={!data.attention.reports_owed.length} empty="Every managed customer has its report." to="/approvals?view=reports"
        render={r => <li key={r.customer_id}><Link to={`/customers/${r.customer_id}/service-profile?section=reports`}>{r.customer_name}</Link><span>{r.label} · due {fmtDate(r.due_date)}</span>{r.overdue ? <ToneBadge tone="danger">Overdue</ToneBadge> : <ToneBadge tone="warning">{r.status.replace('_', ' ')}</ToneBadge>}</li>} />
      <Attention title="Contracts ending" icon={CalendarClock} items={data.attention.contracts_ending} limit={5} hidden={!data.attention.contracts_ending.length} empty="No contract ends in the next 30 days."
        render={c => <li key={c.id}><Link to={`/customers/${c.customer_id}/service-profile?section=contracts`}>{c.customer_name}</Link><span>{c.reference || 'Contract'} · {c.status === 'expired' ? `ended ${fmtDate(c.end_date)}` : `ends ${fmtDate(c.end_date)}`}</span><ToneBadge tone={c.status === 'expired' ? 'danger' : 'warning'}>{c.status === 'expired' ? 'Expired' : `${c.days_left} days`}</ToneBadge></li>} />
      <Attention title="Devices on old software" icon={PackageCheck} items={data.attention.devices} limit={5} hidden={!data.attention.devices.length} empty="Every checked device is up to date." to="/software"
        render={d => <li key={d.id}><Link to={`/customers/${d.customer_id}/service-profile?section=assets`}>{d.customer_name}</Link><span>{d.name} · {d.product_name} {d.software_version}</span><ToneBadge tone={d.status === 'end_of_life' ? 'danger' : 'warning'}>{d.status === 'end_of_life' ? 'End of life' : d.behind ? `${d.behind} behind` : 'Behind'}</ToneBadge></li>} />
      {/* On the dashboard the gaps are one line; the Skill matrix (and Reports → Overview) list them. */}
      {compact ? data.attention.skills.length > 0 && <Link className="card mi-attention mi-oneline" to="/skills" aria-label="Knowledge gaps">
        <GraduationCap size={15} aria-hidden="true" /> <span><strong>{plural(data.attention.skills.length, 'technology', 'technologies')}</strong> {data.attention.skills.length === 1 ? 'has' : 'have'} a knowledge gap</span><span className="mi-oneline-go">Skill matrix →</span>
      </Link>
      : <Attention title="Knowledge gaps" icon={GraduationCap} items={data.attention.skills} limit={5} hidden={!data.attention.skills.length} empty="Every technology has enough skilled engineers." to="/skills"
        render={s => <li key={s.technology_id}><Link to="/skills">{s.name}</Link><span>{s.skilled} of {s.target} skilled</span><ToneBadge tone={s.status === 'gap' ? 'danger' : 'warning'}>{s.status === 'gap' ? 'Gap' : s.single_point ? 'One person' : 'At risk'}</ToneBadge></li>} />}
    </div>
  </section>;
}
