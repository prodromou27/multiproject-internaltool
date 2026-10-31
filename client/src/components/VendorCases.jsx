import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, ExternalLink } from 'lucide-react';
import { api } from '../api';
import { fmtDate, Modal } from './Shared';
import { useConfirm } from './Confirm';
import { useToast } from './Toast';
import { Surface, ToneBadge } from './EnterpriseUI';
import { useLiveVersion } from '../live';
import { useAuth } from '../auth';

/* Vendor cases (Customer 360 → Vendor cases): support cases opened with a vendor
   (Check Point TAC, Fortinet TAC…) for this customer. Each update is recorded with
   what happened, the status and the next follow-up; the owner is reminded when a
   follow-up is due or the case has had no update for a week.
   Server: routes/customer-vendor-cases.js. */

export const SEVERITY_TONE = { critical: 'danger', high: 'warning', medium: 'info', low: 'neutral' };
export const STATUS_TONE = { open: 'info', waiting_vendor: 'warning', waiting_us: 'danger', resolved: 'success', closed: 'neutral' };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** What needs doing on a case, in words. */
export function caseAttention(item) {
  if (item.attention === 'follow_up_due') return { tone: 'warning', text: `Follow-up due ${fmtDate(item.next_follow_up)}` };
  if (item.attention === 'quiet') return { tone: 'danger', text: `No update for ${plural(item.quiet_days, 'day', 'days')}` };
  if (item.open && item.next_follow_up) return { tone: 'neutral', text: `Follow up ${fmtDate(item.next_follow_up)}` };
  return null;
}

