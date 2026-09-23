import React, { useEffect,useState } from 'react';
import { useParams,useLocation,useNavigate,Link } from 'react-router-dom';
import { Activity,ArrowLeft,BriefcaseBusiness,Building2,CalendarDays,CheckSquare,ChevronDown,ClipboardList,ExternalLink,Layers,Mail,MapPin,Phone,Plus,Settings2,Wrench } from 'lucide-react';
import { api } from '../api';
import { StatusBadge,fmtDate } from '../components/Shared';
import CustomerOverview from '../components/CustomerOverview';
import CustomerRecommendations from '../components/CustomerRecommendations';
import CustomerAssets from '../components/CustomerAssets';
import ManagedCustomerConfiguration from '../components/ManagedCustomerConfiguration';
import { CustomerProjects,CustomerTasks,CustomerVisits } from '../components/CustomerWorkSections';
import CustomerTimeline from '../components/CustomerTimeline';
import { fmtHours,plural,Ranking } from '../components/ServiceCharts';
import { fmtDuration,groupByDay,LedgerDay } from '../components/activityLedger';
import { useAuth } from '../App';
import { customer360Section,customer360Sections,customerHealth,customerHue } from './customer360';
import './CustomerServiceProfile.css';

const initialsOf=name => (name || '').trim().split(/\s+/).map(word => word[0]).slice(0,2).join('').toUpperCase() || '?';

function HealthCard({ icon:Icon,label,value,note,state='default',onClick,href,bar }) {
  const body=<><div className="cs-health-head"><Icon size={15} aria-hidden="true" /><span>{label}</span></div><div className="cs-health-value">{value}</div>{note && <div className="cs-health-note">{note}</div>}{bar}</>;
  const className=`card cs-health-card${state!=='default'?` is-${state}`:''}${onClick || href?' is-actionable':''}`;
  if (href) return <Link to={href} className={className}>{body}</Link>;
  if (onClick) return <button type="button" className={className} onClick={onClick}>{body}</button>;
  return <section className={className}>{body}</section>;
}

function QuickAdd({ customer,user,saAccess,onRecommendation }) {
  const items=[];
  if (user.role==='manager' || (saAccess.enabled && user.role==='engineer')) items.push(['activity','Log Service Activity',`/activity-log?create=1&customer_id=${customer.id}`,Activity]);
  if (['manager','engineer'].includes(user.role)) items.push(['task','Create Task',`/tasks?create=1&customer_id=${customer.id}`,CheckSquare]);
  if (user.role==='manager') items.push(['project','Create Project',`/projects?create=1&customer_id=${customer.id}`,BriefcaseBusiness]);
  if (['manager','planner'].includes(user.role)) items.push(['visit','Schedule Maintenance Visit',`/maintenance-visits?create=1&customer_id=${customer.id}`,Wrench]);
  if (['manager','planner','engineer'].includes(user.role)) items.push(['recommendation','Add Recommendation',null,ClipboardList]);
  if (!items.length) return null;
  return <details className="cs-quick-add"><summary className="btn btn-primary"><Plus size={15} /> Add <ChevronDown size={14} /></summary><div className="cs-quick-menu" role="menu">
    {items.map(([key,label,to,Icon]) => to ? <Link key={key} to={to} role="menuitem"><Icon size={15} />{label}</Link> : <button key={key} type="button" role="menuitem" onClick={event => { event.currentTarget.closest('details').open=false;onRecommendation(); }}><Icon size={15} />{label}</button>)}
  </div></details>;
}

/* Overall health as a ring — the one number a manager scans first. The
   deductions behind it sit under a disclosure, so it's never a black box. */
function HealthRing({ health }) {
  const radius=26,circumference=2*Math.PI*radius;
  return <details className={`cs-health-ring is-${health.tone}`}>
    <summary aria-label={`Customer health ${health.score} out of 100, ${health.label}`}>
      <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r={radius} className="cs-ring-track" />
        <circle cx="32" cy="32" r={radius} className="cs-ring-value" strokeDasharray={`${(health.score/100)*circumference} ${circumference}`} transform="rotate(-90 32 32)" />
        <text x="32" y="37" textAnchor="middle" className="cs-ring-score">{health.score}</text>
      </svg>
      <span><strong>{health.label}</strong><small>{health.factors.length ? 'See why' : 'Nothing outstanding'}</small></span>
    </summary>
    {health.factors.length>0 && <ul className="cs-ring-factors">{health.factors.map(factor => <li key={factor.label}><b>−{factor.points}</b> {factor.label}</li>)}</ul>}
  </details>;
}

