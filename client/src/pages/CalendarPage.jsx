import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { CheckSquare, FolderOpen, Wrench, ChevronLeft, ChevronRight, Check, X, Plus, Link2, Copy } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../App';
import { fmtDate, Modal } from '../components/Shared';

const DAYS   = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

const TYPE_STYLE = {
  task:        { bg: '#dbeafe', color: '#1d4ed8', Icon: CheckSquare, label: 'Task' },
  project:     { bg: '#ede9fe', color: '#6d28d9', Icon: FolderOpen,  label: 'Project Deadline' },
  maintenance: { bg: '#fef3c7', color: '#b45309', Icon: Wrench,      label: 'Maintenance Visit' },
};

/* ── Engineer multi-picker ───────────────────────────────── */
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
            <input type="checkbox" checked={active}
              onChange={() => onChange(active ? selected.filter(x => x !== e.id) : [...selected, e.id])}
              style={{ width: 'auto' }} />
            {e.name}
          </label>
        );
      })}
      {engineers.length === 0 && <span className="text-muted text-sm">No engineers available</span>}
    </div>
  );
}

/* ── Quick-create Maintenance Visit modal ────────────────── */
function NewVisitModal({ prefillDate, onClose, onCreated }) {
  const [form, setForm] = useState({
    customer_id: '', title: '', description: '',
    scheduled_date: prefillDate || '', engineer_ids: [], notes: '',
  });
  const [customers,  setCustomers]  = useState([]);
  const [engineers,  setEngineers]  = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [err,        setErr]        = useState('');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    Promise.all([api.customers(), api.users()])
      .then(([custs, users]) => {
        setCustomers(custs);
        setEngineers(users.filter(u => u.role === 'engineer' && u.active !== 0));
      })
      .catch(() => setErr('Failed to load form data'))
      .finally(() => setLoading(false));
  }, []);

  async function submit(e) {
    e.preventDefault();
    setErr(''); setSaving(true);
    try {
      await api.createVisit({
        ...form,
        customer_id:  Number(form.customer_id),
        status:       'scheduled',
      });
      onCreated();
      onClose();
    } catch (ex) {
      setErr(ex.message || 'Failed to create visit');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="New Maintenance Visit" onClose={onClose} wide>
      {loading ? (
        <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--gray-400)' }}>Loading…</div>
      ) : (
        <form onSubmit={submit}>
          {err && <div className="error-msg" style={{ marginBottom: 12 }}>{err}</div>}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>Customer *</label>
              <select value={form.customer_id} onChange={set('customer_id')} required>
                <option value="">Select customer…</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>Visit Title *</label>
              <input value={form.title} onChange={set('title')} required placeholder="e.g. Q3 Health Check" autoFocus />
            </div>

            <div className="form-group">
              <label>Scheduled Date *</label>
              <input type="date" value={form.scheduled_date} onChange={set('scheduled_date')} required />
            </div>

            <div className="form-group">
              <label>Description</label>
              <input value={form.description || ''} onChange={set('description')} placeholder="Scope / objectives…" />
            </div>
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
            <textarea value={form.notes || ''} onChange={set('notes')} rows={2}
              placeholder="Any additional notes…" style={{ resize: 'vertical' }} />
          </div>

          <div className="modal-footer" style={{ padding: '12px 0 0', border: 'none' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              disabled={saving}>
              {saving ? '⏳ Saving…' : <><Wrench size={14} /> Create Visit</>}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/* ── Context menu (right-click) ─────────────────────────── */
function ContextMenu({ x, y, date, onNewVisit, onClose }) {
  const ref = useRef(null);

  // Close on outside click or Escape
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    const onMouse = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onMouse);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onMouse); };
  }, [onClose]);

  // Keep menu in viewport
  const style = {
    position: 'fixed',
    top: Math.min(y, window.innerHeight - 100),
    left: Math.min(x, window.innerWidth - 220),
    zIndex: 9000,
    background: '#fff',
    border: '1px solid var(--gray-200)',
    borderRadius: 8,
    boxShadow: '0 4px 20px rgba(0,0,0,.12)',
    minWidth: 200,
    overflow: 'hidden',
  };

  return (
    <div ref={ref} style={style}>
      {/* header */}
      <div style={{
        padding: '7px 12px', fontSize: 11, fontWeight: 700,
        color: 'var(--gray-500)', borderBottom: '1px solid var(--gray-100)',
        background: 'var(--gray-50)', letterSpacing: '0.04em',
        textTransform: 'uppercase',
      }}>
        {fmtDate(date)}
      </div>
      <button
        onClick={() => { onClose(); onNewVisit(); }}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
          padding: '10px 14px', background: 'none', border: 'none',
          cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#b45309',
          textAlign: 'left',
        }}
        onMouseEnter={e => e.currentTarget.style.background = '#fef3c7'}
        onMouseLeave={e => e.currentTarget.style.background = 'none'}
      >
        <span style={{
          width: 24, height: 24, borderRadius: 6,
          background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Wrench size={13} color="#b45309" />
        </span>
        New Maintenance Visit
      </button>
    </div>
  );
}

