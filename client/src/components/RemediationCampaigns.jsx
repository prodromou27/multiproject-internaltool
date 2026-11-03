import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Modal, fmtDate } from './Shared';
import { ToneBadge } from './EnterpriseUI';
import { LoadError } from './LoadError';
import { useToast } from './Toast';

/* Remediation campaigns (enhancement E01): a CVE or an outdated product becomes one
   upgrade task per customer (a subtask per device), followed until a device review
   shows each device fixed. Server: remediation.js, routes/remediation-campaigns.js. */

const STATUS = { planned: ['neutral', 'Planned'], upgraded: ['info', 'Upgraded, to review'], verified: ['success', 'Verified'], exception: ['warning', 'Exception'] };

export function CampaignDialog({ source, onClose, onCreated }) {
  const toast = useToast();
  const [preview, setPreview] = useState(null), [error, setError] = useState(null), [engineers, setEngineers] = useState([]);
  const [choice, setChoice] = useState({}), [form, setForm] = useState({ name: '', target_date: '' }), [saving, setSaving] = useState(false);
  useEffect(() => {
    api.campaignPreview(source).then(data => {
      setPreview(data);
      setForm(f => ({ ...f, name: `${data.title} remediation` }));
      // Every device that is free to plan, at every customer, until unticked.
      setChoice(Object.fromEntries(data.customers.map(c => [c.customer_id, { on: c.devices.some(d => !d.in_campaign), owner: '', assets: c.devices.filter(d => !d.in_campaign).map(d => d.asset_id) }])));
    }).catch(setError);
    api.users().then(rows => setEngineers((rows || []).filter(u => u.role === 'engineer' && u.active !== 0))).catch(() => setEngineers([]));
  }, [source]);
  const set = (customerId, changes) => setChoice(c => ({ ...c, [customerId]: { ...c[customerId], ...changes } }));
  const chosen = preview ? preview.customers.filter(c => choice[c.customer_id]?.on && choice[c.customer_id].assets.length) : [];
  const devices = chosen.reduce((n, c) => n + choice[c.customer_id].assets.length, 0);

  async function submit(event) {
    event.preventDefault(); setSaving(true);
    try {
      const result = await api.createCampaign({ ...source, name: form.name, target_date: form.target_date,
        customers: chosen.map(c => ({ customer_id: c.customer_id, asset_ids: choice[c.customer_id].assets, assigned_to: choice[c.customer_id].owner ? Number(choice[c.customer_id].owner) : null })) });
      toast.success(`Campaign started: ${chosen.length} task${chosen.length === 1 ? '' : 's'}`); onCreated(result.id);
    } catch (failure) { toast.error(failure.message); } finally { setSaving(false); }
  }

  return <Modal title="Start a remediation campaign" onClose={onClose} wide busy={saving}>
    {error ? <LoadError what="The affected devices" error={error} /> : !preview ? <p className="text-muted" role="status">Finding affected devices…</p>
      : !preview.customers.length ? <p className="text-muted">No customer devices are affected now.</p>
      : <form onSubmit={submit}>
        <div className="form-row">
          <div className="form-group"><label htmlFor="campaign-name">Campaign</label><input id="campaign-name" required maxLength={200} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
          <div className="form-group"><label htmlFor="campaign-date">Target date *</label><input id="campaign-date" type="date" required value={form.target_date} onChange={e => setForm(f => ({ ...f, target_date: e.target.value }))} /></div>
        </div>
        <p className="text-sm text-muted">One task per customer, with a subtask for each device. A device counts as fixed once someone reviews it after the upgrade.</p>
        {preview.customers.map(c => <fieldset key={c.customer_id} className="card" style={{ padding: 10, marginBottom: 8 }}>
          <legend className="sr-only">{c.customer_name}</legend>
          <div className="flex gap-8" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'inline-flex', gap: 6, fontWeight: 600 }}><input type="checkbox" checked={!!choice[c.customer_id]?.on} onChange={e => set(c.customer_id, { on: e.target.checked })} disabled={!c.devices.some(d => !d.in_campaign)} />{c.customer_name}</label>
            <select aria-label={`Owner for ${c.customer_name}`} value={choice[c.customer_id]?.owner || ''} onChange={e => set(c.customer_id, { owner: e.target.value })} disabled={!choice[c.customer_id]?.on}>
              <option value="">No owner yet</option>{engineers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0 }}>{c.devices.map(d => <li key={d.asset_id} className="text-sm">
            <label style={{ display: 'inline-flex', gap: 6 }}>
              <input type="checkbox" disabled={!!d.in_campaign || !choice[c.customer_id]?.on} checked={(choice[c.customer_id]?.assets || []).includes(d.asset_id)}
                onChange={e => set(c.customer_id, { assets: e.target.checked ? [...choice[c.customer_id].assets, d.asset_id] : choice[c.customer_id].assets.filter(id => id !== d.asset_id) })} />
              {d.asset_name}{d.version ? ` (${d.version})` : ''} <span className="text-muted">· {d.detail}</span>
            </label>
            {d.in_campaign && <span className="text-muted"> · already in “{d.in_campaign.name}”</span>}
            {!d.in_campaign && d.open_task && <span className="text-muted"> · open task: {d.open_task.title}</span>}
          </li>)}</ul>
        </fieldset>)}
        <div className="modal-footer"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving || !devices}>{saving ? 'Starting…' : `Create ${chosen.length} task${chosen.length === 1 ? '' : 's'} for ${devices} device${devices === 1 ? '' : 's'}`}</button></div>
      </form>}
  </Modal>;
}

