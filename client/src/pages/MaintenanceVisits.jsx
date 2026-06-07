import React, { useEffect, useState } from 'react';
import { Upload, X, Wrench, Check, Send, Printer, Download, AlertTriangle, AlertCircle, Search } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useSavedFilter } from '../hooks/useSavedFilter';
import { api } from '../api';
import { useAuth } from '../App';
import { fmtDate, isOverdue, Modal } from '../components/Shared';
import ImportModal from '../components/ImportModal';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';

/* ── Report-pending urgency helper ──────────────────────────
   Returns null | 'orange' | 'red'
   orange = visit has passed, report not yet sent
   red    = 7+ days since scheduled date, report still not sent
─────────────────────────────────────────────────────────── */
function reportUrgency(v) {
  if (v.report_sent || v.status === 'cancelled' || v.status === 'scheduled') return null;
  const visitDate  = new Date(v.scheduled_date + 'T12:00:00');
  const daysPast   = (Date.now() - visitDate.getTime()) / 86400000;
  if (daysPast < 0)  return null;           // future — shouldn't happen when status != scheduled
  if (daysPast >= 7) return 'red';
  return 'orange';
}

const STATUS_COLORS = {
  scheduled:   'badge-open',
  in_progress: 'badge-in_progress',
  completed:   'badge-done',
  cancelled:   'badge-cancelled',
};

/* ── Multi-engineer picker ───────────────────────────────── */
function EngineerPicker({ engineers, selected, onChange }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
      {engineers.map(e => {
        const active = selected.includes(e.id);
        return (
          <label key={e.id} style={{
            display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
            padding: '4px 10px', borderRadius: 6, fontSize: 12, userSelect: 'none',
            background: active ? '#dbeafe' : 'var(--gray-100)',
            border: active ? '1px solid #93c5fd' : '1px solid transparent',
          }}>
            <input
              type="checkbox"
              checked={active}
              onChange={() => onChange(active ? selected.filter(x => x !== e.id) : [...selected, e.id])}
              style={{ width: 'auto' }}
            />
            {e.name}
          </label>
        );
      })}
      {engineers.length === 0 && <span className="text-muted text-sm">No engineers available</span>}
    </div>
  );
}

