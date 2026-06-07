import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, CheckSquare, Wrench, Clock, ChevronDown, ChevronUp,
  RefreshCw, AlertTriangle, CalendarDays,
} from 'lucide-react';
import { api } from '../api';
import { StatusBadge, PriorityBadge, fmtDate, isOverdue } from '../components/Shared';

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function workloadColor(count) {
  if (count === 0) return 'var(--success)';
  if (count <= 3)  return 'var(--primary)';
  if (count <= 6)  return 'var(--warning)';
  return 'var(--danger)';
}

function workloadBg(count) {
  if (count === 0) return '#f0fdf4';
  if (count <= 3)  return '#eff6ff';
  if (count <= 6)  return '#fffbeb';
  return '#fef2f2';
}

function workloadLabel(count) {
  if (count === 0) return 'Free';
  if (count <= 3)  return 'Light';
  if (count <= 6)  return 'Moderate';
  return 'Heavy';
}

/* ── Snapshot: Engineer Card ──────────────────────────────── */
function EngineerCard({ eng }) {
  const [expanded, setExpanded] = useState(false);
  const taskCount  = eng.open_tasks.length;
  const visitCount = eng.visits.length;
  const initials   = eng.name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="card" style={{ marginBottom: 14, transition: 'box-shadow .15s' }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        {/* Avatar */}
        <div style={{
          width: 44, height: 44, borderRadius: '50%',
          background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 800, color: '#fff', flexShrink: 0,
        }}>{initials}</div>

        {/* Name + email */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{eng.name}</div>
          <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>{eng.email}</div>
        </div>

        {/* Stat pills */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <Pill icon={<CheckSquare size={13} />} value={taskCount} label="open tasks" color={workloadColor(taskCount)} />
          <Pill icon={<Wrench size={13} />}       value={visitCount} label="visits" color={visitCount > 0 ? 'var(--warning)' : 'var(--gray-400)'} />
          <Pill icon={<Clock size={13} />}         value={`${eng.hours_this_month}h`} label="this month" color="#0891b2" />
          <Pill icon={<CheckSquare size={13} />}   value={eng.done_this_month} label="done this month" color="var(--success)" />
        </div>

        <button
          onClick={() => setExpanded(e => !e)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-400)', display: 'flex', alignItems: 'center', padding: 4 }}
        >
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="grid-2" style={{ marginTop: 16, gap: 16 }}>
          {/* Open tasks */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
              Open Tasks ({taskCount})
            </div>
            {taskCount === 0
              ? <p className="text-muted text-sm">No open tasks 🎉</p>
              : <ul style={{ listStyle: 'none' }}>
                  {eng.open_tasks.map(t => (
                    <li key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid var(--gray-50)' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {t.project_title && (
                            <span style={{ fontSize: 10, color: 'var(--gray-400)', marginRight: 5 }}>
                              {t.project_title} ›
                            </span>
                          )}
                          {t.title}
                        </div>
                        {t.deadline && (
                          <div style={{ fontSize: 11, marginTop: 1 }}>
                            <span className={isOverdue(t.deadline) ? 'overdue' : 'text-muted'}>
                              {isOverdue(t.deadline) && <AlertTriangle size={10} style={{ marginRight: 3 }} />}
                              Due {fmtDate(t.deadline)}
                            </span>
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        <StatusBadge s={t.status} />
                        <PriorityBadge p={t.priority} />
                      </div>
                    </li>
                  ))}
                </ul>
            }
          </div>

          {/* Upcoming visits */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
              Upcoming Visits ({visitCount})
            </div>
            {visitCount === 0
              ? <p className="text-muted text-sm">No scheduled visits</p>
              : <ul style={{ listStyle: 'none' }}>
                  {eng.visits.map(v => (
                    <li key={v.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid var(--gray-50)' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {v.customer_name} · {v.title}
                        </div>
                        <div style={{ fontSize: 11, marginTop: 1 }}>
                          <span className={isOverdue(v.scheduled_date) ? 'overdue' : 'text-muted'}>
                            {fmtDate(v.scheduled_date)}
                          </span>
                        </div>
                      </div>
                      <StatusBadge s={v.status} />
                    </li>
                  ))}
                </ul>
            }
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Forecast: Week Cell ──────────────────────────────────── */
function WeekCell({ week, engName }) {
  const [open, setOpen] = useState(false);
  const total = week.total;
  const color = workloadColor(total);
  const bg    = workloadBg(total);

  return (
    <div
      style={{
        background: bg, border: `1.5px solid ${color}30`,
        borderRadius: 8, padding: '8px 10px', cursor: total > 0 ? 'pointer' : 'default',
        position: 'relative', minHeight: 64,
      }}
      onClick={() => total > 0 && setOpen(o => !o)}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 18, fontWeight: 800, color }}>{total}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '.04em' }}>
          {workloadLabel(total)}
        </span>
      </div>
      {week.tasks.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--gray-500)', display: 'flex', alignItems: 'center', gap: 3 }}>
          <CheckSquare size={10} /> {week.tasks.length} task{week.tasks.length !== 1 ? 's' : ''}
        </div>
      )}
      {week.visits.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--gray-500)', display: 'flex', alignItems: 'center', gap: 3 }}>
          <Wrench size={10} /> {week.visits.length} visit{week.visits.length !== 1 ? 's' : ''}
        </div>
      )}

      {/* Expanded tooltip */}
      {open && total > 0 && (
        <div
          style={{
            position: 'absolute', top: '100%', left: 0, zIndex: 50, minWidth: 220, maxWidth: 280,
            background: '#fff', border: '1px solid var(--gray-100)', borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,.12)', padding: '10px 12px', marginTop: 4,
          }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ fontWeight: 700, fontSize: 12, color: '#374151', marginBottom: 6 }}>
            {engName} · {week.label}
          </div>
          {week.tasks.map(t => (
            <div key={t.id} style={{ fontSize: 11, padding: '3px 0', borderBottom: '1px solid var(--gray-50)', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              <CheckSquare size={10} style={{ color: 'var(--primary)', flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontWeight: 500 }}>{t.title}</div>
                {t.project_title && <div style={{ color: 'var(--gray-400)' }}>{t.project_title}</div>}
                {t.deadline && <div style={{ color: isOverdue(t.deadline) ? 'var(--danger)' : 'var(--gray-400)' }}>Due {fmtDate(t.deadline)}</div>}
              </div>
            </div>
          ))}
          {week.visits.map(v => (
            <div key={v.id} style={{ fontSize: 11, padding: '3px 0', borderBottom: '1px solid var(--gray-50)', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              <Wrench size={10} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontWeight: 500 }}>{v.title}</div>
                <div style={{ color: 'var(--gray-400)' }}>{v.customer_name} · {fmtDate(v.scheduled_date)}</div>
              </div>
            </div>
          ))}
          <button
            style={{ marginTop: 6, fontSize: 11, color: 'var(--gray-400)', background: 'none', border: 'none', cursor: 'pointer' }}
            onClick={() => setOpen(false)}
          >Close ✕</button>
        </div>
      )}
    </div>
  );
}

