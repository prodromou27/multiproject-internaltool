import React,{ useEffect,useState } from 'react';
import { Activity,BriefcaseBusiness,CalendarDays,CheckSquare,ClipboardList,ArrowRight,TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { BarChart,Bar,CartesianGrid,XAxis,YAxis,Tooltip,ResponsiveContainer } from 'recharts';
import { api } from '../api';
import { fmtDate,StatusBadge } from './Shared';
import { fmtDuration } from './activityLedger';
import { fmtHours,plural } from './ServiceCharts';

function useOverviewModule(load,key) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(() => { const controller=new AbortController();setError('');setData(null);load(controller.signal).then(result => { if(!controller.signal.aborted) setData(result); }).catch(failure => { if(!controller.signal.aborted) setError(failure.message); });return () => controller.abort(); },[key,retry]);
  return { data,error,retry:() => setRetry(value => value+1) };
}

function Module({ icon:Icon,title,count,state,onView,children,empty,wide }) {
  return <section className={`card cs-command-module${wide ? ' cs-span-2' : ''}`}><header><div><Icon size={17} aria-hidden="true" /><h2>{title}</h2>{count!==undefined && <span>{count}</span>}</div>{onView && <button type="button" onClick={onView}>View all <ArrowRight size={13} /></button>}</header>
    {state.error ? <div className="cs-module-local-error">Unavailable. <button onClick={state.retry}>Retry</button></div> : !state.data ? <div className="cs-module-skeleton"><span /><span /><span /></div> : state.data.length ? <div className="cs-command-list">{children}</div> : <p className="cs-command-empty">{empty}</p>}
  </section>;
}

/* The one chart on the Overview tab — six months of logged hours, so a manager
   sees momentum (busier or quieter than usual) at a glance before reading any
   list below it. Matches the bar-chart convention already used in Reports >
   Trends (same grid, tick size and rounded-top bars) rather than inventing a
   new chart style for this one page. */
function ActivityTrendCard({ trend }) {
  const total=trend.data?.reduce((sum,row) => sum+row.hours,0) ?? 0;
  return <section className="card cs-command-module cs-span-2 cs-trend">
    <header><div><TrendingUp size={17} aria-hidden="true" /><h2>Service activity — last 6 months</h2></div></header>
    {trend.error ? <div className="cs-module-local-error">Unavailable. <button onClick={trend.retry}>Retry</button></div>
      : !trend.data ? <div className="cs-module-skeleton"><span style={{ height:150 }} /></div>
      : total===0 ? <p className="cs-command-empty">No service activity logged in the last 6 months.</p>
      : <div className="cs-trend-body">
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={trend.data} margin={{ top:6,right:8,left:0,bottom:0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-100)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize:11,fill:'var(--gray-500)' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize:11,fill:'var(--gray-500)' }} allowDecimals={false} axisLine={false} tickLine={false} width={30} />
              <Tooltip formatter={(value,_name,item) => [`${fmtHours(value)} · ${plural(item.payload.count,'activity','activities')}`,'Logged']}
                contentStyle={{ fontSize:12,borderRadius:8,border:'1px solid var(--gray-200)' }} cursor={{ fill:'var(--gray-50)' }} />
              <Bar dataKey="hours" fill="var(--primary)" radius={[4,4,0,0]} maxBarSize={34} />
            </BarChart>
          </ResponsiveContainer>
        </div>}
  </section>;
}

const activeRecommendation=row => !['implemented','rejected','closed','converted_to_project'].includes(row.status);
const riskRank={ critical:0,high:1,medium:2,low:3 };

