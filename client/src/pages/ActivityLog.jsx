import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ClipboardList, Search, Copy, CheckCircle2, ListPlus, Paperclip, Upload, Trash2, Pencil, Flag, SlidersHorizontal, X } from 'lucide-react';
import '../components/billingMix.css';
import './ActivityForm.css';
import { fmtDuration, MIX, mixOf, groupByDay, LedgerDay } from '../components/activityLedger';
import { PageHeader } from '../components/PageLayout';
import { useSearchParams } from 'react-router-dom';
import { customerIdFromCreateIntent,useCreateIntent } from '../hooks/useCreateIntent';
import { api } from '../api';
import { useAuth } from '../App';
import { StatusBadge, fmtDate, fmtDateTime, Modal } from '../components/Shared';
import { useSavedFilter } from '../hooks/useSavedFilter';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function todayRange() { const t = iso(new Date()); return [t, t]; }
function weekRange() {
  const now = new Date(); const day = (now.getDay() + 6) % 7;
  const start = new Date(now); start.setDate(now.getDate() - day);
  const end = new Date(start); end.setDate(start.getDate() + 6);
  return [iso(start), iso(end)];
}
function monthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return [iso(start), iso(end)];
}

const RANGE_LABEL = { today: 'today', this_week: 'this week', this_month: 'this month', custom: 'in this range' };

const BILLABLE_LABELS = {
  included_in_contract: 'Included in Contract', billable: 'Billable', non_billable: 'Non-Billable',
  internal: 'Internal', not_applicable: 'Not Applicable',
};
const WORK_LOCATION_LABELS = { remote: 'Remote', onsite: 'On-site', internal: 'Internal', hybrid: 'Hybrid' };

/* A labelled control: the label is tied to the input so it reads aloud and focuses it. */
function Field({ label, required, className, children }) {
  const id = useId();
  const [control, ...extra] = React.Children.toArray(children);
  return (
    <div className={'af-field' + (className ? ` ${className}` : '')}>
      <label htmlFor={id}>{label}{required && <span className="af-req" aria-hidden="true"> *</span>}</label>
      {React.cloneElement(control, { id })}
      {extra}
    </div>
  );
}

/* Multi-select as toggle chips: every option is visible, no Ctrl-click needed. */
function ChipGroup({ legend, required, options, selected, onToggle, disabled, scroll, status, statusIsError }) {
  return (
    <fieldset className="af-chipset" disabled={disabled}>
      <legend>{legend}{required && <span className="af-req" aria-hidden="true"> *</span>}</legend>
      <div className={'af-chips' + (scroll ? ' is-scroll' : '')}>
        {options.map(o => (
          <label key={o.id} className={'af-chip' + (selected.includes(o.id) ? ' is-on' : '')}>
            <input type="checkbox" checked={selected.includes(o.id)} onChange={() => onToggle(o.id)} />
            <span>{o.label}</span>
            {o.detail && <small>{o.detail}</small>}
            {o.note && <small className="af-chip-note">{o.note}</small>}
          </label>
        ))}
      </div>
      {status && <span className={statusIsError ? 'error-msg' : 'af-hint'} role={statusIsError ? 'alert' : 'status'}>{status}</span>}
    </fieldset>
  );
}