function CampaignDetail({ id, onClose, onChanged }) {
  const toast = useToast();
  const [data, setData] = useState(null), [error, setError] = useState(null);
  const [excepting, setExcepting] = useState(null), [reason, setReason] = useState('');
  const load = useCallback(() => api.campaign(id).then(setData).catch(setError), [id]);
  useEffect(() => { load(); }, [load]);
  async function exception(item, value) {
    try { await api.setCampaignException(id, item.asset_id, value); setExcepting(null); setReason(''); await load(); onChanged(); }
    catch (failure) { toast.error(failure.message); }
  }
  async function close() {
    try { await api.updateCampaign(id, { status: data.status === 'active' ? 'closed' : 'active' }); await load(); onChanged(); }
    catch (failure) { toast.error(failure.message); }
  }
  return <Modal title={data ? data.name : 'Campaign'} onClose={onClose} wide>
    {error ? <LoadError what="The campaign" error={error} onRetry={load} /> : !data ? <p className="text-muted" role="status">Loading…</p> : <>
      <p className="text-sm">{data.source_type === 'cve' ? data.source_ref : data.source_title} · target {fmtDate(data.target_date)} · {data.counts.verified} verified, {data.counts.upgraded} upgraded, {data.counts.planned} planned, {data.counts.exception} exceptions</p>
      <div className="table-wrap"><table>
        <thead><tr><th scope="col">Customer</th><th scope="col">Device</th><th scope="col">Status</th><th scope="col">Task</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{data.items.map(item => <tr key={item.asset_id}>
          <td>{item.customer_name}</td>
          <td><Link to={`/customers/${item.customer_id}/service-profile?section=assets`}>{item.asset_name}</Link></td>
          <td><ToneBadge tone={STATUS[item.status][0]}>{STATUS[item.status][1]}</ToneBadge>{item.exception_reason && <div className="text-sm text-muted">{item.exception_reason}</div>}{item.needs_review && item.status !== 'verified' && <div className="text-sm text-muted">Review the device to confirm the fix</div>}</td>
          <td className="text-sm">{item.task_title || '—'}{item.owner_name && <div className="text-muted">{item.owner_name}</div>}</td>
          <td style={{ whiteSpace: 'nowrap' }}>{item.status === 'exception'
            ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => exception(item, null)}>Clear exception</button>
            : item.status !== 'verified' && (excepting === item.asset_id
              ? <form className="flex gap-6" onSubmit={e => { e.preventDefault(); exception(item, reason); }}><input aria-label={`Why ${item.asset_name} is an exception`} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} autoFocus /><button className="btn btn-primary btn-sm" disabled={!reason.trim()}>Save</button></form>
              : <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setExcepting(item.asset_id); setReason(''); }}>Exception…</button>)}</td>
        </tr>)}</tbody>
      </table></div>
      <div className="modal-footer"><button type="button" className="btn btn-ghost" onClick={close}>{data.status === 'active' ? 'Close campaign' : 'Reopen campaign'}</button><button type="button" className="btn btn-primary" onClick={onClose}>Done</button></div>
    </>}
  </Modal>;
}

export function Campaigns({ openId, onOpen }) {
  const [rows, setRows] = useState(null), [error, setError] = useState(null);
  const load = useCallback(() => api.campaigns().then(data => setRows(Array.isArray(data?.rows) ? data.rows : [])).catch(setError), []);
  useEffect(() => { load(); }, [load]);
  if (error && !rows) return <LoadError what="Campaigns" error={error} onRetry={load} />;
  if (!rows) return <p className="text-muted" role="status">Loading…</p>;
  return <div>
    {!rows.length ? <p className="text-muted">No campaigns yet. Start one from a CVE that affects customer devices, or from a product under Software versions.</p> :
      <div className="table-wrap"><table>
        <thead><tr><th scope="col">Campaign</th><th scope="col">Source</th><th scope="col">Target</th><th scope="col">Progress</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}>
          <td><button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpen(row.id)}>{row.name}</button>{row.status === 'closed' && <ToneBadge tone="neutral">Closed</ToneBadge>}</td>
          <td>{row.source_type === 'cve' ? row.source_ref : 'Software versions'}</td>
          <td>{fmtDate(row.target_date)}</td>
          <td className="text-sm">{row.counts.verified} verified · {row.counts.upgraded} upgraded · {row.counts.planned} planned{row.counts.exception ? ` · ${row.counts.exception} exceptions` : ''}</td>
        </tr>)}</tbody>
      </table></div>}
    {openId && <CampaignDetail id={openId} onClose={() => onOpen(null)} onChanged={load} />}
  </div>;
}