/* ── Forecast Grid ────────────────────────────────────────── */
function ForecastGrid({ forecast, loading }) {
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--gray-400)', padding: '24px 0' }}>
      <RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} /> Loading forecast…
    </div>
  );

  if (!forecast.length) return (
    <div className="empty">
      <div className="empty-icon"><CalendarDays size={40} strokeWidth={1.2} /></div>
      <p>No engineers found</p>
    </div>
  );

  // Extract week labels/ranges from first engineer
  const weeks = forecast[0]?.weeks ?? [];

  return (
    <div>
      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 14, fontSize: 11 }}>
        {[
          { label: 'Free (0)', color: 'var(--success)', bg: '#f0fdf4' },
          { label: 'Light (1-3)', color: 'var(--primary)', bg: '#eff6ff' },
          { label: 'Moderate (4-6)', color: 'var(--warning)', bg: '#fffbeb' },
          { label: 'Heavy (7+)', color: 'var(--danger)', bg: '#fef2f2' },
        ].map(l => (
          <span key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: l.bg, border: `1.5px solid ${l.color}40`, display: 'inline-block' }} />
            <span style={{ color: 'var(--gray-500)' }}>{l.label}</span>
          </span>
        ))}
        <span style={{ color: 'var(--gray-400)', marginLeft: 4 }}>· Click a cell to see details</span>
      </div>

      {/* Responsive table-like grid */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 6px', minWidth: 560 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '6px 12px', fontSize: 12, color: 'var(--gray-500)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', width: 180, background: 'none', border: 'none' }}>
                Engineer
              </th>
              {weeks.map((w, i) => (
                <th key={i} style={{ textAlign: 'center', padding: '6px 8px', fontSize: 12, color: 'var(--gray-500)', fontWeight: 700, background: 'none', border: 'none' }}>
                  <div style={{ fontWeight: 700, color: '#374151' }}>{w.label}</div>
                  <div style={{ fontSize: 10, color: 'var(--gray-400)', fontWeight: 400 }}>{w.date_range}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {forecast.map(eng => (
              <tr key={eng.id}>
                <td style={{ padding: '4px 12px 4px 0', verticalAlign: 'middle' }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{eng.name}</div>
                </td>
                {eng.weeks.map((w, i) => (
                  <td key={i} style={{ padding: '4px 5px', verticalAlign: 'top' }}>
                    <WeekCell week={w} engName={eng.name} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Total row */}
      <div className="card" style={{ marginTop: 16, padding: '12px 16px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 8 }}>Team Totals per Week</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {weeks.map((w, i) => {
            const total = forecast.reduce((s, eng) => s + (eng.weeks[i]?.total ?? 0), 0);
            const tasks = forecast.reduce((s, eng) => s + (eng.weeks[i]?.tasks.length ?? 0), 0);
            const visits = forecast.reduce((s, eng) => s + (eng.weeks[i]?.visits.length ?? 0), 0);
            return (
              <div key={i} style={{ background: workloadBg(Math.ceil(total / Math.max(forecast.length, 1))), borderRadius: 8, padding: '8px 14px', flex: 1, minWidth: 100, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--gray-400)', fontWeight: 600 }}>{w.label}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: workloadColor(Math.ceil(total / Math.max(forecast.length, 1))) }}>{total}</div>
                <div style={{ fontSize: 10, color: 'var(--gray-400)' }}>{tasks}t · {visits}v</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Pill({ icon, value, label, color }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 5,
      background: 'var(--gray-50)', border: '1px solid var(--gray-100)',
      borderRadius: 8, padding: '4px 10px',
    }}>
      <span style={{ color }}>{icon}</span>
      <span style={{ fontSize: 14, fontWeight: 800, color }}>{value}</span>
      <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>{label}</span>
    </div>
  );
}

export default function Workload() {
  const [tab,        setTab]        = useState('snapshot');
  const [engineers,  setEngineers]  = useState([]);
  const [forecast,   setForecast]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [fLoading,   setFLoading]   = useState(false);
  const [error,      setError]      = useState('');
  const now = new Date();
  const monthLabel = `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;

  const loadSnapshot = () => {
    setLoading(true); setError('');
    api.workload()
      .then(d => { setEngineers(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  };

  const loadForecast = () => {
    setFLoading(true);
    api.workloadForecast()
      .then(d => { setForecast(d); setFLoading(false); })
      .catch(e => { setError(e.message); setFLoading(false); });
  };

  useEffect(() => { loadSnapshot(); }, []);

  useEffect(() => {
    if (tab === 'forecast' && forecast.length === 0) loadForecast();
  }, [tab]);

  const totalOpenTasks  = engineers.reduce((s, e) => s + e.open_tasks.length, 0);
  const totalVisits     = engineers.reduce((s, e) => s + e.visits.length, 0);
  const totalHours      = engineers.reduce((s, e) => s + e.hours_this_month, 0);
  const overdueCount    = engineers.reduce((s, e) => s + e.open_tasks.filter(t => isOverdue(t.deadline)).length, 0);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Users size={20} /> Engineer Workload
          </h1>
          <div className="page-subtitle">Live snapshot of all engineers — {monthLabel}</div>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => tab === 'snapshot' ? loadSnapshot() : loadForecast()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {error && <div className="alert alert-warning" style={{ marginBottom: 16 }}>{error}</div>}

      {/* Summary bar */}
      {!loading && (
        <div className="grid-4" style={{ marginBottom: 20 }}>
          <div className="card stat">
            <div className="stat-value" style={{ color: 'var(--primary)' }}>{engineers.length}</div>
            <div className="stat-label">Engineers</div>
          </div>
          <div className="card stat">
            <div className="stat-value" style={{ color: workloadColor(totalOpenTasks) }}>{totalOpenTasks}</div>
            <div className="stat-label">Open Tasks</div>
          </div>
          <div className="card stat">
            <div className="stat-value" style={{ color: 'var(--warning)' }}>{totalVisits}</div>
            <div className="stat-label">Scheduled Visits</div>
          </div>
          <div className="card stat">
            <div className="stat-value" style={{ color: overdueCount > 0 ? 'var(--danger)' : 'var(--success)' }}>
              {overdueCount}
            </div>
            <div className="stat-label">Overdue Tasks</div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="tabs" style={{ marginBottom: 16 }}>
        <button className={'tab' + (tab === 'snapshot' ? ' active' : '')} onClick={() => setTab('snapshot')}>
          <Users size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />Current Snapshot
        </button>
        <button className={'tab' + (tab === 'forecast' ? ' active' : '')} onClick={() => setTab('forecast')}>
          <CalendarDays size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />4-Week Forecast
        </button>
      </div>

      {/* Snapshot tab */}
      {tab === 'snapshot' && (
        loading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--gray-400)', padding: '24px 0' }}>
            <RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} /> Loading workload…
          </div>
        ) : engineers.length === 0 ? (
          <div className="empty"><div className="empty-icon"><Users size={40} strokeWidth={1.2} /></div><p>No engineers found</p></div>
        ) : (
          engineers.map(eng => <EngineerCard key={eng.id} eng={eng} />)
        )
      )}

      {/* Forecast tab */}
      {tab === 'forecast' && (
        <ForecastGrid forecast={forecast} loading={fLoading} />
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
