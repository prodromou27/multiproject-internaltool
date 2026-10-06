import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Save, X } from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../../components/Toast';
import { useLiveRefresh } from '../../live';
import RequestTrackerIntegration from './RequestTrackerIntegration';
import TicketMappingConfiguration from './TicketMappingConfiguration';
import TicketSyncMonitoring from './TicketSyncMonitoring';

/* Settings → Ticketing: everything about Request Tracker in one place —
   the connection, which queue belongs to which customer, how RT statuses and
   priorities map onto the app's, and how syncing is going. */

const sectionStyle = { background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 10, padding: '20px 24px', marginBottom: 20 };
const labelStyle = { fontSize: 12, fontWeight: 600, color: 'var(--gray-600)', marginBottom: 6, display: 'block' };

function CustomerQueues() {
  const toast = useToast();
  const [rows, setRows] = useState(null), [queues, setQueues] = useState(null), [queueError, setQueueError] = useState('');
  const [drafts, setDrafts] = useState({}), [busy, setBusy] = useState(''), [error, setError] = useState(''), [search, setSearch] = useState('');

  const load = useCallback(async () => {
    try {
      // Every active customer can be connected to a queue, managed or not; connected ones first.
      const [customers, monitoring] = await Promise.all([api.customers(), api.ticketingMonitoring()]);
      const byCustomer = new Map((monitoring.customers || []).map(row => [Number(row.customer_id), row]));
      setRows((Array.isArray(customers) ? customers : customers.rows || []).filter(customer => customer.active !== 0 && customer.active !== false)
        .map(customer => ({ ...customer, ticketing: byCustomer.get(Number(customer.id)) || null }))
        .sort((a, b) => Number(!!b.ticketing?.external_queue_id) - Number(!!a.ticketing?.external_queue_id) || String(a.name).localeCompare(String(b.name))));
      setError('');
    } catch (failure) { setError(failure.message); }
  }, []);
  const loadQueues = useCallback(async () => {
    setQueueError('');
    try { setQueues((await api.ticketingQueues()).rows || []); }
    catch (failure) { setQueues([]); setQueueError(failure.message); }
  }, []);
  useEffect(() => { load(); loadQueues(); }, [load, loadQueues]);
  useLiveRefresh(load);

  async function save(customer, queueId) {
    setBusy(`save-${customer.id}`);
    try {
      // The same save as the customer's Service Configuration, so the same rules apply.
      const current = await api.managedCustomerConfiguration(customer.id);
      const queue = (queues || []).find(item => String(item.id) === String(queueId));
      await api.saveManagedCustomerConfiguration(customer.id, queueId
        ? { ...current, external_queue_id: String(queueId), external_queue_name: queue?.name || current.external_queue_name, ticket_integration_enabled: true }
        : { ...current, external_queue_id: '', external_queue_name: '', ticket_integration_enabled: false, ticket_write_back_enabled: false });
      toast.success(queueId ? `${customer.name} now syncs from ${queue?.name || `queue ${queueId}`}` : `${customer.name} no longer syncs tickets`);
      setDrafts(current2 => { const next = { ...current2 }; delete next[customer.id]; return next; });
      await Promise.all([load(), loadQueues()]);
    } catch (failure) { toast.error(failure.message); } finally { setBusy(''); }
  }
  async function syncNow(customer) {
    setBusy(`sync-${customer.id}`);
    try { await api.syncManagedCustomerTickets(customer.id); toast.success(`Sync started for ${customer.name}`); await load(); }
    catch (failure) { toast.error(failure.message); } finally { setBusy(''); }
  }

  if (error) return <div className="error-msg" role="alert">{error} <button className="btn btn-ghost btn-sm" onClick={load}>Retry</button></div>;
  if (!rows) return <p className="text-muted text-sm">Loading customers…</p>;
  return <>
    {queueError && <p className="text-sm text-muted">RT queues could not be listed ({queueError}). Set up and test the connection above, then <button type="button" className="btn btn-ghost btn-sm" onClick={loadQueues}><RefreshCw size={12} /> Try again</button></p>}
    {rows.length > 8 && <input type="search" className="ticketing-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Find a customer…" aria-label="Find a customer" />}
    {!rows.length ? <p className="text-muted text-sm">No customers yet.</p> :
      <div className="table-wrap"><table className="ticketing-queues">
        <thead><tr><th>Customer</th><th>RT queue</th><th>Last sync</th><th /></tr></thead>
        <tbody>{rows.filter(customer => !search.trim() || String(customer.name).toLowerCase().includes(search.trim().toLowerCase())).map(customer => {
          const currentId = customer.ticketing?.external_queue_id ? String(customer.ticketing.external_queue_id) : '';
          const draft = drafts[customer.id] ?? currentId;
          const changed = draft !== currentId;
          const known = (queues || []).some(queue => String(queue.id) === currentId);
          return <tr key={customer.id}>
            <td><Link to={`/customers/${customer.id}/service-profile?section=service-configuration`}>{customer.name}</Link><div className="text-muted text-sm">{customer.is_managed ? 'Managed customer' : 'Customer'}</div></td>
            <td>
              <select aria-label={`RT queue for ${customer.name}`} value={draft} disabled={!queues?.length && !currentId} onChange={event => setDrafts(current => ({ ...current, [customer.id]: event.target.value }))}>
                <option value="">Not connected</option>
                {currentId && !known && <option value={currentId}>{customer.ticketing.external_queue_name || `Queue ${currentId}`}</option>}
                {(queues || []).map(queue => {
                  const takenBy = queue.mapping && Number(queue.mapping.customer_id) !== Number(customer.id) ? queue.mapping.customer_name : null;
                  return <option key={queue.id} value={String(queue.id)} disabled={!!takenBy}>{queue.name}{takenBy ? ` (used by ${takenBy})` : ''}</option>;
                })}
              </select>
            </td>
            <td className="text-sm">{customer.ticketing
              ? <>{customer.ticketing.last_successful_sync_at || 'Not yet'}{customer.ticketing.last_sync_status === 'failed' && <div className="text-danger">Last sync failed</div>}{customer.ticketing.mapping_problem && <div className="text-muted">{customer.ticketing.mapping_problem}</div>}</>
              : <span className="text-muted">—</span>}</td>
            <td><div className="flex gap-8">
              {changed && <button type="button" className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => save(customer, draft)}><Save size={12} /> {draft ? 'Save' : 'Disconnect'}</button>}
              {changed && <button type="button" className="btn btn-ghost btn-sm" aria-label={`Undo change for ${customer.name}`} disabled={!!busy} onClick={() => setDrafts(current => { const next = { ...current }; delete next[customer.id]; return next; })}><X size={12} /></button>}
              {!changed && currentId && customer.ticketing?.enabled && <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => syncNow(customer)}><RefreshCw size={12} /> {busy === `sync-${customer.id}` ? 'Starting…' : 'Sync now'}</button>}
            </div></td>
          </tr>;
        })}</tbody>
      </table></div>}
  </>;
}

export default function TicketingSettings() {
  const toast = useToast();
  return <div>
    <section style={sectionStyle} aria-label="Request Tracker connection">
      <h3 className="ticketing-heading">1. Connection</h3>
      <p className="text-muted text-sm">The Request Tracker server the app reads tickets from.</p>
      <RequestTrackerIntegration sectionStyle={{}} labelStyle={labelStyle} />
    </section>
    <section style={sectionStyle} aria-label="Customer queues">
      <h3 className="ticketing-heading">2. Customer queues</h3>
      <p className="text-muted text-sm">Which RT queue holds each customer's tickets. A queue can belong to one customer only. The same choice appears in each customer's Service Configuration.</p>
      <CustomerQueues />
    </section>
    <section style={sectionStyle} aria-label="Status and priority mapping">
      <h3 className="ticketing-heading">3. Status and priority mapping</h3>
      <TicketMappingConfiguration />
    </section>
    <section style={sectionStyle} aria-label="Sync health">
      <h3 className="ticketing-heading">4. Sync health</h3>
      <TicketSyncMonitoring standalone onMessage={toast.success} />
    </section>
  </div>;
}
