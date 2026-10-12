import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, RefreshCw, Pencil, Trash2 } from 'lucide-react';
import { api } from '../api';
import { fmtDate, Modal } from './Shared';
import { useConfirm } from './Confirm';
import { useToast } from './Toast';
import { Surface, ToneBadge } from './EnterpriseUI';
import { useLiveVersion } from '../live';
import './CustomerContracts.css';

/* Customer contracts (Customer 360 → Contracts): reference, dates, the contract
   type for managed customers (24x7, 8x5…) and the customer's assets each one
   covers. Ending soon is the last 30 days. Renewing adds the next period and
   keeps the old one as history. Server: routes/customer-contracts.js. */

const STATUS = {
  active: { tone: 'success', text: 'Active' },
  ending_soon: { tone: 'warning', text: 'Ending soon' },
  expired: { tone: 'danger', text: 'Expired' },
  upcoming: { tone: 'info', text: 'Starts later' },
  renewed: { tone: 'neutral', text: 'Renewed' },
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const addYear = iso => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() + 1); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
const nextDay = iso => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

function timing(contract) {
  if (contract.status === 'expired') return `Ended ${fmtDate(contract.end_date)}`;
  if (contract.status === 'renewed') return `Ended ${fmtDate(contract.end_date)}, renewed`;
  if (contract.status === 'upcoming') return `Starts ${fmtDate(contract.start_date)}`;
  return contract.days_left === 0 ? 'Ends today' : `Ends in ${plural(contract.days_left, 'day', 'days')}`;
}

function ContractForm({ data, contract, renewing, onSaved, onClose }) {
  const toast = useToast();
  // The configured types (Settings → Contract types), plus the contract's own if no longer offered.
  const initialLevel = contract?.service_level || '';
  const presets = initialLevel && !data.service_levels.includes(initialLevel) ? [...data.service_levels, initialLevel] : data.service_levels;
  const [form, setForm] = useState(() => renewing ? {
    reference: contract.reference || '', description: contract.description || '', notes: contract.notes || '',
    start_date: nextDay(contract.end_date), end_date: addYear(nextDay(contract.end_date)),
  } : {
    reference: contract?.reference || '', description: contract?.description || '', notes: contract?.notes || '',
    start_date: contract?.start_date || '', end_date: contract?.end_date || '',
  });
  const [level, setLevel] = useState(initialLevel);
  const [assetIds, setAssetIds] = useState(() => new Set((contract?.assets || []).map(a => a.id)));
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const set = key => event => setForm(current => ({ ...current, [key]: event.target.value }));
  const toggle = id => setAssetIds(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const choosable = (data.assets || []).filter(a => a.lifecycle_status === 'active' || assetIds.has(a.id));

  async function submit(event) {
    event.preventDefault();
    setSaving(true); setError('');
    const body = { ...form, service_level: data.is_managed ? level : (contract?.service_level || null) };
    if (data.can_see_assets) body.asset_ids = [...assetIds];
    try {
      if (renewing) await api.renewCustomerContract(data.customerId, contract.id, body);
      else if (contract) await api.updateCustomerContract(data.customerId, contract.id, body);
      else await api.createCustomerContract(data.customerId, body);
      toast.success(renewing ? 'Contract renewed' : contract ? 'Contract saved' : 'Contract added');
      onSaved();
    } catch (failure) { setError(failure.message); } finally { setSaving(false); }
  }

  return <Modal title={renewing ? `Renew ${contract.reference || 'contract'}` : contract ? 'Edit contract' : 'Add contract'} onClose={onClose} wide
    footer={<><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button type="submit" form="contract-form" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : renewing ? 'Renew contract' : 'Save contract'}</button></>}>
    <form id="contract-form" className="cc-form" onSubmit={submit}>
      {renewing && <p className="cc-hint">The renewal starts a new period with the same details and assets. The current period stays in the history as renewed.</p>}
      {error && <div className="error-msg" role="alert">{error}</div>}
      <div className="form-group"><label htmlFor="cc-reference">Contract reference *</label>
        <input id="cc-reference" value={form.reference} onChange={set('reference')} maxLength={100} required placeholder="e.g. MSP-2026-014" /></div>
      <div className="form-group"><label htmlFor="cc-description">Description</label>
        <input id="cc-description" value={form.description} onChange={set('description')} maxLength={200} placeholder="e.g. Managed firewall service" /></div>
      {data.is_managed && <div className="form-group"><label htmlFor="cc-level">Contract type</label>
        <select id="cc-level" value={level} onChange={e => setLevel(e.target.value)}>
          <option value="">Not set</option>
          {presets.map(p => <option key={p} value={p}>{p}{data.service_levels.includes(p) ? '' : ' (no longer offered)'}</option>)}
        </select>
        {data.can_manage && <small className="text-muted"><Link to="/settings/contract_types">Change the contract types</Link></small>}
      </div>}
      <div className="cc-dates">
        <div className="form-group"><label htmlFor="cc-start">Start date *</label><input id="cc-start" type="date" value={form.start_date} onChange={set('start_date')} required /></div>
        <div className="form-group"><label htmlFor="cc-end">End date *</label><input id="cc-end" type="date" value={form.end_date} min={form.start_date || undefined} onChange={set('end_date')} required /></div>
      </div>
      {data.can_see_assets && <fieldset className="cc-assets">
        <legend>Assets included <span>{assetIds.size} of {choosable.length}</span></legend>
        {!choosable.length ? <p className="text-muted text-sm">This customer has no active assets yet. Add them on the Assets tab.</p>
          : <div className="cc-asset-list">{choosable.map(a => <label key={a.id} className="cc-asset">
            <input type="checkbox" checked={assetIds.has(a.id)} onChange={() => toggle(a.id)} />
            <span>{a.name}<small>{a.asset_type}{a.lifecycle_status !== 'active' ? ` · ${a.lifecycle_status}` : ''}</small></span>
          </label>)}</div>}
        {choosable.length > 1 && <div className="cc-asset-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAssetIds(new Set(choosable.map(a => a.id)))}>Select all</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAssetIds(new Set())}>Clear</button>
        </div>}
      </fieldset>}
      <div className="form-group"><label htmlFor="cc-notes">Notes</label><textarea id="cc-notes" rows={3} value={form.notes} onChange={set('notes')} maxLength={2000} /></div>
    </form>
  </Modal>;
}

