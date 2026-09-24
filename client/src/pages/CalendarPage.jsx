import React, { useEffect, useState, useCallback } from 'react';
import { Wrench, ChevronLeft, ChevronRight, Check, Plus } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../App';
import { fmtDate } from '../components/Shared';
import { useToast } from '../components/Toast';
import { localDateISO } from '../utils/dates';
import { PageHeader } from '../components/PageLayout';
import { DAYS, MONTHS, TYPE_STYLE } from './calendar/constants';
import NewVisitModal from './calendar/NewVisitModal';
import ContextMenu from './calendar/ContextMenu';
import EventChip from './calendar/EventChip';
import EventPopover from './calendar/EventPopover';
import ICalSubscribe from './calendar/ICalSubscribe';

/* ══════════════════════════════════════════════════════════ */
/* ── MAIN PAGE ───────────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */
export default function CalendarPage() {
  const { user } = useAuth();
  const toast = useToast();
  const isManagerOrPlanner = user.role === 'manager' || user.role === 'planner';

  const now = new Date();
  const [year,    setYear]    = useState(now.getFullYear());
  const [month,   setMonth]   = useState(now.getMonth()); // 0-indexed
  const [data,    setData]    = useState({ tasks: [], projects: [], visits: [] });
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({ task: true, project: true, maintenance: true, report: true, follow_up: true });
  const [view, setView] = useState('month');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [rescheduling, setRescheduling] = useState(false);
  const [draggedEvent, setDraggedEvent] = useState(null);
  const [dragOverDate, setDragOverDate] = useState(null);

  // New-visit modal state
  const [newVisitDate, setNewVisitDate] = useState(null); // null = closed, string = open with prefill

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, date }

  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

  const load = useCallback(() => setRefresh(value => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true); setLoadError(''); setSelected(null);
    setData({ tasks: [], projects: [], visits: [] });
    api.calendar(monthStr, { signal: controller.signal })
      .then(result => { if (active) setData(result); })
      .catch(error => { if (active && error.name !== 'AbortError') setLoadError(error.message || 'Could not load calendar'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [monthStr, refresh]);

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
    ...(filters.report ? (data.reports || []) : []),
    ...(filters.follow_up ? (data.followUps || []) : []),
  ];
  const byDay = {};
  allEvents.forEach(e => {
    const d = (e.date || '').slice(0, 10);
    if (!byDay[d]) byDay[d] = [];
    byDay[d].push(e);
  });

  const todayStr = localDateISO(now);

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

  function canReschedule(event) {
    if (rescheduling || loading || !['task', 'project', 'maintenance'].includes(event.type)) return false;
    if (event.type === 'project') return user.role === 'manager';
    if (event.type === 'maintenance') return user.role === 'manager' || user.role === 'planner';
    return user.role === 'manager' || (user.role === 'engineer' && event.assigned_to === user.id);
  }

  async function reschedule(event, date) {
    setDraggedEvent(null); setDragOverDate(null);
    if (!event || !date || event.date?.slice(0, 10) === date || !canReschedule(event)) return;
    setRescheduling(true);
    const bucket = event.type === 'task' ? 'tasks' : event.type === 'project' ? 'projects' : 'visits';
    setData(current => ({ ...current, [bucket]: current[bucket].map(item => item.id === event.id ? { ...item, date } : item) }));
    try {
      if (event.type === 'task') await api.updateTask(event.id, { deadline: date });
      else if (event.type === 'project') await api.updateProject(event.id, { deadline: date });
      else await api.updateVisit(event.id, { scheduled_date: date });
      toast.success(`Rescheduled to ${fmtDate(date)}`);
    } catch (error) {
      load();
      toast.error(error.message || 'Could not reschedule event');
    } finally {
      setRescheduling(false);
    }
  }

  return (
    <div className="page">
      <PageHeader title="Calendar & Planner" description="Plan deadlines, visits, pending reports and service follow-ups." actions={<>
        <div className="flex gap-8" style={{ alignItems: 'center' }}>
          {isManagerOrPlanner && (
            <button
              className="btn btn-primary btn-sm inline-flex items-center gap-6"
             
              onClick={() => openNewVisit(todayStr)}
            >
              <Plus size={14} /> New Visit
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={goToday} disabled={rescheduling}>Today</button>
          <button className="btn btn-ghost btn-sm inline-flex items-center" onClick={prevMonth} aria-label="Previous month" disabled={rescheduling || year === 1900 && month === 0}><ChevronLeft size={16} /></button>
          <span style={{ fontWeight: 700, minWidth: 160, textAlign: 'center', fontSize: 15 }}>{MONTHS[month]} {year}</span>
          <button className="btn btn-ghost btn-sm inline-flex items-center" onClick={nextMonth} aria-label="Next month" disabled={rescheduling || year === 9998 && month === 11}><ChevronRight size={16} /></button>
        </div>
      </>} />

      {/* Legend / filters */}
      <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="flex gap-8" aria-label="Calendar view">
          <button className="btn btn-ghost btn-sm" aria-pressed={view === 'month'} onClick={() => setView('month')}>Month</button>
          <button className="btn btn-ghost btn-sm" aria-pressed={view === 'agenda'} onClick={() => setView('agenda')}>Agenda</button>
        </div>
        {Object.entries(TYPE_STYLE).filter(([type]) => type !== 'follow_up' || data.service_enabled).map(([type, s]) => (
          <label key={type} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
            <input type="checkbox" checked={filters[type]}
              onChange={() => setFilters(f => ({ ...f, [type]: !f[type] }))}
              style={{ width: 'auto' }} />
            <span className="flex-center gap-4">
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

      {loadError && <div className="error-msg mb-16" role="alert">
        {loadError} <button className="btn btn-ghost btn-sm" onClick={load}>Retry</button>
      </div>}
      {rescheduling && <p role="status">Saving schedule change...</p>}
      {/* Grid + sidebar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 280px', gap: 16, alignItems: 'start' }}
           className="calendar-layout">

        {view === 'agenda' ? <section className="card" aria-label="Month agenda">
          <h2 className="section-title">{MONTHS[month]} agenda</h2>
          {loading ? <p role="status">Loading agenda...</p> : loadError ? <p>Agenda unavailable. Retry loading this month.</p> : allEvents.length === 0 ? <p>No events match the selected filters.</p> :
            <ul className="calendar-agenda">
              {[...allEvents].sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type) || a.id - b.id).map(event => {
                const style = TYPE_STYLE[event.type];
                return <li key={`${event.type}:${event.id}`}>
                  <button type="button" onClick={() => setSelected(event)}>
                    <style.Icon size={18} color={style.color} />
                    <span><strong>{event.title}</strong><small>{style.label}{event.type === 'report' ? ' - Visit date' : ''}: {fmtDate(event.date)}</small></span>
                  </button>
                </li>;
              })}
            </ul>}
        </section> : <div className="card" style={{ padding: 0, overflow: 'hidden', minWidth: 0 }}>
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <div style={{ minWidth: 420 }}>

              {/* Day headers */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,minmax(0,1fr))', background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-200)' }}>
                {DAYS.map(d => (
                  <div key={d} style={{ textAlign: 'center', padding: '8px 4px', fontSize: 11, fontWeight: 700, color: 'var(--gray-600)', textTransform: 'uppercase' }}>{d}</div>
                ))}
              </div>

              {/* Day cells */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,minmax(0,1fr))' }}>
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
                      onDragOver={dateStr ? e => { e.preventDefault(); setDragOverDate(dateStr); } : undefined}
                      onDragLeave={() => setDragOverDate(null)}
                      onDrop={dateStr ? e => { e.preventDefault(); reschedule(draggedEvent, dateStr); } : undefined}
                      style={{
                        minHeight: 80, padding: '4px 4px 4px 6px',
                        borderRight: '1px solid var(--gray-100)',
                        borderBottom: '1px solid var(--gray-100)',
                        background: dragOverDate === dateStr
                          ? 'var(--primary-light)'
                          : !day
                          ? 'var(--gray-50)'
                          : isWeekend
                            ? 'var(--gray-50)'
                            : 'var(--surface)',
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
                                  background: 'var(--warning-light)', border: '1px solid #fcd34d',
                                  cursor: 'pointer', display: 'flex', alignItems: 'center',
                                  justifyContent: 'center', padding: 0, flexShrink: 0,
                                }}
                              >
                                <Plus size={10} color="#b45309" />
                              </button>
                            )}
                          </div>

                          {events.slice(0, 3).map((e, i) => (
                            <EventChip key={i} event={e} onClick={setSelected}
                              draggable={canReschedule(e)}
                              onDragStart={(event, dragEvent) => {
                                setDraggedEvent(event);
                                dragEvent.dataTransfer.effectAllowed = 'move';
                                dragEvent.dataTransfer.setData('text/plain', `${event.type}:${event.id}`);
                              }} />
                          ))}
                          {events.length > 3 && (
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setView('agenda')} style={{ fontSize: 10, color: 'var(--gray-400)', fontWeight: 600, paddingLeft: 4 }}>
                              +{events.length - 3} more
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

            </div>
          </div>
        </div>}

        {/* Sidebar */}
        <div>
          <div className="card">
            <div className="section-title">Upcoming This Month</div>
            {upcoming.length === 0
              ? <p className="text-muted text-sm">Nothing coming up</p>
              : <ul className="list-none">
                  {upcoming.map((e, i) => {
                    const s = TYPE_STYLE[e.type];
                    return (
                      <li key={i} role="button" tabIndex={0} onKeyDown={key => { if (key.key === 'Enter' || key.key === ' ') { key.preventDefault(); setSelected(e); } }} onClick={() => setSelected(e)} style={{
                        display: 'flex', gap: 10, padding: '9px 0',
                        borderBottom: i < upcoming.length - 1 ? '1px solid var(--gray-100)' : 'none',
                        cursor: 'pointer', alignItems: 'flex-start',
                      }}>
                        <div style={{ width: 4, borderRadius: 2, background: s.color, flexShrink: 0, alignSelf: 'stretch', minHeight: 20 }} />
                        <div className="flex-1 min-w-0">
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
                            {e.report_sent ? <><Check size={9} /> Sent</> : 'Report pending'}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
            }
          </div>

          {/* Month summary */}
          <div className="card mt-16">
            <div className="section-title">Month Summary</div>
            <div className="flex-col gap-8">
              {Object.entries(TYPE_STYLE).map(([type, s]) => {
                const count = allEvents.filter(e => e.type === type).length;
                return (
                  <div key={type} className="flex-center gap-8">
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
                  color: (data.reports || []).length > 0
                    ? 'var(--warning)' : 'var(--success)',
                }}>
                  {(data.reports || []).length}
                </span>
              </div>
            </div>
          </div>

          {/* Quick-add hint for managers/planners */}
          {isManagerOrPlanner && (
            <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--warning-light)', borderRadius: 8, border: '1px solid #fcd34d' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--tone-warning-text)', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 5 }}>
                <Wrench size={12} /> Quick-add visits
              </div>
              <div style={{ fontSize: 11, color: 'var(--tone-warning-text)', lineHeight: 1.5 }}>
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
