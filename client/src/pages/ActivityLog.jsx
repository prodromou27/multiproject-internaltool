import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardList, Search, Copy, CheckCircle2, ListPlus, Paperclip, Upload, Trash2, Pencil, Flag, SlidersHorizontal, X } from 'lucide-react';
import './ActivityLog.css';
import { PageHeader } from '../components/PageLayout';
import { useSearchParams } from 'react-router-dom';
import { useCreateIntent } from '../hooks/useCreateIntent';
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
function fmtDuration(minutes) {
  if (minutes == null) return '—';
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h > 0 ? `${h}h ${m ? m + 'm' : ''}`.trim() : `${m}m`;
}

const BILLABLE_LABELS = {
  included_in_contract: 'Included in Contract', billable: 'Billable', non_billable: 'Non-Billable',
  internal: 'Internal', not_applicable: 'Not Applicable',
};
const WORK_LOCATION_LABELS = { remote: 'Remote', onsite: 'On-site', internal: 'Internal', hybrid: 'Hybrid' };

/* ── Ledger helpers ───────────────────────────────────────────────────── */
const MIX = {
  included_in_contract: { label: 'Included in contract', color: 'var(--al-included)' },
  billable:             { label: 'Billable',             color: 'var(--al-billable)' },
  internal:             { label: 'Internal',             color: 'var(--al-internal)' },
  non_billable:         { label: 'Non-billable',         color: 'var(--al-other)' },
  not_applicable:       { label: 'Not applicable',       color: 'var(--al-other)' },
};
const mixOf = cls => MIX[cls] || { label: 'Billing not set', color: 'var(--al-other)' };
const WORKDAY_MINUTES = 480;
const RANGE_LABEL = { today: 'today', this_week: 'this week', this_month: 'this month', custom: 'in this range' };

function parseDay(value) {
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function dayLabels(value) {
  const date = parseDay(value);
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const diff = Math.round((startOfToday - date) / 86400000);
  return {
    when: diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : date.toLocaleDateString(undefined, { weekday: 'long' }),
    day: date.getDate(),
    month: date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }),
  };
}

/* Rows arrive newest-first, so a day's rows are contiguous. Pagination can cut
   the first or last day on a page; those totals would be wrong, so they're
   flagged `partial` and shown without a total or bar. */
function groupByDay(rows, page, totalPages) {
  const groups = [];
  for (const row of rows) {
    const date = String(row.activity_date).slice(0, 10);
    const last = groups[groups.length - 1];
    if (last && last.date === date) last.rows.push(row);
    else groups.push({ date, rows: [row] });
  }
  groups.forEach((group, index) => {
    group.partial = (index === 0 && page > 1) || (index === groups.length - 1 && page < totalPages);
    group.minutes = group.rows.reduce((sum, row) => sum + (row.duration_minutes || 0), 0);
  });
  return groups;
}