function ContractCard({ contract, data, onEdit, onRenew, onDelete }) {
  const status = STATUS[contract.status];
  const canRenew = data.can_manage && ['active', 'ending_soon', 'expired'].includes(contract.status);
  return <article className={`cc-card is-${contract.status}`}>
    <header>
      <div>
        <h3>{contract.reference || <span className="text-muted">No reference</span>}</h3>
        {contract.description && <p>{contract.description}</p>}
      </div>
      <ToneBadge tone={status.tone}>{status.text}</ToneBadge>
    </header>
    <dl>
      <div><dt>Period</dt><dd>{fmtDate(contract.start_date)} – {fmtDate(contract.end_date)}<small>{timing(contract)}</small></dd></div>
      {(data.is_managed || contract.service_level) && <div><dt>Contract type</dt><dd>{contract.service_level || <span className="text-muted">Not set</span>}</dd></div>}
      <div><dt>Assets included</dt><dd>{contract.assets
        ? (contract.assets.length ? <ul className="cc-asset-names">{contract.assets.map(a => <li key={a.id}>{a.name}</li>)}</ul> : <span className="text-muted">None</span>)
        : plural(contract.asset_count, 'asset', 'assets')}</dd></div>
      {contract.notes && <div><dt>Notes</dt><dd className="cc-notes">{contract.notes}</dd></div>}
    </dl>
    {data.can_manage && <footer>
      {canRenew && <button type="button" className="btn btn-primary btn-sm" onClick={() => onRenew(contract)}><RefreshCw size={13} /> Renew</button>}
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEdit(contract)}><Pencil size={13} /> Edit</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDelete(contract)} aria-label={`Delete contract ${contract.reference || ''}`.trim()}><Trash2 size={13} /> Delete</button>
    </footer>}
  </article>;
}

export default function CustomerContracts({ customerId }) {
  const toast = useToast();
  const confirm = useConfirm();
  const live = useLiveVersion();
  const [data, setData] = useState(null), [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // { contract, renewing } | { contract: null }
  const load = useCallback(async () => {
    try { setData({ ...(await api.customerContracts(customerId)), customerId }); setError(''); } catch (failure) { setError(failure.message); }
  }, [customerId]);
  useEffect(() => { load(); }, [load, live]);

  async function remove(contract) {
    const ok = await confirm(`Delete contract ${contract.reference || ''}? Its asset list is deleted with it.`.replace('  ', ' '), { title: 'Delete contract', label: 'Delete' });
    if (!ok) return;
    try { await api.deleteCustomerContract(customerId, contract.id); toast.success('Contract deleted'); load(); } catch (failure) { toast.error(failure.message); }
  }

  if (error) return <div className="error-msg" role="alert">{error}</div>;
  if (!data) return <p className="text-muted">Loading…</p>;
  const current = data.contracts.filter(c => c.status !== 'renewed' && c.status !== 'expired');
  const history = data.contracts.filter(c => c.status === 'renewed' || c.status === 'expired');
  const uncovered = data.uncovered_assets?.length ?? data.uncovered_count ?? 0;
  const card = c => <ContractCard key={c.id} contract={c} data={data} onEdit={contract => setEditing({ contract })} onRenew={contract => setEditing({ contract, renewing: true })} onDelete={remove} />;

  return <div className="cc-page">
    <Surface title="Contracts" label="Contracts" description={data.is_managed ? 'Managed customer: set the contract type (24x7, 8x5…) on each contract.' : undefined}
      actions={data.can_manage && <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing({ contract: null })}><Plus size={14} /> Add contract</button>}>
      {uncovered > 0 && data.contracts.length > 0 && <p className="cc-uncovered" role="status">
        {plural(uncovered, 'active asset is', 'active assets are')} not under a current contract{data.uncovered_assets ? `: ${data.uncovered_assets.slice(0, 5).map(a => a.name).join(', ')}${uncovered > 5 ? '…' : ''}` : ''}.
      </p>}
      {!data.contracts.length ? <p className="text-muted">No contracts recorded yet.{data.can_manage ? ' Add the first one with its reference, dates and the assets it covers.' : ''}</p>
        : !current.length ? <p className="text-muted">No contract is in force. The last ones are under History.</p>
        : <div className="cc-grid">{current.map(card)}</div>}
    </Surface>
    {history.length > 0 && <Surface title="History" label="History" description="Expired and renewed contracts.">
      <div className="cc-grid">{history.map(card)}</div>
    </Surface>}
    {editing && <ContractForm data={data} contract={editing.contract} renewing={!!editing.renewing}
      onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
  </div>;
}
