import { useEffect,useState } from 'react';
import { Activity,BriefcaseBusiness,CalendarDays,CheckSquare,ClipboardList,Layers } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { fmtDateTime } from './Shared';

const META={
  project:[BriefcaseBusiness,'Project'],task:[CheckSquare,'Task'],visit:[CalendarDays,'Maintenance visit'],visit_report:[CalendarDays,'Visit report'],
  activity:[Activity,'Service activity'],recommendation:[ClipboardList,'Recommendation'],asset:[Layers,'Asset'],
};

function eventLink(event,customerId,user) {
  if (event.kind==='project') return `/projects/${event.entity_id}`;
  if (event.kind==='activity' && user.role==='manager') return `/activity-log?activity=${event.entity_id}`;
  if (event.kind==='visit' || event.kind==='visit_report') return `/maintenance-visits?customer_id=${customerId}`;
  if (event.kind==='recommendation') return `/customers/${customerId}/service-profile?section=recommendations`;
  if (event.kind==='asset') return `/customers/${customerId}/service-profile?section=assets`;
  return null;
}

export default function CustomerTimeline({ customerId,user }) {
  const [page,setPage]=useState(1),[data,setData]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(() => { const controller=new AbortController();setData(null);setError('');api.customerOperationTimeline(customerId,{ page,page_size:25 },{ signal:controller.signal }).then(result => { if(!controller.signal.aborted) setData(result); }).catch(failure => { if(!controller.signal.aborted) setError(failure.message); });return () => controller.abort(); },[customerId,page,retry]);
  if (error) return <div className="error-msg" role="alert">{error} <button className="btn btn-ghost btn-sm" onClick={() => setRetry(value => value+1)}>Retry</button></div>;
  if (!data) return <div className="skeleton-table" role="status" aria-label="Loading customer timeline"><span /><span /><span /></div>;
  if (!data.rows.length) return <div className="card cs-empty"><h2>No recorded events</h2><p>Customer activity will appear here as work is created and updated.</p></div>;
  const pages=Math.max(1,Math.ceil(data.total/data.page_size));
  return <section className="card cs-timeline"><ol>{data.rows.map(event => { const [Icon,label]=META[event.kind] || [Activity,'Activity'],to=eventLink(event,customerId,user);return <li key={`${event.kind}:${event.event_id}`}><span className="cs-timeline-icon"><Icon size={15} aria-hidden="true" /></span><div><div className="cs-timeline-meta"><span>{label}</span><time>{fmtDateTime(event.event_at)}</time></div>{to?<Link to={to}>{event.title}</Link>:<strong>{event.title}</strong>}<p>{event.action.replaceAll('_',' ')}{event.actor_name?` by ${event.actor_name}`:''}</p></div></li>;})}</ol><div className="cs-work-pager"><span>{data.total} events</span><div><button className="btn btn-ghost btn-sm" disabled={page<=1} onClick={() => setPage(value => value-1)}>Previous</button><span>Page {page} of {pages}</span><button className="btn btn-ghost btn-sm" disabled={page>=pages} onClick={() => setPage(value => value+1)}>Next</button></div></div></section>;
}
