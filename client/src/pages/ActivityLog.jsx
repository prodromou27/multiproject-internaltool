import React, { useEffect, useState } from 'react';
import { ClipboardList, Search, Copy, CheckCircle2, ListPlus, Paperclip, Upload, Trash2 } from 'lucide-react';
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

/* ── Quick Log / Edit Activity form ──────────────────────────────────── */
function ActivityForm({ meta, initial, onSave, onClose }) {
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
  const [err, setErr] = useState('');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const category = meta.categories.find(c => String(c.id) === String(form.category_id));
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
    } catch (ex) { setErr(ex.message || 'Failed to save activity'); }
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={submit}>
      {err && <div className="error-msg">{err}</div>}
      <div className="form-group">
        <label>Customer *</label>
        <select value={form.customer_id} onChange={set('customer_id')} required>
          <option value="">Select a customer…</option>
          {meta.customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="form-row">
        <div className="form-group"><label>Activity Date *</label>
          <input type="date" value={form.activity_date} onChange={set('activity_date')} max={iso(new Date())} required />
        </div>
        <div className="form-group"><label>Duration (minutes)</label>
          <input type="number" min="1" value={form.duration_minutes} onChange={set('duration_minutes')} placeholder="e.g. 90" />
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
      <div className="form-group"><label>Notes</label>
        <textarea value={form.description} onChange={set('description')} rows={3} placeholder="Details, actions taken, outcome…" />
      </div>

      <details className="column-picker" open={showMore} onToggle={e => setShowMore(e.target.open)} style={{ marginTop: 4 }}>
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
          <div className="form-group"><label>Technology</label>
            <select multiple value={form.technology_ids.map(String)}
              onChange={e => setForm(f => ({ ...f, technology_ids: [...e.target.selectedOptions].map(o => Number(o.value)) }))}
              style={{ minHeight: 80 }}>
              {meta.technologies.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
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
            <div className="form-group"><label>Billable Classification</label>
              <select value={form.billable_classification} onChange={set('billable_classification')}>
                <option value="">Not specified</option>
                {Object.entries(BILLABLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Ticket Reference</label><input value={form.ticket_reference} onChange={set('ticket_reference')} /></div>
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

  const load = () => Promise.all([api.serviceActivity(id), api.serviceActivityAttachments(id)])
    .then(([a, atts]) => { setActivity(a); setAttachments(atts); });
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  if (!activity) return <Modal title="Activity" onClose={onClose}><p className="text-muted">Loading…</p></Modal>;

  return (
    <Modal title={activity.activity_reference} onClose={onClose} wide>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ fontSize: 16 }}>{activity.title}</strong>
          <StatusBadge s={activity.status} />
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

  const [showForm, setShowForm] = useState(false);
  const [editActivity, setEditActivity] = useState(null);
  const [viewId, setViewId] = useState(null);

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

  const load = () => {
    setLoading(true);
    const [from, to] = dateRange();
    const params = { page, page_size: pageSize };
    if (from) params.from = from;
    if (to) params.to = to;
    if (customerFilter) params.customer_id = customerFilter;
    if (categoryFilter) params.category_id = categoryFilter;
    if (statusFilter) params.status = statusFilter;
    if (technologyFilter) params.technology_id = technologyFilter;
    if (billableFilter) params.billable_classification = billableFilter;
    if (search.trim()) params.search = search.trim();
    return api.serviceActivities(params).then(d => { setRows(d.rows); setTotal(d.total); setLoading(false); })
      .catch(e => { toast.error(e.message); setLoading(false); });
  };

  useEffect(() => { load(); }, [page, datePreset, customFrom, customTo, customerFilter, categoryFilter, statusFilter, technologyFilter, billableFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(() => { setPage(1); load(); }, 300); return () => clearTimeout(t); }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreate(payload) {
    await api.createServiceActivity(payload);
    setShowForm(false);
    toast.success('Activity logged');
    load();
  }

  async function handleUpdate(payload) {
    await api.updateServiceActivity(editActivity.id, payload);
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
    try { await api.createFollowUpTask(row.id); toast.success('Follow-up task created'); load(); }
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

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Activity Log</h1>
        <button className="btn btn-primary" onClick={() => setShowForm(true)} disabled={!meta}>+ Log Activity</button>
      </div>

      {metaError && <div className="error-msg" style={{ marginBottom: 12 }}>{metaError}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="filter-bar" style={{ marginBottom: 10 }}>
          {[['today', 'Today'], ['this_week', 'This Week'], ['this_month', 'This Month'], ['custom', 'Custom Range']].map(([k, l]) => (
            <button key={k} className={'filter-pill' + (datePreset === k ? ' active' : '')} onClick={() => { setDatePreset(k); setPage(1); }}>{l}</button>
          ))}
        </div>
        {datePreset === 'custom' && (
          <div className="form-row" style={{ marginBottom: 10 }}>
            <div className="form-group"><label>From</label><input type="date" value={customFrom} onChange={e => { setCustomFrom(e.target.value); setPage(1); }} /></div>
            <div className="form-group"><label>To</label><input type="date" value={customTo} onChange={e => { setCustomTo(e.target.value); setPage(1); }} /></div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 300 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)', pointerEvents: 'none' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search title, notes, reference, ticket…" style={{ paddingLeft: 32 }} />
          </div>
          {meta && (
            <>
              <select value={customerFilter} onChange={e => { setCustomerFilter(e.target.value); setPage(1); }} style={{ width: 'auto' }}>
                <option value="">All Customers</option>
                {meta.customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(1); }} style={{ width: 'auto' }}>
                <option value="">All Categories</option>
                {meta.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }} style={{ width: 'auto' }}>
                <option value="">All Statuses</option>
                {meta.statuses.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <select value={technologyFilter} onChange={e => { setTechnologyFilter(e.target.value); setPage(1); }} style={{ width: 'auto' }}>
                <option value="">All Technologies</option>
                {meta.technologies.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <select value={billableFilter} onChange={e => { setBillableFilter(e.target.value); setPage(1); }} style={{ width: 'auto' }}>
                <option value="">All Billable Types</option>
                {Object.entries(BILLABLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </>
          )}
        </div>
      </div>

      {loading ? <div className="skeleton-table"><span /><span /><span /><span /></div> : rows.length === 0 ? (
        <div className="empty">
          <div className="empty-icon"><ClipboardList size={40} strokeWidth={1.2} /></div>
          <p>No activities found for this view</p>
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Reference</th><th>Date</th><th>Customer</th><th>Category</th><th>Title</th>
                <th>Duration</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td>
                    <button type="button" onClick={() => setViewId(r.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', fontWeight: 600, padding: 0 }}>
                      {r.activity_reference}
                    </button>
                  </td>
                  <td>{fmtDate(r.activity_date)}</td>
                  <td>{r.customer_name}</td>
                  <td>{r.category_name}</td>
                  <td>{r.title}{r.follow_up_required ? <span title="Follow-up required" style={{ marginLeft: 6 }}>⏳</span> : null}</td>
                  <td>{fmtDuration(r.duration_minutes)}</td>
                  <td><StatusBadge s={r.status} /></td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      <button className="btn btn-ghost btn-sm" title="Edit" onClick={() => setEditActivity(r)}>Edit</button>
                      <button className="btn btn-ghost btn-sm" title="Duplicate" onClick={() => handleDuplicate(r)}><Copy size={12} /></button>
                      {r.status !== 'completed' && (
                        <button className="btn btn-ghost btn-sm" title="Mark Complete" onClick={() => handleComplete(r)}><CheckCircle2 size={12} /></button>
                      )}
                      {meta?.settings?.allow_follow_up_task_creation !== false && (
                        <button className="btn btn-ghost btn-sm" title="Create Follow-Up Task" onClick={() => handleFollowUp(r)}><ListPlus size={12} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 4px 0' }}>
            <span className="text-muted" style={{ fontSize: 12 }}>{total} activities</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
              <span style={{ fontSize: 12 }}>Page {page} of {totalPages}</span>
              <button className="btn btn-ghost btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
            </div>
          </div>
        </div>
      )}

      {showForm && meta && (
        <Modal title="Log Activity" onClose={() => setShowForm(false)}>
          <ActivityForm meta={meta} onSave={handleCreate} onClose={() => setShowForm(false)} />
        </Modal>
      )}

      {editActivity && meta && (
        <Modal title={`Edit ${editActivity.activity_reference || ''}`} onClose={() => setEditActivity(null)}>
          <ActivityForm meta={meta} initial={editActivity} onSave={handleUpdate} onClose={() => setEditActivity(null)} />
        </Modal>
      )}

      {viewId && (
        <ActivityDetailModal id={viewId} allowAttachments={meta?.settings?.allow_attachments}
          onClose={() => { setViewId(null); load(); }} />
      )}
    </div>
  );
}