/* ── Quick Log / Edit Activity form ──────────────────────────────────── */
function ActivityForm({ meta, initial, onSave, onClose, onReload }) {
  const [form, setForm] = useState(() => ({
    customer_id: initial?.customer_id || '',
    activity_date: initial?.activity_date?.slice(0, 10) || iso(new Date()),
    category_id: initial?.category_id || '',
    subcategory_id: initial?.subcategory_id || '',
    title: initial?.title || '',
    duration_minutes: initial?.duration_minutes ?? '',
    status: initial?.status || meta.statuses[0]?.value || 'planned',
    description: initial?.description || '',
    technology_ids: initial?.technologies?.map(t => t.id) || [],
    asset_ids: initial?.assets?.map(asset => asset.id) || [],
    start_time: initial?.start_time || '',
    end_time: initial?.end_time || '',
    work_location: initial?.work_location || '',
    ticket_reference: initial?.ticket_reference || '',
    customer_impact: initial?.customer_impact || '',
    billable_classification: initial?.billable_classification || '',
    follow_up_required: !!initial?.follow_up_required,
    follow_up_date: initial?.follow_up_date?.slice(0, 10) || '',
    change_type: initial?.change_type || '',
    change_reason: initial?.change_reason || '',
    previous_state: initial?.previous_state || '',
    new_state: initial?.new_state || '',
    change_risk: initial?.change_risk || '',
    rollback_available: !!initial?.rollback_available,
    customer_approval_reference: initial?.customer_approval_reference || '',
    verification_notes: initial?.verification_notes || '',
  }));
  const [showMore, setShowMore] = useState(false);
  const [showChangeDetails, setShowChangeDetails] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [err, setErr] = useState('');
  const [assets,setAssets] = useState(initial?.assets || []);
  const [assetsLoading,setAssetsLoading] = useState(false);
  const [assetsError,setAssetsError] = useState('');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    if (!form.customer_id) { setAssets([]);setAssetsError('');return; }
    const controller=new AbortController();setAssetsLoading(true);setAssetsError('');
    api.serviceActivityAssets(form.customer_id,{ signal:controller.signal }).then(rows => {
      if (controller.signal.aborted) return;
      const merged=new Map([...(initial?.assets || []),...rows].map(row => [row.id,row]));setAssets([...merged.values()]);
    }).catch(error => { if (!controller.signal.aborted) setAssetsError(error.message || 'Could not load customer assets'); })
      .finally(() => { if (!controller.signal.aborted) setAssetsLoading(false); });
    return () => controller.abort();
  },[form.customer_id,initial?.assets]);

  const category = meta.categories.find(c => String(c.id) === String(form.category_id));
  const customer = meta.customers.find(c => String(c.id) === String(form.customer_id));
  const requiredDetails = !!(customer?.require_ticket_reference || customer?.require_technology || customer?.require_billable_classification);
  const subcategories = category?.subcategories || [];
  const isChangeCategory = /change/i.test(category?.name || '');

  function validate() {
    if (!form.customer_id) return 'Customer is required';
    if (!form.activity_date) return 'Activity date is required';
    if (!form.category_id) return 'Category is required';
    if (!form.title.trim()) return 'Title is required';
    if (form.duration_minutes !== '' && Number(form.duration_minutes) <= 0) return 'Duration must be greater than zero';
    if (form.start_time && form.end_time && form.end_time < form.start_time) return 'End time cannot be before start time';
    if (form.follow_up_required && !form.follow_up_date) return 'Follow-up date is required when follow-up is required';
    if (customer?.require_duration && form.duration_minutes === '') return 'Duration is required for this customer';
    if (customer?.require_ticket_reference && !form.ticket_reference.trim()) return 'Ticket reference is required for this customer';
    if (customer?.require_technology && !form.technology_ids.length) return 'At least one technology is required for this customer';
    if (customer?.require_notes && !form.description.trim()) return 'Notes are required for this customer';
    if (customer?.require_billable_classification && !form.billable_classification) return 'Billable classification is required for this customer';
    return '';
  }

  async function submit(e) {
    e.preventDefault();
    const validationError = validate();
    if (validationError) { setErr(validationError); return; }
    setErr(''); setSaving(true);
    try {
      const payload = {
        ...form,
        customer_id: Number(form.customer_id),
        category_id: Number(form.category_id),
        subcategory_id: form.subcategory_id ? Number(form.subcategory_id) : null,
        duration_minutes: form.duration_minutes !== '' ? Number(form.duration_minutes) : null,
      };
      await onSave(payload);
    } catch (ex) { setConflict(ex.code === 'ACTIVITY_CONFLICT'); setErr(ex.message || 'Failed to save activity'); }
    finally { setSaving(false); }
  }

  const toggleIn = (key, value) => setForm(f => ({
    ...f, [key]: f[key].includes(value) ? f[key].filter(x => x !== value) : [...f[key], value],
  }));
  const today = iso(new Date());
  const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return iso(d); })();
  const minutes = form.duration_minutes === '' ? null : Number(form.duration_minutes);

  return (
    <form onSubmit={submit} className="af-form" noValidate={false}>
      {err && <div className="error-msg" role="alert">{err}</div>}
      {conflict && <button type="button" className="btn btn-ghost" onClick={onReload}>Reload latest activity</button>}

      <div className="af-grid">
        <Field label="Customer" required className="af-wide">
          <select value={form.customer_id} required
            onChange={e => setForm(f => ({ ...f, customer_id: e.target.value, asset_ids: String(e.target.value) === String(initial?.customer_id || '') ? initial?.assets?.map(asset => asset.id) || [] : [] }))}>
            <option value="">Select a customer</option>
            {meta.customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>

        <Field label="Title" required className="af-wide">
          <input value={form.title} onChange={set('title')} maxLength={300} required placeholder="What did you do?" />
        </Field>

        <Field label="Category" required>
          <select value={form.category_id} required onChange={e => setForm(f => ({ ...f, category_id: e.target.value, subcategory_id: '' }))}>
            <option value="">Select a category</option>
            {meta.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>

        <Field label="Status">
          <select value={form.status} onChange={set('status')}>
            {meta.statuses.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>

        <Field label="Date" required>
          <input type="date" value={form.activity_date} onChange={set('activity_date')} max={today} required />
          <span className="af-quick">
            {[['Today', today], ['Yesterday', yesterday]].map(([label, value]) => (
              <button key={label} type="button" aria-pressed={form.activity_date === value} onClick={() => setForm(f => ({ ...f, activity_date: value }))}>{label}</button>
            ))}
          </span>
        </Field>

        <Field label="Time spent (minutes)" required={!!customer?.require_duration}>
          <input type="number" min="1" max="1440" step="1" required={!!customer?.require_duration}
            value={form.duration_minutes} onChange={set('duration_minutes')} placeholder="For example, 90" />
          <span className="af-quick">
            {[[30, '30m'], [60, '1h'], [90, '1h 30m'], [120, '2h']].map(([value, label]) => (
              <button key={value} type="button" aria-pressed={minutes === value} onClick={() => setForm(f => ({ ...f, duration_minutes: value }))}>{label}</button>
            ))}
          </span>
        </Field>

        <Field label="Notes" required={!!customer?.require_notes} className="af-wide">
          <textarea required={!!customer?.require_notes} maxLength={10000} value={form.description} onChange={set('description')} rows={3}
            placeholder="Actions taken and the outcome" />
        </Field>
      </div>

      <details className="af-more" open={showMore || requiredDetails} onToggle={e => setShowMore(e.target.open)}>
        <summary>More details</summary>

        <fieldset className="af-group">
          <legend>Classification</legend>
          {subcategories.length > 0 && (
            <Field label="Subcategory">
              <select value={form.subcategory_id} onChange={set('subcategory_id')}>
                <option value="">None</option>
                {subcategories.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Billing" required={!!customer?.require_billable_classification}>
            <select required={!!customer?.require_billable_classification} value={form.billable_classification} onChange={set('billable_classification')}>
              <option value="">Not specified</option>
              {Object.entries(BILLABLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <ChipGroup legend="Technology" required={!!customer?.require_technology}
            options={meta.technologies.map(t => ({ id: t.id, label: t.name }))}
            selected={form.technology_ids} onToggle={id => toggleIn('technology_ids', id)} />
        </fieldset>

        <fieldset className="af-group">
          <legend>Where and when</legend>
          <div className="af-grid">
            <Field label="Start time"><input type="time" value={form.start_time} onChange={set('start_time')} /></Field>
            <Field label="End time"><input type="time" value={form.end_time} onChange={set('end_time')} /></Field>
            <Field label="Work location">
              <select value={form.work_location} onChange={set('work_location')}>
                <option value="">Not specified</option>
                {Object.entries(WORK_LOCATION_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
          </div>
        </fieldset>

        <fieldset className="af-group">
          <legend>References</legend>
          <div className="af-grid">
            <Field label="Ticket reference" required={!!customer?.require_ticket_reference}>
              <input value={form.ticket_reference} onChange={set('ticket_reference')} />
            </Field>
            <Field label="Customer impact"><input value={form.customer_impact} onChange={set('customer_impact')} /></Field>
          </div>
          {form.customer_id && (
            <ChipGroup legend="Customer assets" scroll
              options={assets.map(asset => ({
                id: asset.id,
                label: asset.name,
                detail: asset.hostname || asset.asset_type,
                note: asset.lifecycle_status === 'retired' || asset.lifecycle_status === 'decommissioned' ? asset.lifecycle_status : '',
              }))}
              selected={form.asset_ids} onToggle={id => toggleIn('asset_ids', id)}
              disabled={assetsLoading || !!assetsError}
              status={assetsLoading ? 'Loading assets…' : assetsError || (!assets.length ? 'No active assets recorded for this customer.' : '')}
              statusIsError={!!assetsError} />
          )}
        </fieldset>

        <fieldset className="af-group">
          <legend>Follow-up</legend>
          <label className="af-check">
            <input type="checkbox" checked={form.follow_up_required}
              onChange={e => setForm(f => ({ ...f, follow_up_required: e.target.checked }))} />
            This needs a follow-up
          </label>
          {form.follow_up_required && (
            <Field label="Follow up by" required>
              <input type="date" value={form.follow_up_date} onChange={set('follow_up_date')} required />
            </Field>
          )}
        </fieldset>
      </details>

      {isChangeCategory && (
        <details className="af-more" open={showChangeDetails} onToggle={e => setShowChangeDetails(e.target.open)}>
          <summary>Change details</summary>
          <div className="af-grid">
            <Field label="Change type"><input value={form.change_type} onChange={set('change_type')} placeholder="For example, firewall rule update" /></Field>
            <Field label="Risk">
              <select value={form.change_risk} onChange={set('change_risk')}>
                <option value="">Not specified</option>
                <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
              </select>
            </Field>
            <Field label="Reason" className="af-wide"><textarea value={form.change_reason} onChange={set('change_reason')} rows={2} /></Field>
            <Field label="Previous state"><textarea value={form.previous_state} onChange={set('previous_state')} rows={2} /></Field>
            <Field label="New state"><textarea value={form.new_state} onChange={set('new_state')} rows={2} /></Field>
            <Field label="Customer approval reference"><input value={form.customer_approval_reference} onChange={set('customer_approval_reference')} /></Field>
            <Field label="Verification notes"><textarea value={form.verification_notes} onChange={set('verification_notes')} rows={2} /></Field>
          </div>
          <label className="af-check">
            <input type="checkbox" checked={form.rollback_available}
              onChange={e => setForm(f => ({ ...f, rollback_available: e.target.checked }))} />
            A rollback is available
          </label>
        </details>
      )}

      {category?.require_attachment && (
        <p className="af-note">This category needs at least one attachment before the activity can be marked completed. You can add it after saving.</p>
      )}

      <div className="af-footer">
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : initial ? 'Save changes' : 'Log activity'}</button>
      </div>
    </form>
  );
}

/* ── Activity Detail Modal (view + attachments) ──────────────────────── */
function ActivityDetailModal({ id, allowAttachments, onClose, onChanged }) {
  const toast = useToast();
  const [activity, setActivity] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const detailRequest = useRef(null);

  const load = useCallback(() => {
    detailRequest.current?.abort();
    const controller = new AbortController();
    detailRequest.current = controller;
    setLoadError('');
    return Promise.all([api.serviceActivity(id, { signal: controller.signal }), api.serviceActivityAttachments(id, { signal: controller.signal })])
      .then(([a, atts]) => { if (!controller.signal.aborted) { setActivity(a); setAttachments(atts); } })
      .catch(error => { if (!controller.signal.aborted) setLoadError(error.message || 'Could not load the activity'); });
  }, [id]);
  useEffect(() => { setActivity(null); load(); return () => detailRequest.current?.abort(); }, [load]);

  async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try { await api.uploadServiceActivityAttachment(id, file); toast.success('Attachment uploaded'); load(); }
    catch (ex) { toast.error(ex.message); }
    finally { setUploading(false); e.target.value = ''; }
  }

  async function handleDownload(att) {
    try {
      const { token } = await api.downloadToken();
      window.location.href = api.downloadServiceActivityAttachmentUrl(id, att.id, token);
    } catch (ex) { toast.error(ex.message); }
  }

  async function handleDeleteAttachment(attId) {
    try { await api.deleteServiceActivityAttachment(id, attId); toast.success('Attachment removed'); load(); }
    catch (ex) { toast.error(ex.message); }
  }

  if (!activity) return <Modal title="Activity" onClose={onClose}>{loadError
    ? <div className="error-msg" role="alert">{loadError}<button className="btn btn-ghost btn-sm" onClick={load}>Retry</button></div>
    : <p className="text-muted">Loading…</p>}</Modal>;

  const mix = mixOf(activity.billable_classification);
  const fact = (label, value) => (
    <div className="ad-fact"><dt>{label}</dt><dd>{value || <span className="ad-none">Not set</span>}</dd></div>
  );

  return (
    <Modal title={activity.activity_reference} onClose={onClose} wide>
      {loadError && <div className="error-msg" role="alert">{loadError}<button className="btn btn-ghost btn-sm" onClick={load}>Retry</button></div>}
      <div className="ad">
        <div className="ad-head">
          <h3>{activity.title}</h3>
          <StatusBadge entityType="service_activity" s={activity.status} />
        </div>

        {activity.follow_up_required ? (
          <p className="ad-followup"><Flag size={14} aria-hidden="true" />
            {`Follow up by ${fmtDate(activity.follow_up_date)}${activity.follow_up_task_title ? `, task: ${activity.follow_up_task_title}` : ''}`}</p>
        ) : null}

        <dl className="ad-facts">
          {fact('Customer', activity.customer_name)}
          {fact('Engineer', activity.engineer_name)}
          {fact('Date', fmtDate(activity.activity_date))}
          {fact('Time spent', activity.duration_minutes ? fmtDuration(activity.duration_minutes) : '')}
          {fact('Category', activity.category_name ? `${activity.category_name}${activity.subcategory_name ? `, ${activity.subcategory_name}` : ''}` : '')}
          {fact('Billing', activity.billable_classification
            ? <span className="ad-mix"><span className="al-swatch" style={{ background: mix.color }} aria-hidden="true" />{mix.label}</span> : '')}
          {fact('Work location', WORK_LOCATION_LABELS[activity.work_location])}
          {fact('Ticket', activity.ticket_reference)}
        </dl>

        {activity.description && <section className="ad-block"><h4>Notes</h4><p>{activity.description}</p></section>}

        {(activity.technologies?.length > 0 || activity.assets?.length > 0) && (
          <section className="ad-block">
            {activity.technologies?.length > 0 && (
              <><h4>Technology</h4><ul className="ad-chips">{activity.technologies.map(t => <li key={t.id}>{t.name}</li>)}</ul></>
            )}
            {activity.assets?.length > 0 && (
              <><h4>Customer assets</h4><ul className="ad-chips">{activity.assets.map(asset => <li key={asset.id}>{asset.name}{asset.hostname ? `, ${asset.hostname}` : ''}</li>)}</ul></>
            )}
          </section>
        )}

        {(activity.related_project_title || activity.related_task_title || activity.related_visit_title) && (
          <section className="ad-block">
            <h4>Related work</h4>
            <ul className="ad-list">
              {activity.related_project_title && <li>Project: {activity.related_project_title}</li>}
              {activity.related_task_title && <li>Task: {activity.related_task_title}</li>}
              {activity.related_visit_title && <li>Maintenance visit: {activity.related_visit_title}</li>}
            </ul>
          </section>
        )}

        {(activity.change_type || activity.change_reason || activity.previous_state || activity.new_state) && (
          <section className="ad-block">
            <h4>Change details</h4>
            <dl className="ad-facts">
              {fact('Type', activity.change_type)}
              {fact('Risk', activity.change_risk && activity.change_risk[0].toUpperCase() + activity.change_risk.slice(1))}
              {fact('Reason', activity.change_reason)}
              {fact('Previous state', activity.previous_state)}
              {fact('New state', activity.new_state)}
              {fact('Rollback available', activity.rollback_available ? 'Yes' : 'No')}
              {activity.customer_approval_reference && fact('Customer approval', activity.customer_approval_reference)}
            </dl>
          </section>
        )}

        <section className="ad-block">
          <div className="ad-attach-head">
            <h4><Paperclip size={13} aria-hidden="true" /> Attachments</h4>
            {allowAttachments !== false && (
              <label className="btn btn-ghost btn-sm ad-upload">
                <Upload size={13} aria-hidden="true" /> {uploading ? 'Uploading…' : 'Upload a file'}
                <input type="file" hidden onChange={handleUpload} disabled={uploading} />
              </label>
            )}
          </div>
          {attachments.length === 0
            ? <p className="ad-none">No attachments yet.</p>
            : (
              <ul className="ad-files">
                {attachments.map(a => (
                  <li key={a.id}>
                    <button type="button" className="ad-file" onClick={() => handleDownload(a)}>{a.original_name}</button>
                    <button type="button" className="ad-remove" aria-label={`Remove ${a.original_name}`} title="Remove" onClick={() => handleDeleteAttachment(a.id)}><Trash2 size={14} aria-hidden="true" /></button>
                  </li>
                ))}
              </ul>
            )}
        </section>

        <p className="ad-stamp">
          Logged {fmtDateTime(activity.created_at)}{activity.completed_at ? `, completed ${fmtDateTime(activity.completed_at)}` : ''}
        </p>
      </div>
      <div className="af-footer">
        <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

/* ── Main page ────────────────────────────────────────────────────────── */
export default function ActivityLog() {
  const { user, saAccess } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const isManager = user.role === 'manager';

  const [meta, setMeta] = useState(null);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const listRequest = useRef(null);
  const exportFilters = useRef({});
  const [exporting, setExporting] = useState(false);
  const [metaError, setMetaError] = useState('');

  const [datePreset, setDatePreset] = useSavedFilter('activity_log_date_preset', 'this_week');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [technologyFilter, setTechnologyFilter] = useState('');
  const [billableFilter, setBillableFilter] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [createInitial,setCreateInitial]=useState(null);
  const [editActivity, setEditActivity] = useState(null);
  const [editLoadingId, setEditLoadingId] = useState(null);
  const editRequest = useRef(null);
  const [viewId, setViewId] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const activity = searchParams.get('activity');
    if (!meta || activity === null) return;
    if (/^[1-9]\d*$/.test(activity) && Number.isSafeInteger(Number(activity))) setViewId(Number(activity));
    const next = new URLSearchParams(searchParams);
    next.delete('activity');
    setSearchParams(next, { replace: true });
  }, [meta, searchParams, setSearchParams]);

  useCreateIntent({ allowed: isManager || (saAccess.enabled && ['engineer', 'pm'].includes(user.role)), ready: !!meta, onCreate: params => { const customerId=customerIdFromCreateIntent(params);setCreateInitial(customerId?{ customer_id:customerId }:null);setShowForm(true); } });

  useEffect(() => () => editRequest.current?.abort(), []);

  async function handleEdit(row) {
    editRequest.current?.abort();
    const controller = new AbortController();
    editRequest.current = controller;
    setEditLoadingId(row.id);
    try {
      const detail = await api.serviceActivity(row.id, { signal: controller.signal });
      if (!controller.signal.aborted) setEditActivity(detail);
    } catch (error) {
      if (!controller.signal.aborted) toast.error(error.message || 'Could not load the activity for editing');
    } finally {
      if (!controller.signal.aborted) setEditLoadingId(null);
    }
  }

  useEffect(() => {
    api.serviceActivityMeta().then(setMeta).catch(e => setMetaError(e.message || 'Failed to load form data'));
  }, []);

  function dateRange() {
    if (datePreset === 'today') return todayRange();
    if (datePreset === 'this_week') return weekRange();
    if (datePreset === 'this_month') return monthRange();
    if (datePreset === 'custom') return [customFrom, customTo];
    return [null, null];
  }

  const load = useCallback(() => {
    listRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    setLoading(true);
    setLoadError('');
    const [from, to] = datePreset === 'today' ? todayRange()
      : datePreset === 'this_week' ? weekRange()
      : datePreset === 'this_month' ? monthRange()
      : datePreset === 'custom' ? [customFrom, customTo] : [null, null];
    const params = { page, page_size: pageSize };
    if (from) params.from = from;
    if (to) params.to = to;
    if (customerFilter) params.customer_id = customerFilter;
    if (categoryFilter) params.category_id = categoryFilter;
    if (statusFilter) params.status = statusFilter;
    if (technologyFilter) params.technology_id = technologyFilter;
    if (billableFilter) params.billable_classification = billableFilter;
    if (debouncedSearch) params.search = debouncedSearch;
    exportFilters.current = { ...params };
    delete exportFilters.current.page;
    delete exportFilters.current.page_size;
    return api.serviceActivities(params, { signal: controller.signal }).then(d => {
      if (controller.signal.aborted) return;
      const lastPage = Math.max(1, Math.ceil(d.total / pageSize));
      if (page > lastPage) { setPage(lastPage); return; }
      setRows(d.rows);
      setTotal(d.total);
    }).catch(e => {
      if (!controller.signal.aborted) setLoadError(e.message || 'Failed to load activities');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
  }, [page, datePreset, customFrom, customTo, customerFilter, categoryFilter, statusFilter, technologyFilter, billableFilter, debouncedSearch]);

  useEffect(() => {
    load();
    return () => listRequest.current?.abort();
  }, [load]);
  useEffect(() => {
    const timer = setTimeout(() => { setPage(1); setDebouncedSearch(search.trim()); }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  async function handleCreate(payload) {
    await api.createServiceActivity(payload);
    setShowForm(false);
    toast.success('Activity logged');
    load();
  }

  async function handleUpdate(payload) {
    await api.updateServiceActivity(editActivity.id, { ...payload, version: editActivity.version });
    setEditActivity(null);
    toast.success('Activity updated');
    load();
  }

  async function handleComplete(row) {
    try { await api.completeServiceActivity(row.id); toast.success('Marked as completed'); load(); }
    catch (e) { toast.error(e.message); }
  }

  async function handleDuplicate(row) {
    try {
      const { activity_reference } = await api.duplicateServiceActivity(row.id);
      toast.success(`Duplicated as ${activity_reference}`);
      load();
    } catch (e) { toast.error(e.message); }
  }

  async function handleFollowUp(row) {
    const ok = await confirm(`Create a follow-up task for "${row.title}"?`, { title: 'Create Follow-Up Task' });
    if (!ok) return;
    try { const result = await api.createFollowUpTask(row.id); toast.success(result.created ? 'Follow-up task created' : 'Follow-up task already exists'); load(); }
    catch (e) { toast.error(e.message); }
  }

  if (saAccess.loaded && !saAccess.enabled && !isManager) {
    return (
      <div className="page">
        <div className="empty">
          <div className="empty-icon"><ClipboardList size={40} strokeWidth={1.2} /></div>
          <p style={{ fontWeight: 600 }}>Service Activity Tracking is not enabled for your team</p>
          <p style={{ fontSize: 13 }}>Ask your manager to enable it for your team if you need access to the Activity Log.</p>
        </div>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const filterDefs = meta ? [
    { key: 'customer', label: 'Customer', value: customerFilter, set: setCustomerFilter, options: meta.customers.map(c => [c.id, c.name]) },
    { key: 'category', label: 'Category', value: categoryFilter, set: setCategoryFilter, options: meta.categories.map(c => [c.id, c.name]) },
    { key: 'status', label: 'Status', value: statusFilter, set: setStatusFilter, options: meta.statuses.map(s => [s.value, s.label]) },
    { key: 'technology', label: 'Technology', value: technologyFilter, set: setTechnologyFilter, options: meta.technologies.map(t => [t.id, t.name]) },
    { key: 'billing', label: 'Billing', value: billableFilter, set: setBillableFilter, options: Object.entries(BILLABLE_LABELS) },
  ] : [];
  const activeFilters = filterDefs.filter(f => f.value !== '');
  const hasNarrowing = activeFilters.length > 0 || debouncedSearch !== '';
  const groups = groupByDay(rows, page, totalPages);
  const showLegend = rows.some(row => row.duration_minutes > 0);

  function clearFilters() {
    filterDefs.forEach(f => f.set(''));
    setSearch('');
    setDebouncedSearch('');
    setPage(1);
  }

  const completedValue = meta?.statuses?.find(s => s.is_terminal && /complet/i.test(s.value))?.value || 'completed';
  const canFollowUp = ['manager', 'engineer'].includes(user.role) && meta?.settings?.allow_follow_up_task_creation !== false;

  return (
    <div className="page activity-log">
      <PageHeader eyebrow="Operations" title="Activity log" description="Record customer service work, supporting evidence and operational follow-ups." actions={<>
        <button className="btn btn-ghost" disabled={loading || !!loadError || exporting || !meta} onClick={async () => {
          setExporting(true);
          try { await api.exportServiceActivities(exportFilters.current); }
          catch (error) { toast.error(error.message); }
          finally { setExporting(false); }
        }}>{exporting ? 'Exporting…' : 'Export Excel'}</button>
        <button className="btn btn-primary" onClick={() => setShowForm(true)} disabled={!meta}>Log activity</button>
      </>} />

      {metaError && <div className="error-msg" style={{ marginBottom: 12 }}>{metaError}</div>}

      <div className="al-toolbar">
        <div className="al-segment" role="group" aria-label="Date range">
          {[['today', 'Today'], ['this_week', 'This week'], ['this_month', 'This month'], ['custom', 'Custom']].map(([k, l]) => (
            <button key={k} type="button" aria-pressed={datePreset === k} onClick={() => { setDatePreset(k); setPage(1); }}>{l}</button>
          ))}
        </div>
        <div className="al-search">
          <Search size={15} aria-hidden="true" />
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search activities" placeholder="Search title, notes, reference or ticket" />
        </div>
        {meta && (
          <details className="al-filters">
            <summary>
              <SlidersHorizontal size={15} aria-hidden="true" /> Filters
              {activeFilters.length > 0 && <span className="al-filter-count" aria-label={`${activeFilters.length} active`}>{activeFilters.length}</span>}
            </summary>
            <div className="al-filter-panel">
              {filterDefs.map(f => (
                <div key={f.key}>
                  <label htmlFor={`al-filter-${f.key}`}>{f.label}</label>
                  <select id={`al-filter-${f.key}`} value={f.value} onChange={e => { f.set(e.target.value); setPage(1); }}>
                    <option value="">All</option>
                    {f.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {datePreset === 'custom' && (
        <div className="form-row" style={{ marginBottom: 12, maxWidth: 520 }}>
          <div className="form-group"><label htmlFor="al-from">From</label><input id="al-from" type="date" value={customFrom} onChange={e => { setCustomFrom(e.target.value); setPage(1); }} /></div>
          <div className="form-group"><label htmlFor="al-to">To</label><input id="al-to" type="date" value={customTo} onChange={e => { setCustomTo(e.target.value); setPage(1); }} /></div>
        </div>
      )}

      {hasNarrowing && (
        <div className="al-chips">
          {activeFilters.map(f => (
            <span className="al-chip" key={f.key}>
              {f.label}: {f.options.find(([value]) => String(value) === String(f.value))?.[1] ?? f.value}
              <button type="button" aria-label={`Remove ${f.label} filter`} onClick={() => { f.set(''); setPage(1); }}><X size={12} aria-hidden="true" /></button>
            </span>
          ))}
          {debouncedSearch && (
            <span className="al-chip">
              Search: {debouncedSearch}
              <button type="button" aria-label="Clear search" onClick={() => { setSearch(''); setDebouncedSearch(''); setPage(1); }}><X size={12} aria-hidden="true" /></button>
            </span>
          )}
          <button type="button" className="al-clear" onClick={clearFilters}>Clear all</button>
        </div>
      )}

      {loading ? <div className="skeleton-table" aria-label="Loading activities"><span /><span /><span /><span /></div> : loadError ? (
        <div className="error-msg" role="alert">
          <p>{loadError}</p>
          <button className="btn btn-ghost btn-sm" onClick={load}>Retry</button>
        </div>
      ) : rows.length === 0 ? (
        <div className="card al-empty">
          <h2>{hasNarrowing ? 'No activities match these filters' : `Nothing logged ${RANGE_LABEL[datePreset] || 'in this range'} yet`}</h2>
          <p>{hasNarrowing
            ? 'Try removing a filter or widening the date range.'
            : 'Log the work you have done for a customer and it will show up here, grouped by day.'}</p>
          {hasNarrowing
            ? <button className="btn btn-ghost" onClick={clearFilters}>Clear filters</button>
            : <button className="btn btn-primary" onClick={() => setShowForm(true)} disabled={!meta}>Log activity</button>}
        </div>
      ) : (
        <>
          {showLegend && (
            <ul className="al-legend" aria-label="Billing colours">
              {[['included_in_contract'], ['billable'], ['internal'], ['non_billable']].map(([key]) => (
                <li key={key}><span className="al-swatch" style={{ background: MIX[key].color }} aria-hidden="true" />{MIX[key].label}</li>
              ))}
            </ul>
          )}
          <div className="card al-ledger">
            {groups.map(group => (
              <LedgerDay key={group.date} group={group}>
                {group.rows.map(r => {
                        const mix = mixOf(r.billable_classification);
                        return (
                          <li className="al-entry" key={r.id}>
                            <span className={'al-duration' + (r.duration_minutes ? '' : ' is-unset')}>{r.duration_minutes ? fmtDuration(r.duration_minutes) : 'No time'}</span>
                            <div className="al-main">
                              <button type="button" className="al-title" onClick={() => setViewId(r.id)}>{r.title}</button>
                              <div className="al-meta">
                                <span className="al-customer">{r.customer_name}</span>
                                <span>{r.category_name}</span>
                                {r.billable_classification && (
                                  <span className="al-mix"><span className="al-swatch" style={{ background: mix.color }} aria-hidden="true" />{mix.label}</span>
                                )}
                                <span className="al-ref">{r.activity_reference}</span>
                                {r.follow_up_required ? (
                                  <span className="al-followup"><Flag size={12} aria-hidden="true" />Follow-up{r.follow_up_date ? ` ${fmtDate(r.follow_up_date)}` : ''}</span>
                                ) : null}
                              </div>
                            </div>
                            <div className="al-side">
                              <StatusBadge entityType="service_activity" s={r.status} />
                              <div className="al-actions">
                                <button type="button" aria-label={`Edit ${r.title}`} title="Edit" disabled={!meta || editLoadingId === r.id} onClick={() => handleEdit(r)}><Pencil size={15} aria-hidden="true" /></button>
                                <button type="button" aria-label={`Duplicate ${r.title}`} title="Duplicate" onClick={() => handleDuplicate(r)}><Copy size={15} aria-hidden="true" /></button>
                                {r.status !== completedValue
                                  ? <button type="button" aria-label={`Mark ${r.title} complete`} title="Mark complete" onClick={() => handleComplete(r)}><CheckCircle2 size={15} aria-hidden="true" /></button>
                                  : <span className="al-action-gap" aria-hidden="true" />}
                                {canFollowUp && (
                                  <button type="button" aria-label={`Create follow-up task for ${r.title}`} title="Create follow-up task" onClick={() => handleFollowUp(r)}><ListPlus size={15} aria-hidden="true" /></button>
                                )}
                              </div>
                            </div>
                          </li>
                        );
                      })}
              </LedgerDay>
            ))}
            <div className="al-pager">
              <span>{total} {total === 1 ? 'activity' : 'activities'}</span>
              <div className="al-pager-nav">
                <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
                <span>Page {page} of {totalPages}</span>
                <button className="btn btn-ghost btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
              </div>
            </div>
          </div>
        </>
      )}

      {showForm && meta && (
        <Modal title="Log activity" onClose={() => { setShowForm(false);setCreateInitial(null); }}>
          <ActivityForm meta={meta} initial={createInitial} onSave={handleCreate} onClose={() => { setShowForm(false);setCreateInitial(null); }} />
        </Modal>
      )}

      {editActivity && meta && (
        <Modal title={`Edit ${editActivity.activity_reference || ''}`} onClose={() => setEditActivity(null)}>
          <ActivityForm key={`${editActivity.id}-${editActivity.version}`} meta={meta} initial={editActivity} onReload={async () => {
            if (await confirm('Reloading replaces your unsaved draft with the latest activity.', { title: 'Reload Activity', label: 'Reload', danger: false })) await handleEdit(editActivity);
          }} onSave={handleUpdate} onClose={() => setEditActivity(null)} />
        </Modal>
      )}

      {viewId && (
        <ActivityDetailModal id={viewId} allowAttachments={meta?.settings?.allow_attachments}
          onClose={() => { setViewId(null); load(); }} />
      )}
    </div>
  );
}
