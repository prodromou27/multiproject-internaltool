import React,{ useEffect,useState } from 'react';
import { Activity,BriefcaseBusiness,CalendarDays,CheckSquare,ClipboardList,ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { fmtDate,StatusBadge } from './Shared';
import { fmtDuration } from './activityLedger';

function useOverviewModule(load,key) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(() => { const controller=new AbortController();setError('');setData(null);load(controller.signal).then(result => { if(!controller.signal.aborted) setData(result); }).catch(failure => { if(!controller.signal.aborted) setError(failure.message); });return () => controller.abort(); },[key,retry]);
  return { data,error,retry:() => setRetry(value => value+1) };
}

function Module({ icon:Icon,title,count,state,onView,children,empty }) {
  return <section className="card cs-command-module"><header><div><Icon size={17} aria-hidden="true" /><h2>{title}</h2>{count!==undefined && <span>{count}</span>}</div>{onView && <button type="button" onClick={onView}>View all <ArrowRight size={13} /></button>}</header>
    {state.error ? <div className="cs-module-local-error">Unavailable. <button onClick={state.retry}>Retry</button></div> : !state.data ? <div className="cs-module-skeleton"><span /><span /><span /></div> : state.data.length ? <div className="cs-command-list">{children}</div> : <p className="cs-command-empty">{empty}</p>}
  </section>;
}

const activeRecommendation=row => !['implemented','rejected','closed','converted_to_project'].includes(row.status);
const riskRank={ critical:0,high:1,medium:2,low:3 };

export default function CustomerOverview({ customer,summary,summaryError,onSelectTab }) {
  const projects=useOverviewModule(signal => api.customerOperationProjects(customer.id,{ page:1,page_size:4,filter:'active' },{ signal }).then(result => result.rows),`projects:${customer.id}`);
  const tasks=useOverviewModule(signal => api.customerOperationTasks(customer.id,{ page:1,page_size:6,filter:'open' },{ signal }).then(result => result.rows),`tasks:${customer.id}`);
  const recommendations=useOverviewModule(signal => api.customerRecommendations(customer.id,{ page:1 },{ signal }).then(result => result.rows.filter(activeRecommendation).sort((a,b) => (riskRank[a.risk_level] ?? 9)-(riskRank[b.risk_level] ?? 9) || String(a.due_date || '9999').localeCompare(String(b.due_date || '9999'))).slice(0,5)),`recommendations:${customer.id}`);
  const activities={ data:summary?.activities?.recent || null,error:summaryError,retry:() => {} };
  return <div className="cs-command-grid">
    <Module icon={BriefcaseBusiness} title="Active projects" count={summary?.projects?.active} state={projects} onView={() => onSelectTab('projects','active')} empty="No active projects.">{projects.data?.map(row => <article key={row.id}><div><Link to={`/projects/${row.id}`}>{row.title}</Link><small>{row.owner_name} · Due {fmtDate(row.deadline)}</small></div><div className="cs-overview-status"><StatusBadge entityType="project" s={row.status} /><strong>{row.completion_pct}%</strong></div></article>)}</Module>
    <Module icon={CheckSquare} title="Important tasks" count={summary?.tasks?.open} state={tasks} onView={() => onSelectTab('tasks','open')} empty="No open tasks.">{tasks.data?.map(row => <article key={row.id}><div><Link to={`/projects/${row.project_id}`}>{row.title}</Link><small>{row.assigned_to_name || 'Unassigned'} · {row.project_title}</small></div><div className="cs-overview-status"><span className={`badge badge-${row.priority}`}>{row.priority}</span><small>Due {fmtDate(row.deadline)}</small></div></article>)}</Module>
    <Module icon={Activity} title="Recent service activities" state={activities} onView={() => onSelectTab('activities')} empty="No service activity has been logged.">{activities.data?.map(row => <article key={row.id}><div><strong>{row.title}</strong><small>{fmtDate(row.activity_date)} · {row.engineer_name} · {row.category_name}</small></div><div className="cs-overview-status"><StatusBadge entityType="service_activity" s={row.status} /><small>{fmtDuration(row.duration_minutes)}</small></div></article>)}</Module>
    <section className="card cs-command-module"><header><div><CalendarDays size={17} aria-hidden="true" /><h2>Maintenance visits</h2><span>{summary?.visits?.this_year ?? '—'} this year</span></div><button type="button" onClick={() => onSelectTab('maintenance-visits')}>View all <ArrowRight size={13} /></button></header>
      {summaryError ? <div className="cs-module-local-error">Operational summary unavailable.</div> : !summary ? <div className="cs-module-skeleton"><span /><span /></div> : <div className="cs-visit-pair"><div><small>Previous visit</small><strong>{summary.visits.last?.title || 'No previous visit'}</strong><span>{fmtDate(summary.visits.last?.scheduled_date)}</span></div><div><small>Next visit</small><strong>{summary.visits.next?.title || 'None scheduled'}</strong><span>{fmtDate(summary.visits.next?.scheduled_date)}</span></div>{summary.visits.reports_pending>0 && <button type="button" className="cs-attention-link" onClick={() => onSelectTab('maintenance-visits','report_pending')}>{summary.visits.reports_pending} reports pending</button>}</div>}
    </section>
    <Module icon={ClipboardList} title="Recommendations requiring attention" count={summary?.recommendations?.open} state={recommendations} onView={() => onSelectTab('recommendations')} empty="No recommendations require attention.">{recommendations.data?.map(row => <article key={row.id}><div><strong>{row.finding}</strong><small>Due {fmtDate(row.due_date)} · {row.owner_name || 'Unassigned'}</small></div><div className="cs-overview-status"><span className={`badge badge-${row.risk_level}`}>{row.risk_level} risk</span><span>{row.status.replaceAll('_',' ')}</span></div></article>)}</Module>
  </div>;
}