/* ── Visit Form ──────────────────────────────────────────── */
function VisitForm({ initial, customers, engineers, onSave, onClose }) {
  const [form, setForm] = useState(initial || {
    customer_id: '', title: '', description: '', scheduled_date: '',
    engineer_ids: [], notes: '', status: 'scheduled',
  });
  const [saving,   setSaving]   = useState(false);
  const [formErr,  setFormErr]  = useState('');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault(); setSaving(true); setFormErr('');
    try { await onSave(form); onClose(); }
    catch (err) { setFormErr(err.message || 'Failed to save. Please try again.'); }
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={submit}>
      <div className="form-group">
        <label>Customer *</label>
        <select value={form.customer_id} onChange={set('customer_id')} required>
          <option value="">Select customer…</option>
          {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label>Visit Title *</label>
        <input value={form.title} onChange={set('title')} required placeholder="e.g. Q2 Health Check" />
      </div>
      <div className="form-group">
        <label>Description</label>
        <textarea value={form.description || ''} onChange={set('description')} placeholder="Scope, objectives…" />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>Scheduled Date *</label>
          <input type="date" value={form.scheduled_date} onChange={set('scheduled_date')} required />
        </div>
        {initial && (
          <div className="form-group">
            <label>Status</label>
            <select value={form.status} onChange={set('status')}>
              <option value="scheduled">Scheduled</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        )}
      </div>
      <div className="form-group">
        <label>Assign Engineers</label>
        <EngineerPicker
          engineers={engineers}
          selected={form.engineer_ids}
          onChange={ids => setForm(f => ({ ...f, engineer_ids: ids }))}
        />
      </div>
      <div className="form-group">
        <label>Notes</label>
        <textarea value={form.notes || ''} onChange={set('notes')} placeholder="Any additional notes…" />
      </div>
      {formErr && <div className="error-msg" style={{ marginBottom: 8 }}>{formErr}</div>}
      <div className="modal-footer" style={{ padding: '12px 0 0', border: 'none' }}>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

/* ── PDF / Print helper ──────────────────────────────────── */
function generatePDF(visit, onError) {
  const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const fmtD = s => s ? new Date(s + (s.length === 10 ? 'T12:00:00' : '')).toLocaleDateString([], { year:'numeric', month:'long', day:'numeric' }) : '—';
  const statusLabel = (visit.status || '').replace('_',' ');
  const reportLine = visit.report_sent_to_customer
    ? `&#10003; Sent to Project Management${visit.report_sent_to_customer_at ? ' on ' + fmtD(visit.report_sent_to_customer_at) : ''}`
    : visit.report_sent
      ? `Report complete — awaiting manager approval (completed by ${esc(visit.report_sent_by_name)}${visit.report_sent_at ? ' on ' + fmtD(visit.report_sent_at) : ''})`
      : 'Pending — report not yet completed';
  const reportBg = visit.report_sent_to_customer ? '#f0fdf4' : visit.report_sent ? '#eff6ff' : '#fffbeb';
  const reportBorder = visit.report_sent_to_customer ? '#bbf7d0' : visit.report_sent ? '#bfdbfe' : '#fde68a';

  const html = `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<title>Visit Report — ${esc(visit.title)}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Segoe UI',Arial,sans-serif;color:#1e293b;padding:40px;font-size:13px;line-height:1.5}
  .hdr{border-bottom:3px solid #3b82f6;padding-bottom:16px;margin-bottom:24px;display:flex;justify-content:space-between;align-items:flex-end}
  .logo{font-size:22px;font-weight:800;color:#3b82f6;letter-spacing:-.5px}
  .doc-type{font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin-top:2px}
  h1{font-size:20px;font-weight:700;margin-bottom:4px}
  .customer{font-size:15px;color:#3b82f6;font-weight:600;margin-bottom:20px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px}
  .field label{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;font-weight:700;display:block;margin-bottom:3px}
  .field .val{font-size:13px;font-weight:600}
  .badge{display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700}
  .b-scheduled{background:#dbeafe;color:#1d4ed8}
  .b-completed{background:#dcfce7;color:#166534}
  .b-in_progress{background:#fef9c3;color:#854d0e}
  .b-cancelled{background:#f3f4f6;color:#6b7280}
  .sec{margin-bottom:20px}
  .sec-title{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;font-weight:700;margin-bottom:6px;border-bottom:1px solid #e2e8f0;padding-bottom:4px}
  .text-block{font-size:13px;line-height:1.65;color:#334155;white-space:pre-wrap}
  .report-box{padding:12px 16px;border-radius:8px;border:1px solid ${reportBorder};background:${reportBg};margin-bottom:20px;font-size:13px}
  .footer{margin-top:40px;padding-top:12px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;font-size:11px;color:#94a3b8}
  @media print{body{padding:24px}@page{margin:1.5cm}}
</style>
</head><body>
  <div class="hdr">
    <div><div class="logo">Solutions Hub</div><div class="doc-type">Maintenance Visit Report</div></div>
    <div style="font-size:11px;color:#94a3b8;text-align:right">Generated ${new Date().toLocaleDateString([], { year:'numeric', month:'long', day:'numeric' })}</div>
  </div>

  <h1>${esc(visit.title)}</h1>
  <div class="customer">${esc(visit.customer_name)}</div>

  <div class="grid">
    <div class="field"><label>Scheduled Date</label><div class="val">${fmtD(visit.scheduled_date)}</div></div>
    <div class="field"><label>Status</label><div class="val"><span class="badge b-${visit.status}">${statusLabel}</span></div></div>
    <div class="field"><label>Engineer${(visit.engineer_names || '').includes(',') ? 's' : ''}</label><div class="val">${esc(visit.engineer_names) || 'Unassigned'}</div></div>
    <div class="field"><label>Contact</label><div class="val">${esc(visit.contact_name) || '—'}${visit.contact_email ? ' &middot; ' + esc(visit.contact_email) : ''}</div></div>
  </div>

  ${visit.description ? `<div class="sec"><div class="sec-title">Description</div><div class="text-block">${esc(visit.description)}</div></div>` : ''}
  ${visit.notes       ? `<div class="sec"><div class="sec-title">Notes</div><div class="text-block">${esc(visit.notes)}</div></div>` : ''}

  <div class="report-box"><strong>Report Status:</strong> ${reportLine}</div>

  <div class="footer">
    <span>Solutions Hub &mdash; Internal Project Management</span>
    <span>${esc(visit.customer_name)} &middot; ${esc(visit.title)}</span>
  </div>
</body></html>`;

  const win = window.open('', '_blank', 'width=820,height=960');
  if (!win) { onError?.('Please allow pop-ups to generate the PDF. Check your browser settings.'); return; }
  win.document.write(html);
  win.document.close();
  win.addEventListener('load', () => win.print());
}

/* ── Visit Detail Modal ──────────────────────────────────── */
function VisitDetailModal({ visit, isManager, canManage, isPM, onClose, onUpdate }) {
  const toast = useToast();
  const [notes, setNotes] = useState(visit.notes || '');
  const [saving, setSaving] = useState(false);

  async function saveNotes()         { setSaving(true); try { await api.updateVisit(visit.id, { notes }); toast.success('Notes saved'); onUpdate(); } catch(e){toast.error(e.message);} finally{setSaving(false);} }
  async function markSent()          { try { await api.markReportSent(visit.id);     toast.success('Report marked as submitted'); onUpdate(); onClose(); } catch(e){toast.error(e.message);} }
  async function markUnsent()        { try { await api.markReportUnsent(visit.id);   toast.success('Report submission undone');  onUpdate(); onClose(); } catch(e){toast.error(e.message);} }
  async function markCustomerSent()  { try { await api.markCustomerSent(visit.id);   toast.success('Report approved & sent to PM'); onUpdate(); onClose(); } catch(e){toast.error(e.message);} }
  async function markCustomerUnsent(){ try { await api.markCustomerUnsent(visit.id); toast.success('Approval undone'); onUpdate(); onClose(); } catch(e){toast.error(e.message);} }
  async function markComplete()      { try { await api.completeVisit(visit.id);      toast.success('Visit marked as complete'); onUpdate(); onClose(); } catch(e){toast.error(e.message);} }

  // 3-state: pending / report_complete / sent_to_pm
  const reportState = visit.report_sent_to_customer ? 'sent_to_pm'
    : visit.report_sent ? 'report_complete' : 'pending';

  const reportBadge = {
    pending:          <span className="badge badge-open">Pending</span>,
    report_complete:  <span className="badge badge-active" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Check size={10} /> Report Complete</span>,
    sent_to_pm:       <span className="badge badge-done"   style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Send size={10} /> Sent to PM</span>,
  }[reportState];

  return (
    <Modal title="Maintenance Visit Details" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div className="text-sm text-muted" style={{ textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700, marginBottom: 2 }}>Customer</div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{visit.customer_name}</div>
          {visit.contact_name && <div className="text-sm text-muted">{visit.contact_name}{visit.contact_email ? ` · ${visit.contact_email}` : ''}</div>}
        </div>
        <div className="divider" />

        {/* ── Workflow progress steps ─────────────────────── */}
        {visit.status !== 'cancelled' && (() => {
          const step1 = visit.status === 'completed' || visit.status === 'in_progress' || !!visit.report_sent;
          const step2 = !!visit.report_sent;
          const step3 = !!visit.report_sent_to_customer;
          const steps = [
            { label: 'Visit Complete',    done: step1, active: !step1 },
            { label: 'Report Submitted',  done: step2, active: step1 && !step2 },
            { label: 'Approved & Sent',   done: step3, active: step2 && !step3 },
          ];
          return (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, marginBottom: 4 }}>
              {steps.map((s, i) => (
                <React.Fragment key={i}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div style={{
                      width: 30, height: 30, borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: s.done ? 'var(--success)' : s.active ? 'var(--primary)' : 'var(--gray-100)',
                      color: s.done || s.active ? '#fff' : 'var(--gray-400)',
                      fontWeight: 700, fontSize: 12, flexShrink: 0,
                      boxShadow: s.active ? '0 0 0 3px rgba(37,99,235,.2)' : 'none',
                      transition: 'all .2s',
                    }}>
                      {s.done ? <Check size={13} /> : i + 1}
                    </div>
                    <span style={{ fontSize: 10, fontWeight: s.done || s.active ? 600 : 400, color: s.done ? 'var(--success)' : s.active ? 'var(--primary)' : 'var(--gray-400)', textAlign: 'center', lineHeight: 1.3 }}>
                      {s.label}
                    </span>
                  </div>
                  {i < steps.length - 1 && (
                    <div style={{ flex: 0.4, height: 2, marginTop: 14, background: steps[i + 1].done || s.done ? 'var(--success)' : 'var(--gray-200)', transition: 'background .2s' }} />
                  )}
                </React.Fragment>
              ))}
            </div>
          );
        })()}

        <div className="divider" />
        <div className="grid-2">
          <div>
            <div className="text-sm text-muted" style={{ textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700, marginBottom: 2 }}>Scheduled Date</div>
            <div className={isOverdue(visit.scheduled_date) && visit.status === 'scheduled' ? 'overdue font-bold' : 'font-bold'}>{fmtDate(visit.scheduled_date)}</div>
          </div>
          <div>
            <div className="text-sm text-muted" style={{ textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700, marginBottom: 2 }}>Status</div>
            <span className={`badge ${STATUS_COLORS[visit.status]}`}>{visit.status.replace('_', ' ')}</span>
          </div>
          <div>
            <div className="text-sm text-muted" style={{ textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700, marginBottom: 2 }}>
              Engineer{visit.engineer_ids?.length !== 1 ? 's' : ''}
            </div>
            <div>{visit.engineer_names || <span className="text-muted">Unassigned</span>}</div>
          </div>
          <div>
            <div className="text-sm text-muted" style={{ textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700, marginBottom: 2 }}>Report Status</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {reportBadge}
              {visit.report_sent && (
                <div className="text-sm text-muted">
                  Submitted by {visit.report_sent_by_name} · {fmtDate(visit.report_sent_at)}
                </div>
              )}
              {visit.report_sent_to_customer && (
                <div className="text-sm text-muted">
                  Approved by {visit.report_sent_to_customer_by_name} · {fmtDate(visit.report_sent_to_customer_at)}
                </div>
              )}
            </div>
          </div>
        </div>
        {visit.description && <>
          <div className="divider" />
          <div>
            <div className="text-sm text-muted" style={{ fontWeight: 700, marginBottom: 4 }}>DESCRIPTION</div>
            <p style={{ fontSize: 13 }}>{visit.description}</p>
          </div>
        </>}
        <div className="divider" />
        <div className="form-group" style={{ margin: 0 }}>
          <label>Notes</label>
          <textarea value={notes} onChange={e => !isPM && setNotes(e.target.value)} rows={3} readOnly={isPM} style={isPM ? { background: 'var(--gray-50)', color: 'var(--gray-500)' } : {}} />
        </div>
        {!isPM && (
          <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-end' }} onClick={saveNotes} disabled={saving}>
            {saving ? 'Saving…' : 'Save Notes'}
          </button>
        )}
      </div>
      <div className="modal-footer" style={{ flexWrap: 'wrap', gap: 8 }}>
        {/* PM: mark complete */}
        {isPM && visit.status !== 'completed' && visit.status !== 'cancelled' && (
          <button className="btn btn-success" onClick={markComplete} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Check size={14} /> Mark as Completed
          </button>
        )}
        {/* Step 1 → 2 : engineer submits report */}
        {!isPM && reportState === 'pending' && visit.status !== 'cancelled' && (
          <button className="btn btn-success" onClick={markSent} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Check size={14} /> Submit Report
          </button>
        )}
        {/* Step 2 → 3 : manager/planner approves and sends to PM */}
        {reportState === 'report_complete' && canManage && (
          <button className="btn btn-primary" onClick={markCustomerSent} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Send size={14} /> Approve &amp; Send to PM
          </button>
        )}
        {/* Undo actions (escape hatches) */}
        {reportState === 'sent_to_pm' && canManage && (
          <button className="btn btn-ghost btn-sm" onClick={markCustomerUnsent} title="Undo — move back to awaiting approval">↩ Undo PM Sent</button>
        )}
        {reportState === 'report_complete' && canManage && (
          <button className="btn btn-ghost btn-sm" onClick={markUnsent} title="Undo — move back to report pending">↩ Undo Submission</button>
        )}
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => generatePDF(visit, msg => toast.warning(msg))}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginLeft: 'auto' }}
          title="Open print-friendly report"
        >
          <Printer size={13} /> Print Report
        </button>
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

