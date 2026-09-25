import { useEffect, useState } from 'react';
import {
  Users, CheckSquare, Wrench, Clock, ChevronDown, ChevronUp,
  RefreshCw, AlertTriangle, CalendarDays,
} from 'lucide-react';
import { api } from '../api';
import { StatusBadge, PriorityBadge, fmtDate, isOverdue } from '../components/Shared';
import WorkloadPlanning from '../components/WorkloadPlanning';
import WorkloadPressure from '../components/WorkloadPressure';

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
  if (count === 0) return 'No scheduled items';
  if (count <= 3)  return 'Low item count';
  if (count <= 6)  return 'Medium item count';
  return 'High item count';
}

/* ── Snapshot: Engineer Card ──────────────────────────────── */
function EngineerCard({ eng }) {
  const [expanded, setExpanded] = useState(false);
  const taskCount  = eng.open_tasks.length;
  const visitCount = eng.visits.length;
  const initials   = (eng.name || '?').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="card u-18ade94">
      {/* Header row */}
      <div className="u-f6c797b">
        {/* Avatar */}
        <div className="u-01f6fff">{initials}</div>

        {/* Name + email */}
        <div className="flex-1 min-w-0">
          <div className="u-0c7a14e">{eng.name}</div>
          <div className="u-d65cb71">{eng.email || '—'}</div>
        </div>

        {/* Stat pills */}
        <div className="u-00d4b9d">
          <Pill icon={<CheckSquare size={13} />} value={taskCount} label="open tasks" color={workloadColor(taskCount)} />
          <Pill icon={<Wrench size={13} />}       value={visitCount} label="visits" color={visitCount > 0 ? 'var(--warning)' : 'var(--gray-400)'} />
          <Pill icon={<Clock size={13} />}         value={`${eng.hours_this_month}h`} label="this month" color="#0891b2" />
          <Pill icon={<CheckSquare size={13} />}   value={eng.done_this_month} label="done this month" color="var(--success)" />
        </div>

        <button
          onClick={() => setExpanded(e => !e)}
          className="u-7dbf16b"
        >
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="grid-2 u-9576290">
          {/* Open tasks */}
          <div>
            <div className="u-a5d12e3">
              Open Tasks ({taskCount})
            </div>
            {taskCount === 0
              ? <p className="text-muted text-sm">No open tasks 🎉</p>
              : <ul className="list-none">
                  {eng.open_tasks.map(t => (
                    <li key={t.id} className="u-948367e">
                      <div className="flex-1 min-w-0">
                        <div className="u-1a8e724">
                          {t.project_title && (
                            <span className="u-06bf23a">
                              {t.project_title} ›
                            </span>
                          )}
                          {t.title}
                        </div>
                        {t.deadline && (
                          <div className="u-ac2b836">
                            <span className={isOverdue(t.deadline) ? 'overdue' : 'text-muted'}>
                              {isOverdue(t.deadline) && <AlertTriangle size={10} style={{ marginRight: 3 }} />}
                              Due {fmtDate(t.deadline)}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="u-0ddf6fa">
                        <StatusBadge entityType="task" s={t.status} />
                        <PriorityBadge p={t.priority} />
                      </div>
                    </li>
                  ))}
                </ul>
            }
          </div>

          {/* Upcoming visits */}
          <div>
            <div className="u-a5d12e3">
              Upcoming Visits ({visitCount})
            </div>
            {visitCount === 0
              ? <p className="text-muted text-sm">No scheduled visits</p>
              : <ul className="list-none">
                  {eng.visits.map(v => (
                    <li key={v.id} className="u-948367e">
                      <div className="flex-1 min-w-0">
                        <div className="u-1a8e724">
                          {v.customer_name} · {v.title}
                        </div>
                        <div className="u-ac2b836">
                          <span className={isOverdue(v.scheduled_date) ? 'overdue' : 'text-muted'}>
                            {fmtDate(v.scheduled_date)}
                          </span>
                        </div>
                      </div>
                      <StatusBadge entityType="visit" s={v.status} />
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
      className="u-e2b24ac" style={{ background: bg, border: `1.5px solid ${color}30`, cursor: total > 0 ? 'pointer' : 'default' }}
      onClick={() => total > 0 && setOpen(o => !o)}
    >
      <div className="u-89e98af">
        <span className="u-80b90e3" style={{ color }}>{total}</span>
        <span className="u-bc56f01" style={{ color }}>
          {workloadLabel(total)}
        </span>
      </div>
      {week.tasks.length > 0 && (
        <div className="u-dfd4b32">
          <CheckSquare size={10} /> {week.tasks.length} task{week.tasks.length !== 1 ? 's' : ''}
        </div>
      )}
      {week.visits.length > 0 && (
        <div className="u-dfd4b32">
          <Wrench size={10} /> {week.visits.length} visit{week.visits.length !== 1 ? 's' : ''}
        </div>
      )}

      {/* Expanded tooltip */}
      {open && total > 0 && (
        <div
          className="u-58b9d9d"
          onClick={e => e.stopPropagation()}
        >
          <div className="u-959b18a">
            {engName} · {week.label}
          </div>
          {week.tasks.map(t => (
            <div key={t.id} className="u-25c47f7">
              <CheckSquare size={10} style={{ color: 'var(--primary)', flexShrink: 0, marginTop: 2 }} />
              <div>
                <div className="font-medium">{t.title}</div>
                {t.project_title && <div className="u-1e2ea2c">{t.project_title}</div>}
                {t.deadline && <div style={{ color: isOverdue(t.deadline) ? 'var(--danger)' : 'var(--gray-400)' }}>Due {fmtDate(t.deadline)}</div>}
              </div>
            </div>
          ))}
          {week.visits.map(v => (
            <div key={v.id} className="u-25c47f7">
              <Wrench size={10} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }} />
              <div>
                <div className="font-medium">{v.title}</div>
                <div className="u-1e2ea2c">{v.customer_name} · {fmtDate(v.scheduled_date)}</div>
              </div>
            </div>
          ))}
          <button
            className="u-d73164c"
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
    <div className="u-a8973f8">
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
      <p className="text-muted text-sm mb-12">This forecast shows scheduled item counts. Use Effort and Availability for estimated task/visit capacity.</p>
      <div className="u-4e87d07">
        {[
          { label: 'No items (0)', color: 'var(--success)', bg: '#f0fdf4' },
          { label: 'Light (1-3)', color: 'var(--primary)', bg: '#eff6ff' },
          { label: 'Moderate (4-6)', color: 'var(--warning)', bg: '#fffbeb' },
          { label: 'Heavy (7+)', color: 'var(--danger)', bg: '#fef2f2' },
        ].map(l => (
          <span key={l.label} className="flex-center gap-5">
            <span className="u-e88c2cd" style={{ background: l.bg, border: `1.5px solid ${l.color}40` }} />
            <span className="u-eee182b">{l.label}</span>
          </span>
        ))}
        <span className="u-74919f5">· Click a cell to see details</span>
      </div>

      {/* Responsive table-like grid */}
      <div className="overflow-x-auto">
        <table className="u-72b2867">
          <thead>
            <tr>
              <th className="u-6ea53e7">
                Engineer
              </th>
              {weeks.map((w, i) => (
                <th key={i} className="u-c32e96d">
                  <div className="u-ad5fa7c">{w.label}</div>
                  <div className="u-d9faab6">{w.date_range}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {forecast.map(eng => (
              <tr key={eng.id}>
                <td className="u-05c98f9">
                  <div className="u-88697ae">{eng.name}</div>
                </td>
                {eng.weeks.map((w, i) => (
                  <td key={i} className="u-edb5e41">
                    <WeekCell week={w} engName={eng.name} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Total row */}
      <div className="card u-dfac3ce">
        <div className="u-ab87eb3">Team Totals per Week</div>
        <div className="u-6a9adae">
          {weeks.map((w, i) => {
            const total = forecast.reduce((s, eng) => s + (eng.weeks[i]?.total ?? 0), 0);
            const tasks = forecast.reduce((s, eng) => s + (eng.weeks[i]?.tasks.length ?? 0), 0);
            const visits = forecast.reduce((s, eng) => s + (eng.weeks[i]?.visits.length ?? 0), 0);
            return (
              <div key={i} className="u-f6af2a4" style={{ background: workloadBg(Math.ceil(total / Math.max(forecast.length, 1))) }}>
                <div className="u-fac8b8d">{w.label}</div>
                <div className="u-028ee8c" style={{ color: workloadColor(Math.ceil(total / Math.max(forecast.length, 1))) }}>{total}</div>
                <div className="u-19dc6a2">{tasks}t · {visits}v</div>
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
    <div className="u-9886a77">
      <span style={{ color }}>{icon}</span>
      <span className="u-d0c76bf" style={{ color }}>{value}</span>
      <span className="u-5be3ef4">{label}</span>
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
      .then(d => { setEngineers(d ?? []); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  };

  const loadForecast = () => {
    setFLoading(true);
    api.workloadForecast()
      .then(d => { setForecast(d ?? []); setFLoading(false); })
      .catch(e => { setError(e.message); setFLoading(false); });
  };

  useEffect(() => { loadSnapshot(); }, []);

  useEffect(() => {
    if (tab === 'forecast' && forecast.length === 0) loadForecast();
  }, [tab]);

  const totalOpenTasks  = engineers.reduce((s, e) => s + e.open_tasks.length, 0);
  const totalVisits     = engineers.reduce((s, e) => s + e.visits.length, 0);
  const overdueCount    = engineers.reduce((s, e) => s + e.open_tasks.filter(t => isOverdue(t.deadline)).length, 0);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title flex-center gap-8">
            <Users size={20} /> Engineer Workload
          </h1>
          <div className="page-subtitle">Live snapshot of all engineers — {monthLabel}</div>
        </div>
        <button
          className="btn btn-ghost btn-sm u-4a94d5f"
          onClick={() => tab === 'snapshot' ? loadSnapshot() : loadForecast()}
          style={{ display: ['planning','pressure'].includes(tab) ? 'none' : 'inline-flex' }}
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {error && <div className="alert alert-warning mb-16">{error}</div>}

      {/* Summary bar */}
      {!loading && tab === 'snapshot' && !error && (
        <div className="grid-4 mb-20">
          <div className="card stat">
            <div className="stat-value u-dc2e428">{engineers.length}</div>
            <div className="stat-label">Engineers</div>
          </div>
          <div className="card stat">
            <div className="stat-value" style={{ color: workloadColor(totalOpenTasks) }}>{totalOpenTasks}</div>
            <div className="stat-label">Open Tasks</div>
          </div>
          <div className="card stat">
            <div className="stat-value u-52df2b0">{totalVisits}</div>
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
      <div className="tabs mb-16">
        <button className={'tab' + (tab === 'pressure' ? ' active' : '')} onClick={() => setTab('pressure')}>Operational pressure</button>
        <button className={'tab' + (tab === 'planning' ? ' active' : '')} onClick={() => setTab('planning')}>Effort and availability</button>
        <button className={'tab' + (tab === 'snapshot' ? ' active' : '')} onClick={() => setTab('snapshot')}>
          <Users size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />Current Snapshot
        </button>
        <button className={'tab' + (tab === 'forecast' ? ' active' : '')} onClick={() => setTab('forecast')}>
          <CalendarDays size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />4-Week Forecast
        </button>
      </div>

      {/* Snapshot tab */}
      {tab === 'planning' && <WorkloadPlanning />}
      {tab === 'pressure' && <WorkloadPressure />}
      {tab === 'snapshot' && (
        loading ? (
          <div className="u-a8973f8">
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
