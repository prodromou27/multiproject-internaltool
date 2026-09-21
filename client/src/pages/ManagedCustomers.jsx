import { useEffect,useMemo,useState } from 'react';
import { ArrowLeft,Building2,RefreshCw } from 'lucide-react';
import { Link,useParams } from 'react-router-dom';
import { api } from '../api';

const iso=date => date.toISOString().slice(0,10);
function period(preset,from,to) {
  const now=new Date();
  if (preset==='last_month') return { from:iso(new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,1))),to:iso(new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),0))) };
  if (preset==='custom') return { from,to };
  return { from:`${iso(now).slice(0,7)}-01`,to:iso(now) };
}
const Metric=({ label,value,note }) => <div className="card" style={{ padding:18 }}><div className="text-muted text-sm">{label}</div><div style={{ fontSize:28,fontWeight:750,marginTop:4 }}>{value ?? 0}</div>{note && <div className="text-muted text-sm mt-4">{note}</div>}</div>;

function Landing() {
  const [rows,setRows]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[search,setSearch]=useState('');
  useEffect(() => { const controller=new AbortController();api.managedCustomers({ signal:controller.signal }).then(result => setRows(result.rows || [])).catch(failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });return () => controller.abort(); },[]);
  const filtered=rows.filter(row => row.name.toLowerCase().includes(search.trim().toLowerCase()));
  return <div className="page"><div className="page-header"><div><h1 className="page-title"><Building2 size={22} /> Managed Customers</h1><p className="text-muted text-sm mt-4">Current service health across customers enrolled in Managed Services</p></div></div>
    <div className="card" style={{ marginBottom:16 }}><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search managed customers..." style={{ maxWidth:360 }} /></div>
    {error ? <div className="error-msg" role="alert">{error}</div> : loading ? <div className="skeleton-table"><span /><span /><span /></div> : !filtered.length ? <div className="card empty"><p>No managed customers match this view.</p><p className="text-muted text-sm">Enable Managed Services from a customer’s Customer 360 profile.</p></div> : <div className="card table-wrap"><table><thead><tr><th>Customer</th><th>Open tickets</th><th>Pending</th><th>Activities this month</th><th>Open tasks</th><th>Active projects</th><th>Last ticket sync</th><th>Service manager</th></tr></thead><tbody>{filtered.map(row => <tr key={row.id}><td><Link to={`/managed-customers/${row.id}`} style={{ fontWeight:700 }}>{row.name}</Link><div className="text-muted text-sm">{row.responsible_team || 'No responsible team'}</div></td><td>{row.open_tickets}</td><td>{row.pending_tickets}</td><td>{row.activities_this_month}</td><td>{row.open_tasks}</td><td>{row.active_projects}</td><td className="text-sm">{row.last_successful_sync_at || 'Never'}</td><td>{row.service_manager || 'Unassigned'}</td></tr>)}</tbody></table></div>}
  </div>;
}

function Dashboard({ id }) {
  const [preset,setPreset]=useState('month'),[from,setFrom]=useState(''),[to,setTo]=useState(''),[data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const range=useMemo(() => period(preset,from,to),[preset,from,to]);
  useEffect(() => { if (!range.from || !range.to) return;const controller=new AbortController();setLoading(true);setError('');api.managedCustomerOverview(id,range,{ signal:controller.signal }).then(setData).catch(failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });return () => controller.abort(); },[id,range,retry]);
  return <div className="page"><div className="page-header"><div><Link to="/managed-customers" className="text-muted text-sm" style={{ display:'inline-flex',gap:4,alignItems:'center',marginBottom:6 }}><ArrowLeft size={13} /> Managed Customers</Link><h1 className="page-title">{data?.customer?.name || 'Managed customer'}</h1><p className="text-muted text-sm mt-4">{data?.customer?.responsible_team || 'No responsible team'} · {data?.customer?.service_manager || 'No service manager'} · Last ticket sync: {data?.customer?.last_successful_sync_at || 'Never'}</p></div></div>
    <div className="filter-bar" style={{ marginBottom:18 }}>{[['month','This month'],['last_month','Last month'],['custom','Custom']].map(([key,label]) => <button key={key} className={`filter-pill${preset===key?' active':''}`} onClick={() => setPreset(key)}>{label}</button>)}{preset==='custom' && <><input type="date" value={from} onChange={event => setFrom(event.target.value)} /><input type="date" value={to} onChange={event => setTo(event.target.value)} /></>}<button className="btn btn-ghost btn-sm" onClick={() => setRetry(value => value+1)}><RefreshCw size={13} /> Refresh</button></div>
    {error ? <div className="error-msg" role="alert">{error}</div> : loading && !data ? <div className="skeleton-table"><span /><span /><span /></div> : data && <><h2 style={{ fontSize:15,marginBottom:10 }}>Current state</h2><div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12,marginBottom:22 }}><Metric label="Open tickets now" value={data.tickets.open_now} /><Metric label="Pending tickets now" value={data.tickets.pending_now} /><Metric label="High / critical open" value={data.tickets.high_priority_open} /><Metric label="Open tasks now" value={data.tasks.open_now} /><Metric label="Active projects now" value={data.projects.active_now} /><Metric label="Open recommendations now" value={data.recommendations.open_now} /><Metric label="Overdue tasks now" value={data.tasks.overdue_now} /><Metric label="Open SLA breaches" value={data.tickets.sla_breached_open} /></div><h2 style={{ fontSize:15,marginBottom:10 }}>Selected period · {data.period.from} to {data.period.to}</h2><div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12 }}><Metric label="Tickets created" value={data.tickets.created_period} /><Metric label="Tickets resolved" value={data.tickets.resolved_period} /><Metric label="Service activities" value={data.activities.activities} /><Metric label="Service hours" value={data.activities.hours} /><Metric label="Maintenance visits" value={data.visits.visits_period} /></div></>}
  </div>;
}

export default function ManagedCustomers() { const { id }=useParams();return id ? <Dashboard id={id} /> : <Landing />; }