function DayBar({ rows, minutes }) {
  const scale = Math.max(WORKDAY_MINUTES, minutes);
  const chronological = [...rows].reverse().filter(row => row.duration_minutes > 0);
  const byMix = new Map();
  chronological.forEach(row => {
    const label = mixOf(row.billable_classification).label;
    byMix.set(label, (byMix.get(label) || 0) + row.duration_minutes);
  });
  const summary = [...byMix].map(([label, mins]) => `${fmtDuration(mins)} ${label.toLowerCase()}`).join(', ');
  return (
    <>
      <div className="al-bar" role="img" aria-label={`${fmtDuration(minutes)} logged. ${summary}`}>
        {chronological.map(row => (
          <span key={row.id} style={{ width: `${(row.duration_minutes / scale) * 100}%`, background: mixOf(row.billable_classification).color }} />
        ))}
      </div>
      <div className="al-bar-caption" aria-hidden="true">
        {minutes === WORKDAY_MINUTES ? 'A full 8h day'
          : minutes > WORKDAY_MINUTES ? `${fmtDuration(minutes - WORKDAY_MINUTES)} over 8h`
          : `${fmtDuration(WORKDAY_MINUTES - minutes)} left to 8h`}
      </div>
    </>
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

  return (
    <form onSubmit={submit}>
      {err && <div className="error-msg">{err}</div>}
      {conflict && <button type="button" className="btn btn-ghost" onClick={onReload}>Reload latest activity</button>}
      <div className="form-group">
        <label>Customer *</label>
        <select value={form.customer_id} onChange={e => setForm(f => ({ ...f,customer_id:e.target.value,asset_ids:String(e.target.value)===String(initial?.customer_id || '') ? initial?.assets?.map(asset => asset.id) || [] : [] }))} required>
          <option value="">Select a customer…</option>
          {meta.customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="form-row">
        <div className="form-group"><label>Activity Date *</label>
          <input type="date" value={form.activity_date} onChange={set('activity_date')} max={iso(new Date())} required />
        </div>
        <div className="form-group"><label>Duration (minutes){customer?.require_duration ? ' *' : ''}</label>
          <input type="number" min="1" max="1440" step="1" required={!!customer?.require_duration} value={form.duration_minutes} onChange={set('duration_minutes')} placeholder="e.g. 90" />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group"><label>Category *</label>
          <select value={form.category_id} onChange={e => setForm(f => ({ ...f, category_id: e.target.value, subcategory_id: '' }))} required>
            <option value="">Select…</option>
            {meta.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="form-group"><label>Status</label>
          <select value={form.status} onChange={set('status')}>
            {meta.statuses.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>
      <div className="form-group"><label>Title *</label>
        <input value={form.title} onChange={set('title')} maxLength={300} required placeholder="Short summary of the work performed" />
      </div>
      <div className="form-group"><label>Notes{customer?.require_notes ? ' *' : ''}</label>
        <textarea required={!!customer?.require_notes} maxLength={10000} value={form.description} onChange={set('description')} rows={3} placeholder="Details, actions taken, outcome…" />
      </div>

      <details className="column-picker" open={showMore || requiredDetails} onToggle={e => setShowMore(e.target.open)} style={{ marginTop: 4 }}>
        <summary className="btn btn-ghost btn-sm" style={{ display: 'inline-block' }}>
          {showMore ? 'Hide' : 'Show'} More Details
        </summary>
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--gray-100)' }}>
          {subcategories.length > 0 && (
            <div className="form-group"><label>Subcategory</label>
              <select value={form.subcategory_id} onChange={set('subcategory_id')}>
                <option value="">None</option>
                {subcategories.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          <div className="form-group"><label>Technology{customer?.require_technology ? ' *' : ''}</label>
            <select multiple value={form.technology_ids.map(String)}
              onChange={e => setForm(f => ({ ...f, technology_ids: [...e.target.selectedOptions].map(o => Number(o.value)) }))}
              style={{ minHeight: 80 }}>
              {meta.technologies.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="form-group"><label>Customer assets</label>
            <select multiple value={form.asset_ids.map(String)} disabled={assetsLoading || !!assetsError}
              onChange={e => setForm(f => ({ ...f,asset_ids:[...e.target.selectedOptions].map(option => Number(option.value)) }))}
              style={{ minHeight:80 }} aria-describedby={assetsError ? 'activity-assets-error' : undefined}>
              {assets.map(asset => <option key={asset.id} value={asset.id}>{asset.name} · {asset.asset_type}{asset.hostname ? ` · ${asset.hostname}` : ''}{asset.lifecycle_status==='retired' || asset.lifecycle_status==='decommissioned' ? ` (${asset.lifecycle_status})` : ''}</option>)}
            </select>
            {assetsLoading && <span className="text-muted text-sm" role="status">Loading assets…</span>}
            {assetsError && <span id="activity-assets-error" className="error-msg" role="alert">{assetsError}</span>}
            {!assetsLoading && !assetsError && form.customer_id && !assets.length && <span className="text-muted text-sm">No active assets recorded for this customer.</span>}
          </div>
          <div className="form-row">
            <div className="form-group"><label>Start Time</label><input type="time" value={form.start_time} onChange={set('start_time')} /></div>
            <div className="form-group"><label>End Time</label><input type="time" value={form.end_time} onChange={set('end_time')} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Work Location</label>
              <select value={form.work_location} onChange={set('work_location')}>
                <option value="">Not specified</option>
                {Object.entries(WORK_LOCATION_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="form-group"><label>Billable Classification{customer?.require_billable_classification ? ' *' : ''}</label>
              <select required={!!customer?.require_billable_classification} value={form.billable_classification} onChange={set('billable_classification')}>
                <option value="">Not specified</option>
                {Object.entries(BILLABLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Ticket Reference{customer?.require_ticket_reference ? ' *' : ''}</label><input value={form.ticket_reference} onChange={set('ticket_reference')} /></div>
            <div className="form-group"><label>Customer Impact</label><input value={form.customer_impact} onChange={set('customer_impact')} /></div>
          </div>
          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}>
              <input type="checkbox" checked={form.follow_up_required}
                onChange={e => setForm(f => ({ ...f, follow_up_required: e.target.checked }))} style={{ width: 'auto' }} />
              Follow-Up Required
            </label>
          </div>
          {form.follow_up_required && (
            <div className="form-group"><label>Follow-Up Date *</label>
              <input type="date" value={form.follow_up_date} onChange={set('follow_up_date')} required />
            </div>
          )}
        </div>
      </details>

      {isChangeCategory && (
        <details className="column-picker" open={showChangeDetails} onToggle={e => setShowChangeDetails(e.target.open)} style={{ marginTop: 8 }}>
          <summary className="btn btn-ghost btn-sm" style={{ display: 'inline-block' }}>
            {showChangeDetails ? 'Hide' : 'Show'} Change Details
          </summary>
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--gray-100)' }}>
            <div className="form-row">
              <div className="form-group"><label>Change Type</label><input value={form.change_type} onChange={set('change_type')} placeholder="e.g. Firewall rule update" /></div>
              <div className="form-group"><label>Risk</label>
                <select value={form.change_risk} onChange={set('change_risk')}>
                  <option value="">Not specified</option>
                  <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
                </select>
              </div>
            </div>
            <div className="form-group"><label>Change Reason</label><textarea value={form.change_reason} onChange={set('change_reason')} rows={2} /></div>
            <div className="form-row">
              <div className="form-group"><label>Previous State</label><textarea value={form.previous_state} onChange={set('previous_state')} rows={2} /></div>
              <div className="form-group"><label>New State</label><textarea value={form.new_state} onChange={set('new_state')} rows={2} /></div>
            </div>
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}>
                <input type="checkbox" checked={form.rollback_available}
                  onChange={e => setForm(f => ({ ...f, rollback_available: e.target.checked }))} style={{ width: 'auto' }} />
                Rollback Available
              </label>
            </div>
            <div className="form-group"><label>Customer Approval Reference</label><input value={form.customer_approval_reference} onChange={set('customer_approval_reference')} /></div>
            <div className="form-group"><label>Verification Notes</label><textarea value={form.verification_notes} onChange={set('verification_notes')} rows={2} /></div>
          </div>
        </details>
      )}

      {category?.require_attachment && (
        <div className="alert alert-warning" style={{ marginTop: 8 }}>
          This category requires at least one attachment before the activity can be marked Completed.
        </div>
      )}

      <div className="modal-footer" style={{ padding: '12px 0 0', border: 'none' }}>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save Activity'}</button>
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

  return (
    <Modal title={activity.activity_reference} onClose={onClose} wide>
      {loadError && <div className="error-msg" role="alert">{loadError}<button className="btn btn-ghost btn-sm" onClick={load}>Retry</button></div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ fontSize: 16 }}>{activity.title}</strong>
          <StatusBadge entityType="service_activity" s={activity.status} />
        </div>
        <div className="grid-2" style={{ gap: 8 }}>
          <div><span className="text-muted">Customer</span><div>{activity.customer_name}</div></div>
          <div><span className="text-muted">Engineer</span><div>{activity.engineer_name}</div></div>
          <div><span className="text-muted">Date</span><div>{fmtDate(activity.activity_date)}</div></div>
          <div><span className="text-muted">Duration</span><div>{fmtDuration(activity.duration_minutes)}</div></div>
          <div><span className="text-muted">Category</span><div>{activity.category_name}{activity.subcategory_name ? ` / ${activity.subcategory_name}` : ''}</div></div>
          <div><span className="text-muted">Billable</span><div>{BILLABLE_LABELS[activity.billable_classification] || '—'}</div></div>
          <div><span className="text-muted">Work Location</span><div>{WORK_LOCATION_LABELS[activity.work_location] || '—'}</div></div>
          <div><span className="text-muted">Ticket Reference</span><div>{activity.ticket_reference || '—'}</div></div>
        </div>
        {activity.description && <div><span className="text-muted">Notes</span><p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{activity.description}</p></div>}
        {activity.technologies?.length > 0 && (
          <div><span className="text-muted">Technologies</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
              {activity.technologies.map(t => <span key={t.id} className="badge badge-active">{t.name}</span>)}
            </div>
          </div>
        )}
        {activity.assets?.length > 0 && <div><span className="text-muted">Customer assets</span><div style={{ display:'flex',gap:6,flexWrap:'wrap',marginTop:4 }}>{activity.assets.map(asset => <span key={asset.id} className="badge badge-active">{asset.name}{asset.hostname ? ` · ${asset.hostname}` : ''}</span>)}</div></div>}
        {(activity.related_project_title || activity.related_task_title || activity.related_visit_title) && (
          <div><span className="text-muted">Related</span>
            <div style={{ marginTop: 4 }}>
              {activity.related_project_title && <div>Project: {activity.related_project_title}</div>}
              {activity.related_task_title && <div>Task: {activity.related_task_title}</div>}
              {activity.related_visit_title && <div>Maintenance Visit: {activity.related_visit_title}</div>}
            </div>
          </div>
        )}
        {activity.follow_up_required ? (
          <div className="alert alert-warning">Follow-up required by {fmtDate(activity.follow_up_date)}</div>
        ) : null}
        {activity.follow_up_task_title && <div><span className="text-muted">Follow-up Task</span><div>{activity.follow_up_task_title}</div></div>}

        {(activity.change_type || activity.change_reason || activity.previous_state || activity.new_state) && (
          <div><span className="text-muted">Change Details</span>
            <div style={{ marginTop: 4, fontSize: 12 }}>
              {activity.change_type && <div><strong>Type:</strong> {activity.change_type}</div>}
              {activity.change_risk && <div><strong>Risk:</strong> {activity.change_risk}</div>}
              {activity.change_reason && <div><strong>Reason:</strong> {activity.change_reason}</div>}
              {activity.previous_state && <div><strong>Previous State:</strong> {activity.previous_state}</div>}
              {activity.new_state && <div><strong>New State:</strong> {activity.new_state}</div>}
              <div><strong>Rollback Available:</strong> {activity.rollback_available ? 'Yes' : 'No'}</div>
              {activity.customer_approval_reference && <div><strong>Customer Approval:</strong> {activity.customer_approval_reference}</div>}
            </div>
          </div>
        )}

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span className="text-muted"><Paperclip size={12} style={{ verticalAlign: -1 }} /> Attachments</span>
            {allowAttachments !== false && (
              <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
                <Upload size={12} /> {uploading ? 'Uploading…' : 'Upload'}
                <input type="file" hidden onChange={handleUpload} disabled={uploading} />
              </label>
            )}
          </div>
          {attachments.length === 0
            ? <p className="text-muted" style={{ fontSize: 12 }}>No attachments yet.</p>
            : attachments.map(a => (
              <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid var(--gray-100)' }}>
                <button type="button" onClick={() => handleDownload(a)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', fontSize: 12, padding: 0, textAlign: 'left' }}>
                  {a.original_name}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleDeleteAttachment(a.id)} title="Delete"><Trash2 size={12} /></button>
              </div>
            ))}
        </div>

        <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>
          Created {fmtDateTime(activity.created_at)}{activity.completed_at ? ` · Completed ${fmtDateTime(activity.completed_at)}` : ''}
        </div>
      </div>
      <div className="modal-footer" style={{ padding: '12px 0 0', border: 'none' }}>
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

  useCreateIntent({ allowed: isManager || (saAccess.enabled && ['engineer', 'pm'].includes(user.role)), ready: !!meta, onCreate: () => { setShowForm(true); } });

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
            {groups.map(group => {
              const labels = dayLabels(group.date);
              return (
                <section className="al-day" key={group.date} aria-label={`${labels.when}, ${group.date}`}>
                  <div className="al-rail">
                    <span className="al-rail-when">{labels.when}</span>
                    <span className="al-rail-day">{labels.day}</span>
                    <span className="al-rail-month">{labels.month}</span>
                    {group.partial
                      ? <span className="al-rail-note">Day continues on another page</span>
                      : group.minutes > 0 && <span className="al-rail-total">{fmtDuration(group.minutes)}</span>}
                  </div>
                  <div>
                    {!group.partial && group.minutes > 0 && <DayBar rows={group.rows} minutes={group.minutes} />}
                    <ul className="al-entries">
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
                    </ul>
                  </div>
                </section>
              );
            })}
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
        <Modal title="Log Activity" onClose={() => setShowForm(false)}>
          <ActivityForm meta={meta} onSave={handleCreate} onClose={() => setShowForm(false)} />
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