const MV_COLUMNS = ['customer_name*', 'title*', 'description', 'scheduled_date*', 'engineer_names', 'notes'];

/* ── Main Page ───────────────────────────────────────────── */
export default function MaintenanceVisits() {
  const { user }   = useAuth();
  const toast      = useToast();
  const confirm    = useConfirm();
  const isManager  = user.role === 'manager';
  const isPlanner  = user.role === 'planner';
  const isEngineer = user.role === 'engineer';
  const isPM       = user.role === 'pm';
  const canManage  = isManager || isPlanner;
  const location  = useLocation();
  const [visits,      setVisits]      = useState([]);
  const [customers,   setCustomers]   = useState([]);
  const [engineers,   setEngineers]   = useState([]);
  const [filter,      setFilter]      = useSavedFilter('mv_filter', 'upcoming');
  const [monthFilter, setMonthFilter] = useState('');
  const [search,      setSearch]      = useState('');
  const [selected,    setSelected]    = useState(null);
  const [showForm,    setShowForm]    = useState(false);
  const [showImport,  setShowImport]  = useState(false);
  const [editing,     setEditing]     = useState(null);
  const [loading,     setLoading]     = useState(true);

  // Apply URL ?filter= param on mount (e.g. from dashboard stat card clicks)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const urlFilter = params.get('filter');
    if (urlFilter) setFilter(urlFilter);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const load = () => {
    const params = {};
    if (monthFilter) params.month = monthFilter;
    return Promise.all([
      api.maintenanceVisits(params),
      canManage ? api.customers() : Promise.resolve([]),
      canManage ? api.users()     : Promise.resolve([]),
    ]).then(([v, c, u]) => {
      setVisits(v);
      setCustomers(c);
      setEngineers((u || []).filter(x => x.role === 'engineer'));
      setLoading(false);
    });
  };
  useEffect(() => { load(); }, [monthFilter]);

  const today = new Date().toISOString().slice(0, 10);
  const filtered = visits.filter(v => {
    // Status-tab filter
    let pass = true;
    if (filter === 'upcoming')        pass = v.status === 'scheduled' && v.scheduled_date >= today;
    else if (filter === 'past')       pass = v.scheduled_date < today || v.status === 'completed';
    else if (filter === 'report_pending')  pass = v.status !== 'cancelled' && v.status !== 'scheduled' && !v.report_sent;
    else if (filter === 'awaiting_review') pass = v.report_sent && !v.report_sent_to_customer;
    else if (filter === 'cancelled')  pass = v.status === 'cancelled';
    if (!pass) return false;
    // Text search
    if (search.trim()) {
      const q = search.toLowerCase();
      return (v.customer_name || '').toLowerCase().includes(q) ||
             (v.title || '').toLowerCase().includes(q) ||
             (v.engineer_names || '').toLowerCase().includes(q);
    }
    return true;
  });

  // Only count visits that have actually occurred (exclude future scheduled)
  const reportPendingCount  = visits.filter(v => v.status !== 'cancelled' && v.status !== 'scheduled' && !v.report_sent).length;
  const awaitingReviewCount = visits.filter(v => v.report_sent && !v.report_sent_to_customer).length;

  async function handleDelete(id) {
    const ok = await confirm('Delete this maintenance visit?', { title: 'Delete Visit' });
    if (!ok) return;
    try { await api.deleteVisit(id); toast.success('Visit deleted'); load(); } catch (e) { toast.error(e.message); }
  }

  // Prepare editing form (convert engineer_ids from array)
  function openEdit(v) {
    setEditing({
      ...v,
      customer_id:    v.customer_id,
      engineer_ids:   v.engineer_ids || [],
      scheduled_date: v.scheduled_date?.slice(0, 10),
    });
    setShowForm(true);
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Maintenance Visits</h1>
        {canManage && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost btn-sm" onClick={async () => {
              try {
                // Use a short-lived (60 s) scoped download token — never expose
                // the full session JWT in a URL (would be captured in server logs)
                const { token } = await api.downloadToken();
                const a = document.createElement('a');
                a.href = '/api/maintenance-visits/export?token=' + token;
                a.download = 'maintenance-visits.xlsx'; a.click();
              } catch { toast.error('Export failed. Please try again.'); }
            }} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Download size={13} /> Export
            </button>
            <button className="btn btn-ghost" onClick={() => setShowImport(true)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Upload size={14} /> Import</button>
            <button className="btn btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>+ Schedule Visit</button>
          </div>
        )}
      </div>

      {/* Quick stats */}
      <div className="grid-4" style={{ marginBottom: 20 }}>
        <div className="card stat">
          <div className="stat-value">{visits.filter(v => v.status === 'scheduled').length}</div>
          <div className="stat-label">Scheduled</div>
        </div>
        <div className="card stat">
          <div className="stat-value" style={{ color: 'var(--success)' }}>{visits.filter(v => v.status === 'completed').length}</div>
          <div className="stat-label">Completed</div>
        </div>
        <div className="card stat">
          <div className="stat-value" style={{ color: reportPendingCount > 0 ? 'var(--warning)' : 'var(--success)' }}>{reportPendingCount}</div>
          <div className="stat-label">Reports Pending</div>
        </div>
        <div className="card stat">
          <div className="stat-value" style={{ color: 'var(--primary)' }}>{visits.filter(v => v.report_sent_to_customer).length}</div>
          <div className="stat-label">Sent to PM</div>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="card" style={{ marginBottom: 16 }}>
        {/* Search bar */}
        <div style={{ position: 'relative', marginBottom: 10 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)', pointerEvents: 'none' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by customer, visit title, or engineer…"
            style={{ paddingLeft: 32, width: '100%', maxWidth: 420 }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-400)', display: 'flex', padding: 2 }}>
              <X size={13} />
            </button>
          )}
        </div>
        {/* Status tabs + month picker */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="filter-bar" style={{ flex: 1 }}>
            {[
              ['upcoming',        'Upcoming'],
              ['past',            'Past / Completed'],
              ['report_pending',  `Report Pending${reportPendingCount ? ` (${reportPendingCount})` : ''}`],
              ['awaiting_review', `Awaiting Approval${awaitingReviewCount ? ` (${awaitingReviewCount})` : ''}`],
              ['all',             'All'],
              ['cancelled',       'Cancelled'],
            ].map(([k, l]) => (
              <button key={k} className={'filter-pill' + (filter === k ? ' active' : '')} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
          <input type="month" value={monthFilter} onChange={e => setMonthFilter(e.target.value)} style={{ width: 'auto', padding: '5px 10px' }} title="Filter by month" />
          {monthFilter && <button className="btn btn-sm btn-ghost" onClick={() => setMonthFilter('')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><X size={12} /> Clear month</button>}
        </div>
      </div>

      {loading ? <p className="text-muted">Loading…</p> : filtered.length === 0
        ? (
          <div className="empty">
            <div className="empty-icon"><Wrench size={40} strokeWidth={1.2} /></div>
            <p>{search.trim() ? `No visits matching "${search}"` : 'No maintenance visits in this view'}</p>
            {(search.trim() || monthFilter) && (
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }}
                onClick={() => { setSearch(''); setMonthFilter(''); setFilter('all'); }}>
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Visit Title</th>
                  <th>Date</th>
                  <th>Engineers</th>
                  <th>Status</th>
                  <th>Report</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(v => {
                  const urgency  = isEngineer ? reportUrgency(v) : null;
                  const rowStyle = {
                    cursor: 'pointer',
                    ...(urgency === 'red'    && { background: '#fef2f2', borderLeft: '3px solid #ef4444' }),
                    ...(urgency === 'orange' && { background: '#fff7ed', borderLeft: '3px solid #f97316' }),
                  };
                  return (
                  <tr key={v.id} style={rowStyle} onClick={() => setSelected(v)}>
                    <td style={{ fontWeight: 600 }}>{v.customer_name}</td>
                    <td>{v.title}</td>
                    <td className={isOverdue(v.scheduled_date) && v.status === 'scheduled' ? 'overdue' : ''}>{fmtDate(v.scheduled_date)}</td>
                    <td>
                      {v.engineer_names
                        ? <span style={{ fontSize: 12 }}>{v.engineer_names}</span>
                        : <span className="text-muted">Unassigned</span>}
                    </td>
                    <td><span className={`badge ${STATUS_COLORS[v.status]}`}>{v.status.replace('_', ' ')}</span></td>
                    <td>
                      {v.report_sent_to_customer
                        ? <span className="badge badge-done" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Send size={10} /> Sent to PM</span>
                        : v.report_sent
                          ? <span className="badge badge-active" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Check size={10} /> Report Complete</span>
                          : urgency === 'red'
                            ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#dc2626', fontWeight: 700, fontSize: 12 }}>
                                <AlertCircle size={13} /> Overdue 7d+
                              </span>
                            : urgency === 'orange'
                              ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#ea580c', fontWeight: 600, fontSize: 12 }}>
                                  <AlertTriangle size={13} /> Pending
                                </span>
                              : <span className="badge badge-open">Pending</span>}
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <div className="flex gap-8">
                        {/* PM: mark complete */}
                        {isPM && v.status !== 'completed' && v.status !== 'cancelled' && (
                          <button className="btn btn-sm btn-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={async () => { await api.completeVisit(v.id); load(); }}><Check size={12} /> Mark Complete</button>
                        )}
                        {/* Engineer: submit report */}
                        {!isPM && !v.report_sent && v.status !== 'cancelled' && (
                          <button className="btn btn-sm btn-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={async () => { await api.markReportSent(v.id); load(); }}><Check size={12} /> Submit Report</button>
                        )}
                        {v.report_sent && !v.report_sent_to_customer && canManage && (
                          <button className="btn btn-sm btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={async () => { await api.markCustomerSent(v.id); load(); }}><Send size={12} /> Approve &amp; Send to PM</button>
                        )}
                        {canManage && <button className="btn btn-sm btn-ghost" onClick={() => openEdit(v)}>Edit</button>}
                        {canManage && <button className="btn btn-sm btn-danger" onClick={() => handleDelete(v.id)}>Del</button>}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      }

      {selected && (
        <VisitDetailModal
          visit={selected}
          isManager={isManager}
          canManage={canManage}
          isPM={isPM}
          onClose={() => setSelected(null)}
          onUpdate={() => { load(); setSelected(null); }}
        />
      )}

      {showForm && canManage && (
        <Modal title={editing ? 'Edit Visit' : 'Schedule Maintenance Visit'} onClose={() => { setShowForm(false); setEditing(null); }}>
          <VisitForm
            initial={editing}
            customers={customers}
            engineers={engineers}
            onSave={async data => {
              if (editing) {
                await api.updateVisit(editing.id, data);
                toast.success('Visit updated successfully');
              } else {
                await api.createVisit(data);
                toast.success('Visit scheduled successfully');
              }
              load();
            }}
            onClose={() => { setShowForm(false); setEditing(null); }}
          />
        </Modal>
      )}

      {showImport && canManage && (
        <ImportModal
          title="Import Maintenance Visits"
          templateUrl={api.maintenanceVisitsTemplateUrl()}
          importFn={api.importVisits}
          columns={MV_COLUMNS}
          onClose={() => setShowImport(false)}
          onDone={load}
        />
      )}
    </div>
  );
}