export default function CustomerOverview({ customer,summary,summaryError,onSelectTab }) {
  const projects=useOverviewModule(signal => api.customerOperationProjects(customer.id,{ page:1,page_size:4,filter:'active' },{ signal }).then(result => result.rows),`projects:${customer.id}`);
  const tasks=useOverviewModule(signal => api.customerOperationTasks(customer.id,{ page:1,page_size:6,filter:'open' },{ signal }).then(result => result.rows),`tasks:${customer.id}`);
  const recommendations=useOverviewModule(signal => api.customerRecommendations(customer.id,{ page:1 },{ signal }).then(result => result.rows.filter(activeRecommendation).sort((a,b) => (riskRank[a.risk_level] ?? 9)-(riskRank[b.risk_level] ?? 9) || String(a.due_date || '9999').localeCompare(String(b.due_date || '9999'))).slice(0,5)),`recommendations:${customer.id}`);
  const trend=useOverviewModule(signal => api.customerServiceSummary(customer.id,{},{ signal }).then(result => result.monthly || []),`trend:${customer.id}`);
  const activities={ data:summary?.activities?.recent || null,error:summaryError,retry:() => {} };
  return <div className="cs-command-grid">
    <ActivityTrendCard trend={trend} />
    <Module icon={BriefcaseBusiness} title="Active projects" count={summary?.projects?.active} state={projects} onView={() => onSelectTab('projects','active')} empty="No active projects.">{projects.data?.map(row => <article key={row.id}><div><Link to={`/projects/${row.id}`}>{row.title}</Link><small>{row.owner_name} · Due {fmtDate(row.deadline)}</small></div><div className="cs-overview-status"><StatusBadge entityType="project" s={row.status} /><strong>{row.completion_pct}%</strong></div></article>)}</Module>
    <Module icon={CheckSquare} title="Important tasks" count={summary?.tasks?.open} state={tasks} onView={() => onSelectTab('tasks','open')} empty="No open tasks.">{tasks.data?.map(row => <article key={row.id}><div><Link to={`/projects/${row.project_id}`}>{row.title}</Link><small>{row.assigned_to_name || 'Unassigned'} · {row.project_title}</small></div><div className="cs-overview-status"><span className={`badge badge-${row.priority}`}>{row.priority}</span><small>Due {fmtDate(row.deadline)}</small></div></article>)}</Module>
    <Module icon={Activity} title="Recent service activities" wide state={activities} onView={() => onSelectTab('activities')} empty="No service activity has been logged.">{activities.data?.map(row => <article key={row.id}><div><strong>{row.title}</strong><small>{fmtDate(row.activity_date)} · {row.engineer_name} · {row.category_name}</small></div><div className="cs-overview-status"><StatusBadge entityType="service_activity" s={row.status} /><small>{fmtDuration(row.duration_minutes)}</small></div></article>)}</Module>
    <section className="card cs-command-module"><header><div><CalendarDays size={17} aria-hidden="true" /><h2>Maintenance visits</h2><span>{summary?.visits?.this_year ?? '—'} this year</span></div><button type="button" onClick={() => onSelectTab('maintenance-visits')}>View all <ArrowRight size={13} /></button></header>
      {summaryError ? <div className="cs-module-local-error">Operational summary unavailable.</div> : !summary ? <div className="cs-module-skeleton"><span /><span /></div> : <div className="cs-visit-pair"><div><small>Previous visit</small><strong>{summary.visits.last?.title || 'No previous visit'}</strong><span>{fmtDate(summary.visits.last?.scheduled_date)}</span></div><div><small>Next visit</small><strong>{summary.visits.next?.title || 'None scheduled'}</strong><span>{fmtDate(summary.visits.next?.scheduled_date)}</span></div>{summary.visits.reports_pending>0 && <button type="button" className="cs-attention-link" onClick={() => onSelectTab('maintenance-visits','report_pending')}>{summary.visits.reports_pending} reports pending</button>}</div>}
    </section>
    <Module icon={ClipboardList} title="Recommendations requiring attention" wide count={summary?.recommendations?.open} state={recommendations} onView={() => onSelectTab('recommendations')} empty="No recommendations require attention.">{recommendations.data?.map(row => <article key={row.id}><div><strong>{row.finding}</strong><small>Due {fmtDate(row.due_date)} · {row.owner_name || 'Unassigned'}</small></div><div className="cs-overview-status"><span className={`badge badge-${row.risk_level}`}>{row.risk_level} risk</span><span>{row.status.replaceAll('_',' ')}</span></div></article>)}</Module>
  </div>;
}
