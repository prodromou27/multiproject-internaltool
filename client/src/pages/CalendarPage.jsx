import { useEffect, useState, useCallback } from 'react';
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
        <div className="flex gap-8 u-7c61974">
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
          <span className="u-0a19537">{MONTHS[month]} {year}</span>
          <button className="btn btn-ghost btn-sm inline-flex items-center" onClick={nextMonth} aria-label="Next month" disabled={rescheduling || year === 9998 && month === 11}><ChevronRight size={16} /></button>
        </div>
      </>} />

      {/* Legend / filters */}
      <div className="card u-0027766">
        <div className="flex gap-8" aria-label="Calendar view">
          <button className="btn btn-ghost btn-sm" aria-pressed={view === 'month'} onClick={() => setView('month')}>Month</button>
          <button className="btn btn-ghost btn-sm" aria-pressed={view === 'agenda'} onClick={() => setView('agenda')}>Agenda</button>
        </div>
        {Object.entries(TYPE_STYLE).filter(([type]) => type !== 'follow_up' || data.service_enabled).map(([type, s]) => (
          <label key={type} className="u-833078c">
            <input type="checkbox" checked={filters[type]}
              onChange={() => setFilters(f => ({ ...f, [type]: !f[type] }))}
              className="u-30e741d" />
            <span className="flex-center gap-4">
              <span className="u-e88c2cd" style={{ background: s.bg, border: `2px solid ${s.color}` }} />
              {s.label}
            </span>
          </label>
        ))}
        {isManagerOrPlanner && (
          <span className="u-d54cbbe">
            Double-click or right-click a day to add a visit
          </span>
        )}
        <span className="text-sm text-muted u-6d00061">
          {loading ? 'Loading…' : `${allEvents.length} event${allEvents.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      {loadError && <div className="error-msg mb-16" role="alert">
        {loadError} <button className="btn btn-ghost btn-sm" onClick={load}>Retry</button>
      </div>}
      {rescheduling && <p role="status">Saving schedule change...</p>}
      {/* Grid + sidebar */}
      <div
           className="calendar-layout u-9ffa1bc">

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
        </section> : <div className="card u-d9a680c">
          <div className="u-54fa031">
            <div className="u-dd18a4b">

              {/* Day headers */}
              <div className="u-bde406d">
                {DAYS.map(d => (
                  <div key={d} className="u-36b0f90">{d}</div>
                ))}
              </div>

              {/* Day cells */}
              <div className="u-bb6ec00">
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
                      className="u-5aec1b0" style={{ background: dragOverDate === dateStr
                          ? 'var(--primary-light)'
                          : !day
                          ? 'var(--gray-50)'
                          : isWeekend
                            ? 'var(--gray-50)'
                            : 'var(--surface)', cursor: canCreate ? 'default' : undefined }}
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
                          <div className="u-41edc4d">
                            <div className="u-3d88300" style={{ fontWeight: isToday ? 800 : 500, color: isToday ? '#fff' : isWeekend ? 'var(--gray-400)' : isPast ? 'var(--gray-400)' : 'var(--gray-700)', background: isToday ? 'var(--primary)' : 'transparent' }}>{day}</div>

                            {/* Hover quick-add button */}
                            {canCreate && (
                              <button
                                className="cal-add-btn u-2ffb3da"
                                onClick={e => { e.stopPropagation(); openNewVisit(dateStr); }}
                                title={`Add visit on ${fmtDate(dateStr)}`}
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
                            <button type="button" className="btn btn-ghost btn-sm u-93c3810" onClick={() => setView('agenda')}>
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
                      <li key={i} role="button" tabIndex={0} onKeyDown={key => { if (key.key === 'Enter' || key.key === ' ') { key.preventDefault(); setSelected(e); } }} onClick={() => setSelected(e)} className="u-edd5c49" style={{ borderBottom: i < upcoming.length - 1 ? '1px solid var(--gray-100)' : 'none' }}>
                        <div className="u-a49b816" style={{ background: s.color }} />
                        <div className="flex-1 min-w-0">
                          <div className="u-7cf7897">
                            <s.Icon size={12} color={s.color} /> {e.title || e.customer_name}
                          </div>
                          <div className="u-ed87168">
                            {fmtDate(e.date)} · <span style={{ color: s.color }}>{s.label}</span>
                            {e.type === 'maintenance' && e.engineer_names && ` · ${e.engineer_names}`}
                            {e.type === 'task'        && e.assigned_to_name && ` · ${e.assigned_to_name}`}
                          </div>
                        </div>
                        {e.type === 'maintenance' && (
                          <span className="u-453609b" style={{ background: e.report_sent ? '#dcfce7' : '#fef3c7', color: e.report_sent ? '#166534' : '#92400e' }}>
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
                    <span className="u-68bde25" style={{ background: s.color }} />
                    <span className="u-b2c58d1">{s.label}s</span>
                    <span className="u-4aaa243">{count}</span>
                  </div>
                );
              })}
              <div className="u-8a5ad38">
                <span>MV Reports Pending</span>
                <span className="u-e3ec02a" style={{ color: (data.reports || []).length > 0
                    ? 'var(--warning)' : 'var(--success)' }}>
                  {(data.reports || []).length}
                </span>
              </div>
            </div>
          </div>

          {/* Quick-add hint for managers/planners */}
          {isManagerOrPlanner && (
            <div className="u-3283afa">
              <div className="u-564a954">
                <Wrench size={12} /> Quick-add visits
              </div>
              <div className="u-4cbb9b1">
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