function CaseForm({ data, customerId, item, onSaved, onClose }) {
  const toast = useToast();
  const { user } = useAuth();
  const [form, setForm] = useState(() => ({
    vendor: item?.vendor || '', case_number: item?.case_number || '', subject: item?.subject || '', severity: item?.severity || 'medium',
    status: item?.status || 'open', owner_id: item?.owner_id ?? user?.id ?? '', rt_ticket: item?.rt_ticket || '', asset_id: item?.asset_id ?? '',
    opened_on: item?.opened_on || new Date().toISOString().slice(0, 10), next_follow_up: item?.next_follow_up || '', note: '',
  }));
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const set = key => event => setForm(current => ({ ...current, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setSaving(true); setError('');
    const body = { ...form, owner_id: form.owner_id === '' ? null : Number(form.owner_id), asset_id: form.asset_id === '' ? null : Number(form.asset_id) };
    try {
      if (item) { delete body.note; await api.updateVendorCase(customerId, item.id, { ...body, version: item.edit_version }); }
      else await api.createVendorCase(customerId, body);
      toast.success(item ? 'Case saved' : 'Case recorded');
      onSaved();
    } catch (failure) { setError(failure.message); } finally { setSaving(false); }
  }

  return <Modal title={item ? `Edit ${item.vendor} case ${item.case_number}` : 'Record a vendor case'} onClose={onClose} busy={saving}
    footer={<><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button type="submit" form="vendor-case-form" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save case'}</button></>}>
    <form id="vendor-case-form" className="cc-form" onSubmit={submit}>
      {error && <div className="error-msg" role="alert">{error}</div>}
      <div className="cc-dates">
        <div className="form-group"><label htmlFor="vc-vendor">Vendor *</label><input id="vc-vendor" list="vc-vendors" value={form.vendor} onChange={set('vendor')} maxLength={60} required />
          <datalist id="vc-vendors">{['Check Point', 'Fortinet', 'Palo Alto Networks', 'Cisco', 'Microsoft', 'VMware'].map(v => <option key={v} value={v} />)}</datalist></div>
        <div className="form-group"><label htmlFor="vc-number">Case number *</label><input id="vc-number" value={form.case_number} onChange={set('case_number')} maxLength={60} required /></div>
      </div>
      <div className="form-group"><label htmlFor="vc-subject">Subject *</label><input id="vc-subject" value={form.subject} onChange={set('subject')} maxLength={300} required /></div>
      <div className="cc-dates">
        <div className="form-group"><label htmlFor="vc-severity">Severity</label>
          <select id="vc-severity" value={form.severity} onChange={set('severity')}>{Object.entries(data.severities).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
        <div className="form-group"><label htmlFor="vc-status">Status</label>
          <select id="vc-status" value={form.status} onChange={set('status')}>{Object.entries(data.statuses).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
      </div>
      <div className="cc-dates">
        <div className="form-group"><label htmlFor="vc-owner">Owner</label>
          <select id="vc-owner" value={form.owner_id} onChange={set('owner_id')}><option value="">No owner</option>{data.owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
        <div className="form-group"><label htmlFor="vc-rt">RT ticket</label><input id="vc-rt" value={form.rt_ticket} onChange={set('rt_ticket')} maxLength={13} inputMode="numeric" placeholder="e.g. 4521" /></div>
      </div>
      <div className="cc-dates">
        <div className="form-group"><label htmlFor="vc-opened">Opened on</label><input id="vc-opened" type="date" value={form.opened_on} onChange={set('opened_on')} required /></div>
        <div className="form-group"><label htmlFor="vc-follow">Next follow-up</label><input id="vc-follow" type="date" value={form.next_follow_up} onChange={set('next_follow_up')} /></div>
      </div>
      {data.assets.length > 0 && <div className="form-group"><label htmlFor="vc-asset">Device</label>
        <select id="vc-asset" value={form.asset_id} onChange={set('asset_id')}><option value="">Not tied to one device</option>{data.assets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>}
      {!item && <div className="form-group"><label htmlFor="vc-note">First note</label><textarea id="vc-note" rows={2} value={form.note} onChange={set('note')} maxLength={4000} placeholder="What was reported to the vendor" /></div>}
    </form>
  </Modal>;
}

function CaseView({ data, customerId, caseId, onEdit, onChanged, onClose }) {
  const [detail, setDetail] = useState(null), [error, setError] = useState('');
  const [note, setNote] = useState(''), [status, setStatus] = useState(''), [followUp, setFollowUp] = useState(''), [saving, setSaving] = useState(false);
  const show = useCallback(result => { setDetail(result); setStatus(result.case.status); setFollowUp(result.case.next_follow_up || ''); }, []);
  useEffect(() => { api.vendorCase(customerId, caseId).then(show).catch(failure => setError(failure.message)); }, [customerId, caseId, show]);

  async function addUpdate(event) {
    event.preventDefault();
    setSaving(true); setError('');
    try { show(await api.addVendorCaseUpdate(customerId, caseId, { note, status, next_follow_up: followUp || null })); setNote(''); onChanged(); }
    catch (failure) { setError(failure.message); } finally { setSaving(false); }
  }

  const item = detail?.case;
  return <Modal title={item ? `${item.vendor} case ${item.case_number}` : 'Vendor case'} onClose={onClose} wide busy={saving} dirty={!!note}
    footer={<>{item && data.can_edit && <button type="button" className="btn btn-ghost" onClick={() => onEdit(item)}><Pencil size={13} /> Edit details</button>}
      <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button></>}>
    {error && <div className="error-msg" role="alert">{error}</div>}
    {!item ? !error && <p className="text-muted" role="status">Loading…</p> : <>
      <p><strong>{item.subject}</strong></p>
      <p className="flex gap-8" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <ToneBadge tone={SEVERITY_TONE[item.severity]}>{data.severities[item.severity]}</ToneBadge>
        <ToneBadge tone={STATUS_TONE[item.status]}>{data.statuses[item.status]}</ToneBadge>
        <span className="text-sm text-muted">Opened {fmtDate(item.opened_on)}{item.closed_on ? `, closed ${fmtDate(item.closed_on)}` : ''} · {item.owner_name || 'No owner'}{item.asset_name ? ` · ${item.asset_name}` : ''}</span>
        {item.rt_ticket && (item.rt_url ? <a className="text-sm" href={item.rt_url} target="_blank" rel="noreferrer">RT #{item.rt_ticket} <ExternalLink size={12} aria-hidden="true" /></a> : <span className="text-sm">RT #{item.rt_ticket}</span>)}
      </p>
      {data.can_edit && <form onSubmit={addUpdate} className="card" style={{ padding: 12, marginBottom: 12 }} aria-label="Add an update">
        <div className="form-group"><label htmlFor="vc-update">What happened</label>
          <textarea id="vc-update" rows={2} value={note} onChange={event => setNote(event.target.value)} maxLength={4000} required placeholder="e.g. TAC asked for cpinfo; uploaded it" /></div>
        <div className="flex gap-8" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
          <div className="form-group" style={{ margin: 0 }}><label htmlFor="vc-update-status">Status</label>
            <select id="vc-update-status" value={status} onChange={event => setStatus(event.target.value)}>{Object.entries(data.statuses).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
          <div className="form-group" style={{ margin: 0 }}><label htmlFor="vc-update-follow">Next follow-up</label>
            <input id="vc-update-follow" type="date" value={followUp} onChange={event => setFollowUp(event.target.value)} disabled={['resolved', 'closed'].includes(status)} /></div>
          <button type="submit" className="btn btn-primary btn-sm" disabled={saving || !note.trim()}>{saving ? 'Saving…' : 'Add update'}</button>
        </div>
      </form>}
      <h3 className="section-title" style={{ fontSize: 14 }}>Updates</h3>
      <ol className="vc-updates" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{detail.updates.map(u => <li key={u.id} style={{ padding: '8px 0', borderTop: '1px solid var(--gray-200)' }}>
        <div className="text-sm text-muted">{fmtDate(u.created_at)} · {u.user_name || 'Someone'}{u.status_to ? ` · ${u.status_from ? `${data.statuses[u.status_from]} → ` : ''}${data.statuses[u.status_to]}` : ''}</div>
        {u.note && <div style={{ whiteSpace: 'pre-wrap' }}>{u.note}</div>}
      </li>)}</ol>
    </>}
  </Modal>;
}

export default function VendorCases({ customerId, openCaseId = null }) {
  const toast = useToast();
  const confirm = useConfirm();
  const live = useLiveVersion();
  const [data, setData] = useState(null), [error, setError] = useState('');
  const [showClosed, setShowClosed] = useState(false);
  const [viewing, setViewing] = useState(openCaseId ? Number(openCaseId) : null);
  const [editing, setEditing] = useState(null); // { item } | { item: null }
  const load = useCallback(async () => {
    try { const result = await api.vendorCases(customerId); setData({ cases: [], statuses: {}, severities: {}, assets: [], owners: [], ...(result && !Array.isArray(result) ? result : {}) }); setError(''); } catch (failure) { setError(failure.message); }
  }, [customerId]);
  useEffect(() => { load(); }, [load, live]);

  async function remove(item) {
    if (!await confirm(`Delete ${item.vendor} case ${item.case_number} and its updates?`, { title: 'Delete case', label: 'Delete' })) return;
    try { await api.deleteVendorCase(customerId, item.id); toast.success('Case deleted'); load(); } catch (failure) { toast.error(failure.message); }
  }

  if (error) return <div className="error-msg" role="alert">{error}</div>;
  if (!data) return <p className="text-muted" role="status">Loading…</p>;
  const open = data.cases.filter(c => c.open), closed = data.cases.filter(c => !c.open);
  const rows = showClosed ? data.cases : open;
  return <Surface title="Vendor cases" label="Vendor cases"
    description="Support cases opened with vendors for this customer. The owner is reminded when a follow-up is due or a case has had no update for a week."
    actions={data.can_edit && <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing({ item: null })}><Plus size={14} /> Record a case</button>}>
    {!data.cases.length ? <p className="text-muted">No vendor cases recorded.</p>
      : !rows.length ? <p className="text-muted">No open cases.</p>
      : <div className="table-wrap"><table>
        <caption className="sr-only">Vendor cases</caption>
        <thead><tr><th scope="col">Case</th><th scope="col">Severity</th><th scope="col">Status</th><th scope="col">Owner</th><th scope="col">Next</th>{data.can_delete && <th scope="col"><span className="sr-only">Actions</span></th>}</tr></thead>
        <tbody>{rows.map(c => { const next = caseAttention(c); return <tr key={c.id}>
          <td><button type="button" className="btn-link" onClick={() => setViewing(c.id)}><strong>{c.vendor} {c.case_number}</strong></button>
            <div className="text-sm">{c.subject}</div>{c.rt_ticket && <div className="text-sm text-muted">RT #{c.rt_ticket}</div>}</td>
          <td><ToneBadge tone={SEVERITY_TONE[c.severity]}>{data.severities[c.severity]}</ToneBadge></td>
          <td><ToneBadge tone={STATUS_TONE[c.status]}>{data.statuses[c.status]}</ToneBadge></td>
          <td>{c.owner_name || <span className="text-muted">No owner</span>}</td>
          <td>{next ? <ToneBadge tone={next.tone}>{next.text}</ToneBadge> : <span className="text-muted">{c.closed_on ? `Closed ${fmtDate(c.closed_on)}` : '—'}</span>}</td>
          {data.can_delete && <td><button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(c)} aria-label={`Delete ${c.vendor} case ${c.case_number}`}><Trash2 size={13} /></button></td>}
        </tr>; })}</tbody>
      </table></div>}
    {closed.length > 0 && <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setShowClosed(v => !v)}>
      {showClosed ? 'Hide resolved and closed' : `Show resolved and closed (${closed.length})`}</button>}
    {viewing && <CaseView data={data} customerId={customerId} caseId={viewing} onChanged={load} onClose={() => setViewing(null)}
      onEdit={item => { setViewing(null); setEditing({ item }); }} />}
    {editing && <CaseForm data={data} customerId={customerId} item={editing.item}
      onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
  </Surface>;
}
