import { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, Pencil, Trash2 } from 'lucide-react';
import { api } from '../api';
import { fmtDate, Modal } from './Shared';
import { useConfirm } from './Confirm';
import { useToast } from './Toast';
import { Surface, ToneBadge } from './EnterpriseUI';
import { useLiveVersion } from '../live';

/* Licences, subscriptions and certificates (Customer 360 → Contracts): what the
   customer holds from a vendor and when it expires. Reminders go to the managers
   60, 30 and 7 days before; "not renewing" stops them. Renewing is saving a later
   expiry date. Server: routes/customer-licences.js. */

const STATUS = {
  active: { tone: 'success', text: 'Active' },
  expiring: { tone: 'warning', text: 'Expiring' },
  expired: { tone: 'danger', text: 'Expired' },
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const nextYear = iso => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() + 1); return d.toISOString().slice(0, 10); };

function when(licence) {
  if (licence.days_left < 0) return `Expired ${plural(-licence.days_left, 'day', 'days')} ago`;
  if (licence.days_left === 0) return 'Expires today';
  return `In ${plural(licence.days_left, 'day', 'days')}`;
}

function LicenceForm({ data, customerId, licence, renewing, onSaved, onClose }) {
  const toast = useToast();
  const [form, setForm] = useState(() => ({
    kind: licence?.kind || 'licence', name: licence?.name || '', vendor: licence?.vendor || '', reference: licence?.reference || '',
    quantity: licence?.quantity ?? '', asset_id: licence?.asset_id ?? '', notes: licence?.notes || '', not_renewing: !!licence?.not_renewing,
    expires_on: renewing ? nextYear(licence.expires_on) : licence?.expires_on || '',
  }));
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const set = key => event => setForm(current => ({ ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setSaving(true); setError('');
    const body = { ...form, quantity: form.quantity === '' ? null : Number(form.quantity), asset_id: form.asset_id === '' ? null : Number(form.asset_id) };
    try {
      if (licence) await api.updateCustomerLicence(customerId, licence.id, { ...body, version: licence.edit_version });
      else await api.createCustomerLicence(customerId, body);
      toast.success(renewing ? 'Renewed' : licence ? 'Saved' : 'Added');
      onSaved();
    } catch (failure) { setError(failure.message); } finally { setSaving(false); }
  }

  const title = renewing ? `Renew ${licence.name}` : licence ? `Edit ${licence.name}` : 'Add a licence or certificate';
  return <Modal title={title} onClose={onClose} busy={saving}
    footer={<><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button type="submit" form="licence-form" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : renewing ? 'Renew' : 'Save'}</button></>}>
    <form id="licence-form" className="cc-form" onSubmit={submit}>
      {renewing && <p className="cc-hint">Enter the new expiry date. The reminders start again from it.</p>}
      {error && <div className="error-msg" role="alert">{error}</div>}
      {!renewing && <>
        <div className="form-group"><label htmlFor="lic-kind">Type</label>
          <select id="lic-kind" value={form.kind} onChange={set('kind')}>{Object.entries(data.kinds).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></div>
        <div className="form-group"><label htmlFor="lic-name">Name *</label>
          <input id="lic-name" value={form.name} onChange={set('name')} maxLength={200} required placeholder={form.kind === 'certificate' ? 'e.g. vpn.customer.com' : 'e.g. FortiGuard UTP bundle'} /></div>
        <div className="cc-dates">
          <div className="form-group"><label htmlFor="lic-vendor">Vendor or issuer</label><input id="lic-vendor" value={form.vendor} onChange={set('vendor')} maxLength={100} /></div>
          <div className="form-group"><label htmlFor="lic-reference">Reference</label><input id="lic-reference" value={form.reference} onChange={set('reference')} maxLength={200} placeholder="Contract, order or serial number" /></div>
        </div>
      </>}
      <div className="cc-dates">
        <div className="form-group"><label htmlFor="lic-expires">Expires on *</label><input id="lic-expires" type="date" value={form.expires_on} onChange={set('expires_on')} required /></div>
        {!renewing && <div className="form-group"><label htmlFor="lic-quantity">Quantity</label><input id="lic-quantity" type="number" min="1" value={form.quantity} onChange={set('quantity')} /></div>}
      </div>
      {!renewing && <>
        {data.assets.length > 0 && <div className="form-group"><label htmlFor="lic-asset">Device</label>
          <select id="lic-asset" value={form.asset_id} onChange={set('asset_id')}><option value="">Not tied to one device</option>{data.assets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>}
        <div className="form-group"><label htmlFor="lic-notes">Notes</label><textarea id="lic-notes" rows={2} value={form.notes} onChange={set('notes')} maxLength={2000} /></div>
        {licence && <label className="flex gap-8"><input type="checkbox" checked={form.not_renewing} onChange={set('not_renewing')} /> The customer is not renewing it (no more reminders)</label>}
      </>}
    </form>
  </Modal>;
}

export default function CustomerLicences({ customerId }) {
  const toast = useToast();
  const confirm = useConfirm();
  const live = useLiveVersion();
  const [data, setData] = useState(null), [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // { licence, renewing } | { licence: null }
  const load = useCallback(async () => {
    try { const result = await api.customerLicences(customerId); setData({ licences: [], kinds: {}, assets: [], ...(result && !Array.isArray(result) ? result : {}) }); setError(''); } catch (failure) { setError(failure.message); }
  }, [customerId]);
  useEffect(() => { load(); }, [load, live]);

  async function remove(licence) {
    if (!await confirm(`Delete ${licence.name}?`, { title: 'Delete', label: 'Delete' })) return;
    try { await api.deleteCustomerLicence(customerId, licence.id); toast.success('Deleted'); load(); } catch (failure) { toast.error(failure.message); }
  }

  if (error) return <div className="error-msg" role="alert">{error}</div>;
  if (!data || (!data.licences.length && !data.can_edit)) return null;
  const assetName = id => data.assets.find(a => a.id === id)?.name;
  return <Surface title="Licences & certificates" label="Licences and certificates"
    description="Vendor licences, subscriptions and certificates. Managers are reminded 60, 30 and 7 days before each expires."
    actions={data.can_edit && <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing({ licence: null })}><Plus size={14} /> Add</button>}>
    {!data.licences.length ? <p className="text-muted">None recorded yet.{data.can_edit ? ' Add the customer\'s licences, subscriptions and certificates with their expiry dates.' : ''}</p>
      : <div className="table-wrap"><table>
        <caption className="sr-only">Licences, subscriptions and certificates</caption>
        <thead><tr><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Expires</th><th scope="col">Status</th>{data.can_edit && <th scope="col"><span className="sr-only">Actions</span></th>}</tr></thead>
        <tbody>{data.licences.map(l => <tr key={l.id}>
          <td><strong>{l.name}</strong><div className="text-sm text-muted">{[l.vendor, l.reference, l.quantity ? `× ${l.quantity}` : null, assetName(l.asset_id)].filter(Boolean).join(' · ')}</div>
            {l.notes && <div className="text-sm">{l.notes}</div>}</td>
          <td>{data.kinds[l.kind]}</td>
          <td>{fmtDate(l.expires_on)}<div className="text-sm text-muted">{when(l)}</div></td>
          <td>{l.not_renewing ? <ToneBadge tone="neutral">Not renewing</ToneBadge> : <ToneBadge tone={STATUS[l.status].tone}>{STATUS[l.status].text}</ToneBadge>}</td>
          {data.can_edit && <td><div className="flex gap-8">
            {!l.not_renewing && l.status !== 'active' && <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing({ licence: l, renewing: true })} aria-label={`Renew ${l.name}`}><RefreshCw size={13} /> Renew</button>}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing({ licence: l })} aria-label={`Edit ${l.name}`}><Pencil size={13} /> Edit</button>
            {data.can_delete && <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(l)} aria-label={`Delete ${l.name}`}><Trash2 size={13} /></button>}
          </div></td>}
        </tr>)}</tbody>
      </table></div>}
    {editing && <LicenceForm data={data} customerId={customerId} licence={editing.licence} renewing={!!editing.renewing}
      onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
  </Surface>;
}