function CustomerHeader({ customer,operations,user,saAccess,onRecommendation }) {
  const contact=customer.contact_name || customer.primary_contact;
  const managed=operations?.managed;
  const health=user.role==='manager' ? customerHealth(operations) : null;
  return <header className="card cs-customer-header" style={{ '--cs-hue':customerHue(customer.name) }}>
    <div className="cs-identity-avatar" aria-hidden="true">{initialsOf(customer.name)}</div>
    <div className="cs-customer-heading"><div className="cs-customer-title"><h1>{customer.name}</h1><span className={`badge badge-${customer.active===0?'cancelled':'active'}`}>{customer.active===0?'Inactive':'Active'}</span>{managed?.visible && managed.state!=='unavailable' && <span className={`badge badge-managed-${managed.state}`}>{{ not_enabled:'Managed services off',setup_required:'Managed setup incomplete',sync_attention:'Managed sync attention',active:'Managed services active' }[managed.state]}</span>}</div>
      <div className="cs-customer-meta">
        {contact && <span><Building2 size={13} />{contact}</span>}
        {customer.contact_email && <a href={`mailto:${customer.contact_email}`}><Mail size={13} />{customer.contact_email}</a>}
        {customer.contact_phone && <a href={`tel:${customer.contact_phone}`}><Phone size={13} />{customer.contact_phone}</a>}
        {(customer.location || customer.address) && <span><MapPin size={13} />{customer.location || customer.address}</span>}
        {managed?.responsible_team && <span><Layers size={13} />{managed.responsible_team}</span>}
      </div>
    </div>
    <div className="cs-header-actions">{health && <HealthRing health={health} />}<QuickAdd customer={customer} user={user} saAccess={saAccess} onRecommendation={onRecommendation} />{managed?.state==='active' || managed?.state==='sync_attention' ? <Link className="btn btn-ghost" to={`/managed-customers/${customer.id}`}><ExternalLink size={14} /> Managed Services</Link> : null}</div>
  </header>;
}

function CustomerHealthStrip({ customerId,data,error,onSelectTab }) {
  if (error) return <div className="cs-module-warning" role="status">Operational summary unavailable. Detailed sections remain available.</div>;
  if (!data) return <div className="cs-health-strip" aria-label="Loading customer summary">{Array.from({ length:5 },(_,index) => <div className="card cs-health-card cs-health-skeleton" key={index} />)}</div>;
  const managedLabels={ not_enabled:['Not enabled','Configure Managed Services'],setup_required:['Setup required','Choose a responsible team'],active:['Active','Open Managed Services dashboard'],sync_attention:['Needs attention','Last ticket sync failed'],unavailable:['Unavailable','Configuration could not be loaded'] };
  const ticketsKnown=['active','sync_attention'].includes(data.managed?.state) && data.managed?.open_tickets!=null;
  const managed=managedLabels[data.managed?.state] || managedLabels.unavailable;
  const managedValue=ticketsKnown ? `${data.managed.open_tickets} open` : managed[0];
  const managedNote=ticketsKnown ? `${data.managed.closed_tickets} closed${data.managed.state==='sync_attention' ? ' · Last sync failed' : ' · Open Managed Services dashboard'}` : managed[1];
  const managedBar=ticketsKnown && (data.managed.open_tickets+data.managed.closed_tickets)>0
    ? <div className="cs-health-bar" role="img" aria-label={`${data.managed.open_tickets} open, ${data.managed.closed_tickets} closed`}>
        {data.managed.open_tickets>0 && <span style={{ flexGrow:data.managed.open_tickets,background:'var(--warning)' }} />}
        {data.managed.closed_tickets>0 && <span style={{ flexGrow:data.managed.closed_tickets,background:'var(--success)' }} />}
      </div>
    : null;
  return <div className="cs-health-strip">
    <HealthCard icon={BriefcaseBusiness} label="Active Projects" value={data.projects.active} note={`${data.projects.delayed} delayed or overdue`} state={data.projects.delayed?'danger':'default'} onClick={() => onSelectTab('projects',data.projects.delayed?'delayed':'active')} />
    {data.tasks.visible!==false && <HealthCard icon={CheckSquare} label="Open Tasks" value={data.tasks.open} note={`${data.tasks.overdue} overdue`} state={data.tasks.overdue?'danger':'default'} onClick={() => onSelectTab('tasks',data.tasks.overdue?'overdue':'open')} />}
    <HealthCard icon={ClipboardList} label="Recommendations" value={data.recommendations.open} note={`${data.recommendations.high_risk} high risk`} state={data.recommendations.high_risk?'warning':'default'} onClick={() => onSelectTab('recommendations')} />
    <HealthCard icon={CalendarDays} label="Maintenance Visits" value={data.visits.next ? fmtDate(data.visits.next.scheduled_date) : 'None scheduled'} note={data.visits.reports_pending ? `${data.visits.reports_pending} reports pending` : `${data.visits.this_year} this year`} state={data.visits.reports_pending?'warning':'default'} onClick={() => onSelectTab('maintenance-visits',data.visits.reports_pending?'report_pending':'upcoming')} />
    {data.managed?.visible && <HealthCard icon={Settings2} label="Managed Services" value={managedValue} note={managedNote} bar={managedBar} state={data.managed.state==='sync_attention'?'danger':data.managed.state==='setup_required'?'warning':'default'} href={['active','sync_attention'].includes(data.managed.state)?`/managed-customers/${customerId}`:undefined} onClick={!['active','sync_attention'].includes(data.managed.state)?() => onSelectTab('service-configuration'):undefined} />}
    {data.assets>0 && <HealthCard icon={Layers} label="Assets" value={data.assets} note="Recorded customer assets" onClick={() => onSelectTab('assets')} />}
  </div>;
}

