import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { useToast } from '../../components/Toast';

/* Settings → Ticketing → Engineers in Request Tracker: which TeamHub user each
   RT ticket owner is, so their tickets count in Workload → Tickets resolved.
   RT users whose email matches a TeamHub user are linked automatically. */
export default function TicketOwners() {
  const toast = useToast();
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState('');
  const load = useCallback(async () => {
    try { setData(await api.ticketingOwners()); setError(''); } catch (failure) { setError(failure.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  async function link(row, value) {
    setBusy(row.username);
    try {
      const userId = value ? Number(value) : null;
      setData(await api.linkTicketingOwner(row.username, userId));
      toast.success(userId ? `${row.username} is now ${data.users.find(user => user.id === userId)?.name}` : `${row.username} is no longer linked`);
    } catch (failure) { toast.error(failure.message); } finally { setBusy(''); }
  }
  if (error) return <div className="error-msg" role="alert">{error} <button type="button" className="btn btn-ghost btn-sm" onClick={load}>Retry</button></div>;
  if (!data) return <p className="text-muted text-sm">Loading…</p>;
  if (!data.rows.length) return <p className="text-muted text-sm">No ticket owners yet. They appear here after customer queues have synced.</p>;
  const unlinked = data.rows.filter(row => !row.user_id).length;
  return <>
    {unlinked > 0 && <p className="text-sm">{unlinked} RT user{unlinked === 1 ? ' is' : 's are'} not linked yet.</p>}
    <div className="table-wrap"><table className="ticketing-queues">
      <thead><tr><th>RT user</th><th>Tickets</th><th>TeamHub user</th></tr></thead>
      <tbody>{data.rows.map(row => <tr key={row.username}>
        <td><strong>{row.username}</strong>{row.email && <div className="text-muted text-sm">{row.email}</div>}</td>
        <td className="text-sm">{row.tickets} ({row.open_tickets} open)</td>
        <td>
          <select aria-label={`TeamHub user for ${row.username}`} value={row.user_id || ''} disabled={busy === row.username} onChange={event => link(row, event.target.value)}>
            {/* An email match cannot be undone here, only replaced with another user. */}
            <option value="" disabled={row.linked_by === 'email'}>Not linked</option>
            {data.users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}
          </select>
          {row.linked_by === 'email' && <div className="text-muted text-sm">Matched by email</div>}
        </td>
      </tr>)}</tbody>
    </table></div>
  </>;
}