/* ── Event chip ──────────────────────────────────────────── */
function EventChip({ event, onClick }) {
  const s = TYPE_STYLE[event.type];
  return (
    <div
      onClick={e => { e.stopPropagation(); onClick(event); }}
      style={{
        background: s.bg, color: s.color, borderRadius: 4, padding: '1px 5px',
        fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
        overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 2,
        borderLeft: `3px solid ${s.color}`, lineHeight: '18px',
        display: 'flex', alignItems: 'center', gap: 3,
      }}
      title={event.title || event.customer_name}
    >
      <s.Icon size={10} /> {event.title || event.customer_name}
    </div>
  );
}

/* ── Event detail popover ────────────────────────────────── */
function EventPopover({ event, onClose, onReportSent }) {
  const s = TYPE_STYLE[event.type];
  const { user } = useAuth();

  async function markSent() {
    await api.markReportSent(event.id);
    onReportSent();
    onClose();
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 500,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={onClose}>
      <div style={{
        background: '#fff', borderRadius: 10, boxShadow: '0 8px 30px rgba(0,0,0,.15)',
        width: '100%', maxWidth: 380, padding: 20,
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 36, height: 36, borderRadius: 8, background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <s.Icon size={18} color={s.color} />
            </span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{event.title || event.customer_name}</div>
              <div style={{ fontSize: 11, color: s.color, fontWeight: 600 }}>{s.label}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', display: 'flex', alignItems: 'center', padding: 2 }}><X size={16} /></button>
        </div>

        <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div><span style={{ color: '#6b7280' }}>Date:</span> <strong>{fmtDate(event.date)}</strong></div>

          {event.type === 'task' && <>
            <div><span style={{ color: '#6b7280' }}>Status:</span> {event.status}</div>
            <div><span style={{ color: '#6b7280' }}>Assigned to:</span> {event.assigned_to_name || '—'}</div>
            {event.project_title && <div><span style={{ color: '#6b7280' }}>Project:</span> {event.project_title}</div>}
            {event.is_adhoc ? <span className="badge badge-adhoc">Ad-hoc</span> : null}
          </>}

          {event.type === 'project' && <>
            <div><span style={{ color: '#6b7280' }}>Status:</span> {event.status}</div>
            <div><span style={{ color: '#6b7280' }}>Priority:</span> {event.priority}</div>
            <div style={{ marginTop: 8 }}>
              <Link to={`/projects/${event.id}`} style={{ color: '#2563eb', fontSize: 12, fontWeight: 600 }}>View Project →</Link>
            </div>
          </>}

          {event.type === 'maintenance' && <>
            <div><span style={{ color: '#6b7280' }}>Customer:</span> <strong>{event.customer_name}</strong></div>
            <div><span style={{ color: '#6b7280' }}>Engineer{event.engineer_names?.includes(',') ? 's' : ''}:</span> {event.engineer_names || '—'}</div>
            <div><span style={{ color: '#6b7280' }}>Status:</span> {event.status.replace('_', ' ')}</div>
            <div><span style={{ color: '#6b7280' }}>Report:</span> {event.report_sent
              ? <span style={{ color: 'var(--success)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }}><Check size={12} /> Sent</span>
              : <span style={{ color: 'var(--warning)', fontWeight: 700 }}>Pending</span>}</div>
            {!event.report_sent && event.status !== 'cancelled' && (
              <button className="btn btn-success btn-sm"
                style={{ marginTop: 8, alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                onClick={markSent}>
                <Check size={13} /> Mark Report Sent
              </button>
            )}
          </>}
        </div>
      </div>
    </div>
  );
}

/* ── iCal Subscription Box ───────────────────────────────── */
function ICalSubscribe() {
  const [copied, setCopied] = useState(false);
  const token = localStorage.getItem('token') || '';
  const icalUrl = `${window.location.origin}/api/calendar/ical?token=${token}`;

  function copyUrl() {
    navigator.clipboard.writeText(icalUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // Fallback for browsers without clipboard API
      const el = document.createElement('textarea');
      el.value = icalUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div style={{ marginTop: 20, padding: '14px 18px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <Link2 size={18} color="#0284c7" style={{ flexShrink: 0, marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: '#0c4a6e', marginBottom: 4 }}>
          Subscribe to your calendar (iCal)
        </div>
        <p style={{ margin: '0 0 8px', fontSize: 12, color: '#0369a1' }}>
          Add this URL to Google Calendar, Outlook, Apple Calendar or any iCal-compatible app to see your tasks and visits automatically update.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            readOnly
            value={icalUrl}
            style={{ flex: 1, minWidth: 200, fontSize: 11, padding: '4px 8px', border: '1px solid #bae6fd', borderRadius: 4, background: '#fff', color: '#0369a1', fontFamily: 'monospace' }}
            onClick={e => e.target.select()}
          />
          <button
            className="btn btn-sm"
            onClick={copyUrl}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: copied ? '#10b981' : '#0284c7', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600, transition: 'background .2s', flexShrink: 0 }}
          >
            <Copy size={12} /> {copied ? 'Copied!' : 'Copy URL'}
          </button>
        </div>
        <p style={{ margin: '6px 0 0', fontSize: 11, color: '#7dd3fc' }}>
          ⚠️ Keep this URL private — it contains your login token. Regenerate it by logging out and back in.
        </p>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════ */
/* ── MAIN PAGE ───────────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */
export default function CalendarPage() {
  const { user } = useAuth();
  const isManagerOrPlanner = user.role === 'manager' || user.role === 'planner';

  const now = new Date();
  const [year,    setYear]    = useState(now.getFullYear());
  const [month,   setMonth]   = useState(now.getMonth()); // 0-indexed
  const [data,    setData]    = useState({ tasks: [], projects: [], visits: [] });
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({ task: true, project: true, maintenance: true });
  const [loading, setLoading] = useState(true);

  // New-visit modal state
  const [newVisitDate, setNewVisitDate] = useState(null); // null = closed, string = open with prefill

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, date }

  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

  const load = useCallback(() => {
    setLoading(true);
    api.calendar(monthStr).then(d => { setData(d); setLoading(false); });
  }, [monthStr]);

  useEffect(() => { load(); }, [load]);

  // Close context menu on scroll
  useEffect(() => {
    const close = () => setCtxMenu(null);
    window.addEventListener('scroll', close, true);
    return () => window.removeEventListener('scroll', close, true);
  }, []);

  function prevMonth() { if (month === 0) { setYear(y => y - 1); setMonth(11); } else setMonth(m => m - 1); }
  function nextMonth() { if (month === 11) { setYear(y => y + 1); setMonth(0); } else setMonth(m => m + 1); }
  function goToday()   { setYear(now.getFullYear()); setMonth(now.getMonth()); }

  // Calendar grid — week starts Monday
  const firstDay    = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  // Index events by date string
  const allEvents = [
    ...(filters.task        ? data.tasks   : []),
    ...(filters.project     ? data.projects : []),
    ...(filters.maintenance ? data.visits   : []),
  ];
  const byDay = {};
  allEvents.forEach(e => {
    const d = (e.date || '').slice(0, 10);
    if (!byDay[d]) byDay[d] = [];
    byDay[d].push(e);
  });

  const todayStr = now.toISOString().slice(0, 10);

  const upcoming = allEvents
    .filter(e => (e.date || '') >= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 20);

  // ── Handlers ────────────────────────────────────────────
  function openNewVisit(dateStr) {
    setCtxMenu(null);
    setNewVisitDate(dateStr);
  }

  function handleCellDoubleClick(dateStr) {
    if (!isManagerOrPlanner || !dateStr) return;
    openNewVisit(dateStr);
  }

  function handleCellContextMenu(e, dateStr) {
    if (!isManagerOrPlanner || !dateStr) return;
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, date: dateStr });
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Calendar & Planner</h1>
        <div className="flex gap-8" style={{ alignItems: 'center' }}>
          {isManagerOrPlanner && (
            <button
              className="btn btn-primary btn-sm"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              onClick={() => openNewVisit(todayStr)}
            >
              <Plus size={14} /> New Visit
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={goToday}>Today</button>
          <button className="btn btn-ghost btn-sm" onClick={prevMonth} style={{ display: 'inline-flex', alignItems: 'center' }}><ChevronLeft size={16} /></button>
          <span style={{ fontWeight: 700, minWidth: 160, textAlign: 'center', fontSize: 15 }}>{MONTHS[month]} {year}</span>
          <button className="btn btn-ghost btn-sm" onClick={nextMonth} style={{ display: 'inline-flex', alignItems: 'center' }}><ChevronRight size={16} /></button>
        </div>
      </div>

      {/* Legend / filters */}
      <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {Object.entries(TYPE_STYLE).map(([type, s]) => (
          <label key={type} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
            <input type="checkbox" checked={filters[type]}
              onChange={() => setFilters(f => ({ ...f, [type]: !f[type] }))}
              style={{ width: 'auto' }} />
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: s.bg, border: `2px solid ${s.color}`, display: 'inline-block' }} />
              {s.label}
            </span>
          </label>
        ))}
        {isManagerOrPlanner && (
          <span style={{ fontSize: 11, color: 'var(--gray-400)', marginLeft: 4 }}>
            Double-click or right-click a day to add a visit
          </span>
        )}
        <span className="text-sm text-muted" style={{ marginLeft: 'auto' }}>
          {loading ? 'Loading…' : `${allEvents.length} event${allEvents.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Grid + sidebar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 280px', gap: 16, alignItems: 'start' }}
           className="calendar-layout">

        {/* Calendar grid */}
        <div className="card" style={{ padding: 0, overflow: 'hidden', minWidth: 0 }}>
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <div style={{ minWidth: 420 }}>

              {/* Day headers */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-200)' }}>
                {DAYS.map(d => (
                  <div key={d} style={{ textAlign: 'center', padding: '8px 4px', fontSize: 11, fontWeight: 700, color: 'var(--gray-600)', textTransform: 'uppercase' }}>{d}</div>
                ))}
              </div>

              {/* Day cells */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)' }}>
                {cells.map((day, idx) => {
                  const dateStr  = day ? `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null;
                  const events   = dateStr ? (byDay[dateStr] || []) : [];
                  const isToday  = dateStr === todayStr;
                  const isWeekend = idx % 7 === 5 || idx % 7 === 6;
                  const isPast   = dateStr && dateStr < todayStr;
                  const canCreate = isManagerOrPlanner && !!dateStr;

                  return (
                    <div
                      key={idx}
                      onDoubleClick={() => handleCellDoubleClick(dateStr)}
                      onContextMenu={e => handleCellContextMenu(e, dateStr)}
                      style={{
                        minHeight: 80, padding: '4px 4px 4px 6px',
                        borderRight: '1px solid var(--gray-100)',
                        borderBottom: '1px solid var(--gray-100)',
                        background: !day
                          ? 'var(--gray-50)'
                          : isWeekend
                            ? '#fafafa'
                            : '#fff',
                        cursor: canCreate ? 'default' : undefined,
                        transition: 'background 0.1s',
                        position: 'relative',
                      }}
                      // Hover hint for managers/planners on active days
                      onMouseEnter={canCreate ? e => {
                        const addBtn = e.currentTarget.querySelector('.cal-add-btn');
                        if (addBtn) addBtn.style.opacity = '1';
                      } : undefined}
                      onMouseLeave={canCreate ? e => {
                        const addBtn = e.currentTarget.querySelector('.cal-add-btn');
                        if (addBtn) addBtn.style.opacity = '0';
                      } : undefined}
                    >
                      {day && (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                            <div style={{
                              fontSize: 12, fontWeight: isToday ? 800 : 500,
                              color: isToday ? '#fff' : isWeekend ? 'var(--gray-400)' : isPast ? 'var(--gray-400)' : 'var(--gray-700)',
                              background: isToday ? 'var(--primary)' : 'transparent',
                              width: 22, height: 22, borderRadius: '50%',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>{day}</div>

                            {/* Hover quick-add button */}
                            {canCreate && (
                              <button
                                className="cal-add-btn"
                                onClick={e => { e.stopPropagation(); openNewVisit(dateStr); }}
                                title={`Add visit on ${fmtDate(dateStr)}`}
                                style={{
                                  opacity: 0, transition: 'opacity 0.15s',
                                  width: 18, height: 18, borderRadius: 4,
                                  background: '#fef3c7', border: '1px solid #fcd34d',
                                  cursor: 'pointer', display: 'flex', alignItems: 'center',
                                  justifyContent: 'center', padding: 0, flexShrink: 0,
                                }}
                              >
                                <Plus size={10} color="#b45309" />
                              </button>
                            )}
                          </div>

                          {events.slice(0, 3).map((e, i) => (
                            <EventChip key={i} event={e} onClick={setSelected} />
                          ))}
                          {events.length > 3 && (
                            <div style={{ fontSize: 10, color: 'var(--gray-400)', fontWeight: 600, paddingLeft: 4 }}>
                              +{events.length - 3} more
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div>
          <div className="card">
            <div className="section-title">Upcoming This Month</div>
            {upcoming.length === 0
              ? <p className="text-muted text-sm">Nothing coming up</p>
              : <ul style={{ listStyle: 'none' }}>
                  {upcoming.map((e, i) => {
                    const s = TYPE_STYLE[e.type];
                    return (
                      <li key={i} onClick={() => setSelected(e)} style={{
                        display: 'flex', gap: 10, padding: '9px 0',
                        borderBottom: i < upcoming.length - 1 ? '1px solid var(--gray-100)' : 'none',
                        cursor: 'pointer', alignItems: 'flex-start',
                      }}>
                        <div style={{ width: 4, borderRadius: 2, background: s.color, flexShrink: 0, alignSelf: 'stretch', minHeight: 20 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 5 }}>
                            <s.Icon size={12} color={s.color} /> {e.title || e.customer_name}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 1 }}>
                            {fmtDate(e.date)} · <span style={{ color: s.color }}>{s.label}</span>
                            {e.type === 'maintenance' && e.engineer_names && ` · ${e.engineer_names}`}
                            {e.type === 'task'        && e.assigned_to_name && ` · ${e.assigned_to_name}`}
                          </div>
                        </div>
                        {e.type === 'maintenance' && (
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 99,
                            background: e.report_sent ? '#dcfce7' : '#fef3c7',
                            color: e.report_sent ? '#166534' : '#92400e',
                            flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 3,
                          }}>
                            {e.report_sent ? <><Check size={9} /> Sent</> : 'Report due'}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
            }
          </div>

          {/* Month summary */}
          <div className="card" style={{ marginTop: 16 }}>
            <div className="section-title">Month Summary</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Object.entries(TYPE_STYLE).map(([type, s]) => {
                const count = allEvents.filter(e => e.type === type).length;
                return (
                  <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, flex: 1 }}>{s.label}s</span>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{count}</span>
                  </div>
                );
              })}
              <div style={{ borderTop: '1px solid var(--gray-100)', paddingTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span>MV Reports Pending</span>
                <span style={{
                  fontWeight: 700,
                  color: data.visits.filter(v => !v.report_sent && v.status !== 'cancelled').length > 0
                    ? 'var(--warning)' : 'var(--success)',
                }}>
                  {data.visits.filter(v => !v.report_sent && v.status !== 'cancelled').length}
                </span>
              </div>
            </div>
          </div>

          {/* Quick-add hint for managers/planners */}
          {isManagerOrPlanner && (
            <div style={{ marginTop: 12, padding: '10px 14px', background: '#fef3c7', borderRadius: 8, border: '1px solid #fcd34d' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#92400e', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 5 }}>
                <Wrench size={12} /> Quick-add visits
              </div>
              <div style={{ fontSize: 11, color: '#b45309', lineHeight: 1.5 }}>
                <strong>Double-click</strong> any day, or <strong>right-click</strong> for a context menu. The date is pre-filled automatically.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Event detail popover */}
      {selected && (
        <EventPopover
          event={selected}
          onClose={() => setSelected(null)}
          onReportSent={() => load()}
        />
      )}

      {/* New visit modal */}
      {newVisitDate !== null && (
        <NewVisitModal
          prefillDate={newVisitDate}
          onClose={() => setNewVisitDate(null)}
          onCreated={() => { load(); setNewVisitDate(null); }}
        />
      )}

      {/* Context menu */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          date={ctxMenu.date}
          onNewVisit={() => openNewVisit(ctxMenu.date)}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* iCal subscription */}
      <ICalSubscribe />
    </div>
  );
}