function ActivitiesSection({ id,user,engineers,categories }) {
  const [from,setFrom]=useState(''),[to,setTo]=useState(''),[engineerFilter,setEngineerFilter]=useState(''),[categoryFilter,setCategoryFilter]=useState(''),[statusFilter,setStatusFilter]=useState('');
  const [summary,setSummary]=useState(null),[timeline,setTimeline]=useState([]),[total,setTotal]=useState(0),[page,setPage]=useState(1),[loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(() => {
    const controller=new AbortController(),params={ page,page_size:25 };
    if (from) params.from=from;if (to) params.to=to;if (engineerFilter) params.engineer_id=engineerFilter;if (categoryFilter) params.category_id=categoryFilter;if (statusFilter) params.status=statusFilter;
    setLoading(true);setError('');
    Promise.all([api.customerServiceActivities(id,params,{ signal:controller.signal }),api.customerServiceSummary(id,{ from,to },{ signal:controller.signal })]).then(([activities,result]) => {
      if (!controller.signal.aborted) { setTimeline(activities.rows);setTotal(activities.total);setSummary(result); }
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  },[id,page,from,to,engineerFilter,categoryFilter,statusFilter,retry]);
  const clear=() => { setFrom('');setTo('');setEngineerFilter('');setCategoryFilter('');setStatusFilter('');setPage(1); };
  return <div className="cs-activities activity-log">
    {summary && <div className="cs-activity-metrics"><HealthCard icon={Activity} label="Activities" value={summary.total_activities} note="In selected period" /><HealthCard icon={CalendarDays} label="Logged Hours" value={fmtHours(summary.total_hours)} /><HealthCard icon={BriefcaseBusiness} label="Engineers" value={summary.byEngineer.length} /><HealthCard icon={Layers} label="Top Category" value={summary.byCategory[0]?.name || 'No activity'} note={summary.byCategory[0] ? `${summary.byCategory[0].count} activities` : ''} /></div>}
    {summary?.total_activities>0 && <div className="cs-rankings"><Ranking title="Hours by category" rows={summary.byCategory || []} valueKey="hours" format={fmtHours} detail={row => plural(row.count,'activity','activities')} /><Ranking title="Hours by engineer" rows={summary.byEngineer || []} valueKey="hours" format={fmtHours} /></div>}
    <div className="cs-toolbar"><div><label htmlFor="cs-from">From</label><input id="cs-from" type="date" value={from} onChange={event => { setFrom(event.target.value);setPage(1); }} /></div><div><label htmlFor="cs-to">To</label><input id="cs-to" type="date" value={to} onChange={event => { setTo(event.target.value);setPage(1); }} /></div><div><label htmlFor="cs-engineer">Engineer</label><select id="cs-engineer" value={engineerFilter} onChange={event => { setEngineerFilter(event.target.value);setPage(1); }}><option value="">All engineers</option>{engineers.map(engineer => <option key={engineer.id} value={engineer.id}>{engineer.name}</option>)}</select></div><div><label htmlFor="cs-category">Category</label><select id="cs-category" value={categoryFilter} onChange={event => { setCategoryFilter(event.target.value);setPage(1); }}><option value="">All categories</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div><div><label htmlFor="cs-status">Status</label><select id="cs-status" value={statusFilter} onChange={event => { setStatusFilter(event.target.value);setPage(1); }}><option value="">All statuses</option><option value="open">Open</option><option value="in_progress">In Progress</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></div>{(from || to || engineerFilter || categoryFilter || statusFilter) && <button type="button" className="cs-clear" onClick={clear}>Clear filters</button>}</div>
    {error ? <div className="error-msg" role="alert">{error} <button className="btn btn-ghost btn-sm" onClick={() => setRetry(value => value+1)}>Retry</button></div> : loading ? <div className="skeleton-table" aria-label="Loading activities"><span /><span /><span /></div> : !timeline.length ? <div className="card cs-empty"><h2>No service activities found</h2><p>Activities logged against this customer will appear here.</p></div> : <div className="card al-ledger">{groupByDay(timeline,page,Math.max(1,Math.ceil(total/25))).map(group => <LedgerDay key={group.date} group={group}>{group.rows.map(activity => <li className="al-entry" key={activity.id}><span className={'al-duration'+(activity.duration_minutes?'':' is-unset')}>{activity.duration_minutes?fmtDuration(activity.duration_minutes):'No time'}</span><div className="al-main">{user.role==='manager'?<Link className="al-title" to={`/activity-log?activity=${activity.id}`}>{activity.title}</Link>:<span className="al-title is-static">{activity.title}</span>}<div className="al-meta"><span className="al-customer">{activity.engineer_name}</span><span>{activity.category_name}</span><span className="al-ref">{activity.activity_reference}</span></div></div><div className="al-side"><StatusBadge entityType="service_activity" s={activity.status} /></div></li>)}</LedgerDay>)}<div className="al-pager"><span>{total} activities</span><div className="al-pager-nav"><button className="btn btn-ghost btn-sm" disabled={page<=1} onClick={() => setPage(value => value-1)}>Previous</button><span>Page {page} of {Math.max(1,Math.ceil(total/25))}</span><button className="btn btn-ghost btn-sm" disabled={page*25>=total} onClick={() => setPage(value => value+1)}>Next</button></div></div></div>}
  </div>;
}

export default function CustomerServiceProfile() {
  const { user,saAccess }=useAuth(),{ id }=useParams(),location=useLocation(),navigate=useNavigate();
  const query=new URLSearchParams(location.search),source=query.get('source_visit');
  const sourceVisitId=source && /^[1-9]\d*$/.test(source) && Number.isSafeInteger(Number(source)) ? Number(source) : null;
  const tab=customer360Section(user,query.get('section'));
  const [customer,setCustomer]=useState(null),[operations,setOperations]=useState(null),[operationsError,setOperationsError]=useState(''),[profileError,setProfileError]=useState(''),[retry,setRetry]=useState(0);
  const [engineers,setEngineers]=useState([]),[categories,setCategories]=useState([]);
  useEffect(() => { const controller=new AbortController();setCustomer(null);setProfileError('');api.customer(id,{ signal:controller.signal }).then(result => { if (!controller.signal.aborted) setCustomer(result); }).catch(failure => { if (!controller.signal.aborted) setProfileError(failure.message); });return () => controller.abort(); },[id,retry]);
  useEffect(() => { const controller=new AbortController();setOperations(null);setOperationsError('');api.customerOperationsSummary(id,{ signal:controller.signal }).then(result => { if (!controller.signal.aborted) setOperations(result); }).catch(failure => { if (!controller.signal.aborted) setOperationsError(failure.message); });return () => controller.abort(); },[id,retry]);
  useEffect(() => { if (!['activities','tasks'].includes(tab)) return undefined;const controller=new AbortController();Promise.all([api.users({ signal:controller.signal }),tab==='activities'?api.activityCategories({ signal:controller.signal }):Promise.resolve([])]).then(([users,cats]) => { if (!controller.signal.aborted) { setEngineers(users.filter(item => item.role==='engineer'));setCategories(cats); } }).catch(() => {});return () => controller.abort(); },[tab]);
  function selectTab(section,filter=null,create=false) { const params=new URLSearchParams(location.search);params.set('section',customer360Section(user,section));if (filter) params.set('filter',filter);else params.delete('filter');if (create) params.set('create','1');else params.delete('create');if (section!=='recommendations') params.delete('source_visit');navigate({ pathname:location.pathname,search:`?${params}` }); }
  function moveTab(event,index) { if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?sections.length-1:(index+(event.key==='ArrowRight'?1:-1)+sections.length)%sections.length;selectTab(sections[next].id);requestAnimationFrame(() => document.getElementById(`customer-tab-${sections[next].id}`)?.focus()); }
  useEffect(() => { const requested=query.get('section'),safe=customer360Section(user,requested);if (requested!==safe) { const params=new URLSearchParams(location.search);params.set('section',safe);navigate({ pathname:location.pathname,search:`?${params}` },{ replace:true }); } },[location.pathname,location.search,navigate,user]);
  if (profileError) return <div className="page"><div className="error-msg" role="alert">{profileError} <button className="btn btn-ghost" onClick={() => setRetry(value => value+1)}>Retry</button></div></div>;
  if (!customer || customer.id!==Number(id)) return <div className="page"><div className="cs-profile-skeleton"><span /><span /><span /></div></div>;
  const sections=customer360Sections(user);
  return <div className="page cs-page"><Link to={user.role==='manager'?'/customers':'/'} className="cs-back"><ArrowLeft size={12} /> {user.role==='manager'?'Back to Customers':'Back to Dashboard'}</Link>
    <CustomerHeader customer={customer} operations={operations} user={user} saAccess={saAccess} onRecommendation={() => selectTab('recommendations',null,true)} />
    <CustomerHealthStrip customerId={customer.id} data={operations} error={operationsError} onSelectTab={selectTab} />
    <div className="tabs cs-tabs" role="tablist" aria-label="Customer 360 sections">{sections.map((section,index) => <button key={section.id} id={`customer-tab-${section.id}`} type="button" className={`tab${tab===section.id?' active':''}`} role="tab" aria-selected={tab===section.id} aria-controls="customer-360-panel" tabIndex={tab===section.id?0:-1} onKeyDown={event => moveTab(event,index)} onClick={() => selectTab(section.id)}>{section.label}</button>)}</div>
    <main id="customer-360-panel" className="cs-tab-panel" role="tabpanel" aria-labelledby={`customer-tab-${tab}`}>
      {tab==='overview' ? <CustomerOverview key={customer.id} customer={customer} summary={operations} summaryError={operationsError} onSelectTab={selectTab} /> : tab==='projects' ? <CustomerProjects key={`${customer.id}:${query.get('filter') || ''}`} customerId={customer.id} initialFilter={query.get('filter')} /> : tab==='tasks' ? <CustomerTasks key={`${customer.id}:${query.get('filter') || ''}`} customerId={customer.id} initialFilter={query.get('filter')} engineers={user.role==='manager'?engineers:[]} /> : tab==='maintenance-visits' ? <CustomerVisits key={`${customer.id}:${query.get('filter') || ''}`} customerId={customer.id} initialFilter={query.get('filter')} /> : tab==='timeline' ? <CustomerTimeline customerId={customer.id} user={user} /> : tab==='service-configuration' && user.role==='manager' ? <ManagedCustomerConfiguration key={customer.id} customerId={customer.id} /> : tab==='assets' && user.role==='manager' ? <CustomerAssets key={customer.id} customerId={customer.id} /> : tab==='recommendations' ? <CustomerRecommendations key={customer.id} customerId={customer.id} sourceVisitId={sourceVisitId} create={query.get('create')==='1'} onSourceConsumed={() => { const params=new URLSearchParams(location.search);params.delete('source_visit');params.delete('create');navigate(`${location.pathname}?${params}`,{ replace:true }); }} /> : <ActivitiesSection id={id} user={user} engineers={engineers} categories={categories} />}
    </main>
  </div>;
}
