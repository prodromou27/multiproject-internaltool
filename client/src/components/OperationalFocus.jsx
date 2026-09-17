import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, CheckSquare, ClipboardList, FolderOpen, Send, Wrench } from 'lucide-react';
import { fmtDate } from './Shared';

function WorkList({ items, empty }) {
  return items.length ? <ul className="focus-work-list">{items.map(item => <li key={`${item.kind}-${item.id}`}>
    <item.icon size={16} aria-hidden="true" />
    <Link to={item.link}><strong>{item.title}</strong><span>{item.kind}{item.date ? ` · ${fmtDate(item.date)}` : ''}</span></Link>
    <ArrowRight size={14} aria-hidden="true" />
  </li>)}</ul> : <p className="focus-empty">{empty}</p>;
}

export default function OperationalFocus({ data, error, onRefresh }) {
  if (!data) return <section className="card operational-focus"><h2>Work overview</h2>
    <p className={error ? 'error-msg' : 'text-muted'} role={error ? 'alert' : undefined}>{error || 'Loading work overview...'}</p>
    {error && <button className="btn btn-ghost btn-sm" onClick={onRefresh}>Retry overview</button>}
  </section>;
  const manager = data.scope === 'management';
  const attention = [
    ...data.tasks.attention.map(item => ({ ...item, kind: item.deadline < data.as_of ? 'Overdue task' : 'Task due today', date: item.deadline, icon: CheckSquare, link: item.deadline < data.as_of ? '/tasks?filter=overdue' : '/tasks' })),
    ...data.projects.commitments.filter(item => item.deadline < data.as_of).map(item => ({ ...item, kind: 'Overdue project', date: item.deadline, icon: FolderOpen, link: `/projects/${item.id}` })),
    ...data.visits.reports.map(item => ({ ...item, kind: 'Visit report pending', date: item.scheduled_date, icon: Send, link: '/maintenance-visits?filter=report_pending' })),
    ...(data.service.follow_ups || []).map(item => ({ ...item, kind: 'Service follow-up due', date: item.follow_up_date, icon: ClipboardList, link: '/activity-log' })),
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
  const upcoming = [
    ...data.projects.commitments.filter(item => item.deadline >= data.as_of).map(item => ({ ...item, kind: 'Project deadline', date: item.deadline, icon: FolderOpen, link: `/projects/${item.id}` })),
    ...data.visits.upcoming_items.map(item => ({ ...item, kind: 'Maintenance visit', date: item.scheduled_date, icon: Wrench, link: '/maintenance-visits' })),
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
  const metrics = [
    { value: data.tasks.overdue, label: 'Overdue tasks', link: '/tasks?filter=overdue', urgent: true },
    { value: data.tasks.due_today, label: 'Tasks due today', link: '/tasks' },
    { value: data.projects.overdue, label: 'Overdue projects', link: '/projects?filter=overdue', urgent: true },
    { value: data.projects.awaiting_approval, label: manager ? 'Closure requests' : 'Awaiting closure review', link: manager ? '/approvals' : '/projects?filter=pending_approval' },
    { value: data.visits.reports_pending, label: 'Visit reports pending', link: '/maintenance-visits?filter=report_pending', urgent: true },
    ...(data.service.enabled ? [{ value: data.service.due, label: 'Service follow-ups due', link: '/activity-log', urgent: true }] : [{ value: data.visits.upcoming, label: 'Upcoming visits', link: '/maintenance-visits' }]),
  ];
  return <section className="operational-focus" aria-label={manager ? 'Management exceptions' : 'Personal work priorities'}>
    {error && <p className="error-msg" role="alert">{error} Showing the last loaded overview. <button className="btn btn-ghost btn-sm" onClick={onRefresh}>Retry</button></p>}
    <div className="focus-heading"><div><p className="operations-eyebrow">{manager ? 'Management exceptions' : 'Your priorities'}</p><h2>{manager ? 'Where attention is needed' : 'What needs your attention today?'}</h2></div><span>As of {fmtDate(data.as_of)}</span></div>
    <div className="focus-metrics">{metrics.map(metric => <Link key={metric.label} to={metric.link} className={`focus-metric${metric.urgent && metric.value ? ' needs-attention' : ''}`}><strong>{metric.value}</strong><span>{metric.label}</span><ArrowRight size={14} aria-hidden="true" /></Link>)}</div>
    <div className="focus-columns">
      <section className="card"><h3><CheckSquare size={16} /> Needs attention</h3><WorkList items={attention} empty="No due tasks, overdue projects, pending visit reports or due service follow-ups were found." /><p className="focus-list-note">Showing up to eight items. Open a module to review its full list.</p></section>
      <section className="card"><h3><CalendarDays size={16} /> Upcoming commitments</h3><WorkList items={upcoming} empty="No project deadlines or maintenance visits are scheduled in the next seven days." /><div className="focus-context">
        <span>{data.tasks.waiting_customer + data.projects.waiting_customer} items waiting for customer</span>
        <Link to="/tasks?filter=pending_approval">{data.tasks.awaiting_approval} tasks awaiting approval</Link>
        {manager && <><Link to="/projects">{data.projects.stale} active projects without updates in seven days</Link><Link to="/maintenance-visits">{data.visits.customer_delivery_pending} visit reports awaiting customer delivery</Link></>}
      </div></section>
    </div>
  </section>;
}
