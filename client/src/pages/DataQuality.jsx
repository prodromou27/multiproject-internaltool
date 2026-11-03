import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { PageHeader } from '../components/PageLayout';
import { FilterGroup } from '../components/ListWorkspace';
import { LoadError } from '../components/LoadError';
import { useToast } from '../components/Toast';

/* Customer data quality (enhancement E06): what is missing or wrong on customer
   records, who owns each customer, and a link to where it is fixed. An item that is
   fine as it is can be dismissed with a reason (and brought back). */
export default function DataQuality() {
  const toast = useToast();
  const [data, setData] = useState(null), [error, setError] = useState(null);
  const [rule, setRule] = useState('all'), [showDismissed, setShowDismissed] = useState(false);
  const [dismissing, setDismissing] = useState(null), [reason, setReason] = useState(''), [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    return api.dataQuality().then(setData).catch(setError);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error && !data) return <div className="page"><PageHeader title="Data quality" /><LoadError what="The data-quality list" error={error} onRetry={load} /></div>;
  if (!data) return <div className="page"><PageHeader title="Data quality" /><p className="text-muted" role="status">Loading…</p></div>;

  const open = data.items.filter(item => !item.dismissed), dismissed = data.items.filter(item => item.dismissed);
  const list = (showDismissed ? dismissed : open).filter(item => rule === 'all' || item.rule === rule);
  const count = key => open.filter(item => item.rule === key).length;
  const key = item => `${item.customer_id}:${item.rule}`;

  async function dismiss(item) {
    if (!reason.trim()) return;
    setBusy(true);
    try { await api.dismissDataQuality({ customer_id: item.customer_id, rule: item.rule, reason: reason.trim() }); setDismissing(null); setReason(''); toast.success('Dismissed'); await load(); }
    catch (failure) { toast.error(failure.message); }
    finally { setBusy(false); }
  }
  async function restore(item) {
    try { await api.restoreDataQuality({ customer_id: item.customer_id, rule: item.rule }); toast.success('Back on the list'); await load(); }
    catch (failure) { toast.error(failure.message); }
  }

  return (
    <div className="page">
      <PageHeader title="Data quality" meta={open.length ? `${open.length} to fix` : 'Nothing to fix.'} />
      <FilterGroup label="Problem">
        <button className={'filter-pill' + (rule === 'all' ? ' active' : '')} onClick={() => setRule('all')}>All ({open.length})</button>
        {Object.entries(data.rules).filter(([k]) => count(k) > 0 || rule === k).map(([k, label]) => (
          <button key={k} className={'filter-pill' + (rule === k ? ' active' : '')} onClick={() => setRule(k)}>{label} ({count(k)})</button>
        ))}
      </FilterGroup>
      {dismissed.length > 0 && (
        <label className="text-sm" style={{ display: 'inline-flex', gap: 6, margin: '8px 0' }}>
          <input type="checkbox" checked={showDismissed} onChange={event => setShowDismissed(event.target.checked)} /> Show dismissed ({dismissed.length})
        </label>
      )}
      {!list.length ? <p className="text-muted">{showDismissed ? 'Nothing dismissed here.' : 'Nothing to fix here.'}</p> : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Customer</th><th>Problem</th><th>Owner</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{list.map(item => (
              <tr key={key(item)}>
                <td><Link to={`/customers/${item.customer_id}`}>{item.customer_name}</Link></td>
                <td>
                  <strong>{item.title}</strong><div className="text-sm text-muted">{item.detail}</div>
                  {item.dismissed && <div className="text-sm">Dismissed{item.dismissed.by ? ` by ${item.dismissed.by}` : ''}: {item.dismissed.reason}</div>}
                  {dismissing === key(item) && (
                    <form className="flex gap-6" style={{ marginTop: 6 }} onSubmit={event => { event.preventDefault(); dismiss(item); }}>
                      <input aria-label={`Why ${item.customer_name}: ${item.title} is fine`} placeholder="Why is this fine?" maxLength={300} value={reason} onChange={event => setReason(event.target.value)} autoFocus />
                      <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !reason.trim()}>Dismiss</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setDismissing(null); setReason(''); }}>Cancel</button>
                    </form>
                  )}
                </td>
                <td>{item.owner || <span className="text-muted">No owner</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {item.dismissed
                    ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => restore(item)}>Undo dismiss</button>
                    : <>
                        <Link className="btn btn-primary btn-sm" to={item.fix} aria-label={`Fix ${item.customer_name}: ${item.title}`}>Fix</Link>{' '}
                        <button type="button" className="btn btn-ghost btn-sm" aria-label={`Dismiss ${item.customer_name}: ${item.title}`} onClick={() => { setDismissing(key(item)); setReason(''); }}>Dismiss</button>
                      </>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
