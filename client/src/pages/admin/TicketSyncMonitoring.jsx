import { useCallback,useEffect,useState } from 'react';
import { AlertTriangle,RefreshCw,RotateCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { fmtDateTime } from '../../components/Shared';

const when=value => value ? fmtDateTime(value) : 'Never';
const statusClass=status => status==='success' ? 'done' : status==='failed' ? 'cancelled' : 'in_progress';

export default function TicketSyncMonitoring({ onMessage, standalone }) {
  const [monitoring,setMonitoring]=useState(null),[runs,setRuns]=useState([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[syncing,setSyncing]=useState(null),[refresh,setRefresh]=useState(0);
  const load=useCallback(async signal => {
    setLoading(true);setError('');
    try {
      const [status,history]=await Promise.all([api.ticketingMonitoring({ signal }),api.ticketSyncRuns({}, { signal })]);
      if (!signal.aborted) { setMonitoring(status);setRuns(history.rows || []); }
    } catch(failure) { if (!signal.aborted) setError(failure.message); }
    finally { if (!signal.aborted) setLoading(false); }
  },[]);
  useEffect(() => { const controller=new AbortController();load(controller.signal);return () => controller.abort(); },[load,refresh]);
  async function sync(customer) {
    setSyncing(customer.customer_id);setError('');
    try {
      const result=await api.syncManagedCustomerTickets(customer.customer_id);
      onMessage?.(`${customer.customer_name} synchronized: ${result.tickets_found} found, ${result.tickets_created} created, ${result.tickets_updated} updated.`);
      setRefresh(value => value+1);
    } catch(failure) { setError(failure.message); }
    finally { setSyncing(null); }
  }
  return <section style={standalone ? undefined : { marginTop:24,borderTop:'1px solid var(--gray-200)',paddingTop:20 }}>
    <div className="u-0fdabd3"><div><h3 className="u-de00808">Synchronization monitoring</h3><p className="text-muted text-sm">Mapping health, synchronized ticket totals, and the latest Request Tracker runs.</p></div><button type="button" className="btn btn-ghost btn-sm" disabled={loading || syncing!==null} onClick={() => setRefresh(value => value+1)}><RefreshCw size={13} /> Refresh</button></div>
    {error && <div className="error-msg mb-12" role="alert">{error}</div>}
    {loading && !monitoring ? <p className="text-muted text-sm" role="status">Loading synchronization status...</p> : monitoring && <>
      {(!monitoring.integration.enabled || !monitoring.integration.configured || monitoring.summary.mapping_problems>0) && <div className="alert alert-warning u-20ff911"><AlertTriangle size={15} style={{ marginTop:2,flexShrink:0 }} /><span>{!monitoring.integration.enabled ? 'The Request Tracker integration is disabled.' : !monitoring.integration.configured ? 'Complete the RT URL and token configuration before synchronizing.' : `${monitoring.summary.mapping_problems} customer mapping(s) need attention.`}{standalone && (!monitoring.integration.enabled || !monitoring.integration.configured) && <> <Link to="/settings/integrations">Configure it in Integrations →</Link></>}</span></div>}
      <div className="u-70cfa37">{[['Mapped customers',monitoring.summary.mapped_customers],['Stored tickets',monitoring.summary.total_tickets],['Failed runs',monitoring.summary.failed_runs],['Last success',when(monitoring.summary.last_successful_sync_at)]].map(([label,value]) => <div className="card u-cc781ba" key={label}><div className="text-muted text-sm">{label}</div><strong className="u-36b6c94" style={{ fontSize:label==='Last success'?12:20 }}>{value}</strong></div>)}</div>
      {!monitoring.customers.length ? <p className="text-muted text-sm">No customer queues are mapped.</p> : <div className="table-wrap"><table><thead><tr><th>Customer / Queue</th><th>Tickets</th><th>Open</th><th>Last successful sync</th><th>Status</th><th /></tr></thead><tbody>{monitoring.customers.map(customer => <tr key={customer.customer_id}><td><strong>{customer.customer_name}</strong><div className="text-muted text-sm">{customer.external_queue_name} ({customer.external_queue_id})</div>{customer.mapping_problem && <div className="u-b89d96f">{customer.mapping_problem}</div>}</td><td>{customer.ticket_count}</td><td>{customer.open_ticket_count}</td><td className="text-sm">{when(customer.last_successful_sync_at)}</td><td><span className={`badge badge-${statusClass(customer.last_sync_status)}`}>{customer.last_sync_status || 'Never run'}</span></td><td><button type="button" className="btn btn-primary btn-sm" disabled={syncing!==null || !!customer.mapping_problem || !monitoring.integration.enabled || !monitoring.integration.configured} onClick={() => sync(customer)}>{syncing===customer.customer_id ? 'Syncing...' : <><RotateCw size={12} /> Sync Now</>}</button></td></tr>)}</tbody></table></div>}
      <h4 className="u-9e5c661">Recent sync history</h4>
      {!runs.length ? <p className="text-muted text-sm">No synchronization runs have been recorded.</p> : <div className="table-wrap u-98a7e0c"><table><thead><tr><th>Started</th><th>Customer</th><th>Status</th><th>Found</th><th>Created</th><th>Updated</th><th>Triggered by</th><th>Details</th></tr></thead><tbody>{runs.map(run => <tr key={run.id}><td className="text-sm">{when(run.started_at)}</td><td>{run.customer_name || `Customer ${run.customer_id || 'removed'}`}</td><td><span className={`badge badge-${statusClass(run.status)}`}>{run.status}</span></td><td>{run.tickets_found}</td><td>{run.tickets_created}</td><td>{run.tickets_updated}</td><td>{run.triggered_by_name || 'Scheduler'}</td><td style={{ color:run.error_message?'var(--danger)':undefined }}>{run.error_message || (run.completed_at ? `Completed ${when(run.completed_at)}` : 'In progress')}</td></tr>)}</tbody></table></div>}
    </>}
  </section>;
}
