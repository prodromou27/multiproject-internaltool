import { useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../../components/Toast';

/* Settings → Contract types: the types managers pick for a managed customer's
   contract (server: routes/settings/contracts.js). Renaming a type renames it
   on its contracts; removing one leaves its contracts as they are. */
const rowsOf = result => result.types.map(type => ({ name: type.name, original: type.name, contracts: type.contracts }));

export function ContractTypesTab() {
  const toast = useToast();
  const [data, setData] = useState(null), [rows, setRows] = useState(null), [adding, setAdding] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    api.contractTypes().then(result => { setData(result); setRows(rowsOf(result)); }).catch(failure => setError(failure.message));
  }, []);
  if (error) return <div className="error-msg" role="alert">{error}</div>;
  if (!rows) return <p className="text-muted">Loading…</p>;
  const changed = JSON.stringify(rows.map(r => r.name)) !== JSON.stringify(data.types.map(t => t.name));
  const rename = (index, name) => setRows(current => current.map((row, i) => i === index ? { ...row, name } : row));
  function add(event) {
    event.preventDefault();
    const name = adding.trim();
    if (!name) return;
    if (rows.some(row => row.name.trim().toLowerCase() === name.toLowerCase())) { toast.error(`"${name}" is already in the list`); return; }
    setRows(current => [...current, { name, original: null, contracts: 0 }]); setAdding('');
  }
  async function save() {
    setBusy(true);
    try {
      const renames = Object.fromEntries(rows.filter(row => row.original && row.name.trim() !== row.original).map(row => [row.original, row.name.trim()]));
      const result = await api.saveContractTypes({ types: rows.map(row => row.name), renames });
      setData(result); setRows(rowsOf(result)); toast.success('Contract types saved');
    } catch (failure) { toast.error(failure.message); } finally { setBusy(false); }
  }
  return <section className="card contract-types">
    <p className="text-muted text-sm">The contract types offered when adding a contract for a managed customer, and in customer imports. Renaming a type renames it on the contracts that use it. Removing a type leaves those contracts as they are.</p>
    {rows.length ? <div className="table-wrap"><table>
      <thead><tr><th scope="col">Contract type</th><th scope="col">Contracts</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
      <tbody>{rows.map((row, index) => <tr key={row.original || `new-${index}`}>
        <td><input aria-label={`Contract type ${index + 1}`} value={row.name} maxLength={30} onChange={event => rename(index, event.target.value)} /></td>
        <td className="text-sm">{row.contracts || <span className="text-muted">None</span>}</td>
        <td><button type="button" className="btn btn-sm btn-ghost btn-icon-danger" aria-label={`Remove ${row.name}`} title="Remove"
          onClick={() => setRows(current => current.filter((_, i) => i !== index))}><Trash2 size={14} /></button></td>
      </tr>)}</tbody>
    </table></div> : <p className="text-muted">No contract types. Add one below.</p>}
    <form className="flex gap-8 mt-12" onSubmit={add}>
      <input aria-label="New contract type" value={adding} maxLength={30} onChange={event => setAdding(event.target.value)} placeholder="e.g. 24x5" />
      <button type="submit" className="btn btn-ghost btn-sm" disabled={!adding.trim()}><Plus size={13} /> Add type</button>
    </form>
    {data.no_longer_offered.length > 0 && <p className="text-muted text-sm mt-12">
      No longer offered, still on contracts: {data.no_longer_offered.map(type => `${type.name} (${type.contracts})`).join(', ')}.</p>}
    <div className="flex gap-8 mt-12">
      <button type="button" className="btn btn-primary btn-sm" disabled={!changed || busy} onClick={save}><Save size={13} /> {busy ? 'Saving…' : 'Save contract types'}</button>
      {changed && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRows(rowsOf(data))}>Undo changes</button>}
    </div>
  </section>;
}
