import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../../components/Toast';

/* Settings → Ticketing → Engineers in Request Tracker: each TeamHub user and
   their RT user, chosen from the users RT lists. Linked users' tickets are read
   from every RT queue (customer or not) for Workload → Tickets resolved. */
const rtLabel = rt => `${rt.username}${rt.real_name && rt.real_name !== rt.username ? ` (${rt.real_name})` : ''}`;

export default function TicketOwners() {
  const toast = useToast();
  const [links, setLinks] = useState(null), [rtUsers, setRtUsers] = useState(null), [rtError, setRtError] = useState(''), [error, setError] = useState('');
  const [busy, setBusy] = useState(''), [search, setSearch] = useState(''), [onlyUnlinked, setOnlyUnlinked] = useState(false);
  const load = useCallback(async () => {
    try { setLinks((await api.ticketingUserLinks()).rows); setError(''); } catch (failure) { setError(failure.message); }
  }, []);
  const loadRt = useCallback(async (refresh = false) => {
    setRtError('');
    try { setRtUsers((await api.ticketingRtUsers(refresh)).rows); } catch (failure) { setRtUsers([]); setRtError(failure.message); }
  }, []);
  useEffect(() => { load(); loadRt(); }, [load, loadRt]);

  const byEmail = useMemo(() => new Map((rtUsers || []).filter(rt => rt.email).map(rt => [rt.email, rt])), [rtUsers]);
  const taken = useMemo(() => new Map((links || []).filter(row => row.rt_username).map(row => [row.rt_username.toLowerCase(), row.name])), [links]);
  // An RT user with the same email, not yet linked to anyone.
  const suggestion = row => {
    if (row.rt_username || !row.email) return null;
    const rt = byEmail.get(row.email.toLowerCase());
    return rt && !taken.has(rt.username.toLowerCase()) ? rt : null;
  };

  async function link(row, username) {
    setBusy(String(row.id));
    try {
      setLinks((await api.linkTicketingUser(row.id, username || null)).rows);
      toast.success(username ? `${row.name} is ${username} in Request Tracker. Reading their tickets…` : `${row.name} is no longer linked`);
    } catch (failure) { toast.error(failure.message); } finally { setBusy(''); }
  }
  async function linkSuggested() {
    const pending = (links || []).map(row => [row, suggestion(row)]).filter(([, rt]) => rt);
    setBusy('all');
    try {
      for (const [row, rt] of pending) setLinks((await api.linkTicketingUser(row.id, rt.username)).rows);
      toast.success(`Linked ${pending.length} user${pending.length === 1 ? '' : 's'} by email`);
    } catch (failure) { toast.error(failure.message); } finally { setBusy(''); }
  }
  async function readNow() {
    setBusy('sync');
    try { await api.syncTicketingUsers(); toast.success('Reading tickets from Request Tracker. Workload updates in a minute or two.'); }
    catch (failure) { toast.error(failure.message); } finally { setBusy(''); }
  }

  if (error) return <div className="error-msg" role="alert">{error} <button type="button" className="btn btn-ghost btn-sm" onClick={load}>Retry</button></div>;
  if (!links) return <p className="text-muted text-sm">Loading…</p>;
  const suggested = links.filter(row => suggestion(row)).length;
  const term = search.trim().toLowerCase();
  const shown = links.filter(row => (!onlyUnlinked || !row.rt_username) && (!term || `${row.name} ${row.email || ''} ${row.rt_username || ''}`.toLowerCase().includes(term)));
  return <>
    {rtError && <p className="error-msg" role="alert">RT users could not be listed: {rtError} <button type="button" className="btn btn-ghost btn-sm" onClick={() => loadRt(true)}><RefreshCw size={12} /> Try again</button></p>}
    <div className="ticket-owners-tools">
      <input type="search" className="ticketing-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Find a user…" aria-label="Find a user" />
      <label className="flex gap-6 text-sm"><input type="checkbox" checked={onlyUnlinked} onChange={event => setOnlyUnlinked(event.target.checked)} /> Only not linked</label>
      {suggested > 0 && <button type="button" className="btn btn-primary btn-sm" disabled={!!busy} onClick={linkSuggested}>Link {suggested} by matching email</button>}
      <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => loadRt(true)}><RefreshCw size={12} /> Reload RT users</button>
      <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy || !links.some(row => row.rt_username)} onClick={readNow}>Read tickets now</button>
    </div>
    <div className="table-wrap"><table className="ticketing-queues">
      <thead><tr><th>TeamHub user</th><th>RT user</th><th>Tickets</th><th>Last read from RT</th></tr></thead>
      <tbody>{shown.map(row => {
        const hint = suggestion(row);
        const known = !row.rt_username || (rtUsers || []).some(rt => rt.username.toLowerCase() === row.rt_username.toLowerCase());
        return <tr key={row.id}>
          <td><strong>{row.name}</strong><div className="text-muted text-sm">{row.role}{row.email ? ` · ${row.email}` : ''}</div></td>
          <td>
            <select aria-label={`RT user for ${row.name}`} value={row.rt_username || ''} disabled={!!busy || (!rtUsers?.length && !row.rt_username)} onChange={event => link(row, event.target.value)}>
              <option value="">Not linked</option>
              {row.rt_username && !known && <option value={row.rt_username}>{row.rt_username}</option>}
              {(rtUsers || []).map(rt => {
                const owner = taken.get(rt.username.toLowerCase());
                return <option key={rt.username} value={rt.username} disabled={!!owner && owner !== row.name}>{rtLabel(rt)}{owner && owner !== row.name ? ` — ${owner}` : ''}</option>;
              })}
            </select>
            {hint && <div className="text-sm"><button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => link(row, hint.username)}>Use {hint.username} (same email)</button></div>}
          </td>
          <td className="text-sm">{row.rt_username ? `${row.open_tickets} open · ${row.resolved_3m} resolved in 3 months` : <span className="text-muted">—</span>}</td>
          <td className="text-sm">{!row.rt_username ? <span className="text-muted">—</span> : row.sync_error ? <span className="text-danger">{row.sync_error}</span> : row.synced_at || <span className="text-muted">Waiting…</span>}</td>
        </tr>;
      })}</tbody>
    </table></div>
    {!shown.length && <p className="text-muted text-sm">No users match.</p>}
  </>;
}
