import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { api } from '../api';
import { StatusBadge, PriorityBadge, fmtDate, isOverdue } from '../components/Shared';

function KpiHealthRow({ k }) {
  const color = k.pct >= 100 ? 'var(--success)' : k.pct >= 70 ? 'var(--primary)' : k.pct >= 40 ? 'var(--warning)' : 'var(--danger)';
  return (
    <tr>
      <td>{k.title}</td>
      <td>{k.name}</td>
      <td>{k.current_value}{k.unit || ''} / {k.target_value}{k.unit || ''}</td>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="progress-bar" style={{ width: 80 }}>
            <div style={{ height: '100%', borderRadius: 99, background: color, width: Math.min(k.pct, 100) + '%' }} />
          </div>
          <span style={{ fontSize: 12, color, fontWeight: 600 }}>{k.pct}%</span>
        </div>
      </td>
    </tr>
  );
}

/* ── Trends tab ─────────────────────────────────────────── */
const CHART_COLORS = {
  created:   '#3b82f6',
  done:      '#22c55e',
  on_time:   '#f59e0b',
  mv_rate:   '#8b5cf6',
  hours:     '#0891b2',
  mv_done:   '#6366f1',
};

function ChartCard({ title, children }) {
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 14, color: 'var(--gray-700)' }}>{title}</div>
      {children}
    </div>
  );
}

function TrendsTab() {
  const [data, setData]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    api.reportMonthly()
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  if (loading) return <p className="text-muted">Loading trends…</p>;
  if (error)   return <div className="alert alert-warning">{error}</div>;

  // Compute totals for summary pills
  const totTasks   = data.reduce((s, m) => s + m.tasks_done, 0);
  const totHours   = data.reduce((s, m) => s + m.hours_logged, 0);
  const totMV      = data.reduce((s, m) => s + m.mv_completed, 0);
  const ratedMonths = data.filter(m => m.on_time_rate !== null);
  const avgOnTime  = ratedMonths.length
    ? Math.round(ratedMonths.reduce((s, m) => s + m.on_time_rate, 0) / ratedMonths.length)
    : null;

  return (
    <div>
      {/* Summary pills */}
      <div className="grid-4" style={{ marginBottom: 20 }}>
        <div className="card stat">
          <div className="stat-value" style={{ color: CHART_COLORS.done }}>{totTasks}</div>
          <div className="stat-label">Tasks Completed (6 mo)</div>
        </div>
        <div className="card stat">
          <div className="stat-value" style={{ color: CHART_COLORS.on_time }}>
            {avgOnTime !== null ? avgOnTime + '%' : '—'}
          </div>
          <div className="stat-label">Avg On-Time Rate</div>
        </div>
        <div className="card stat">
          <div className="stat-value" style={{ color: CHART_COLORS.mv_done }}>{totMV}</div>
          <div className="stat-label">MV Completed (6 mo)</div>
        </div>
        <div className="card stat">
          <div className="stat-value" style={{ color: CHART_COLORS.hours }}>{totHours}h</div>
          <div className="stat-label">Hours Logged (6 mo)</div>
        </div>
      </div>

      {/* Task volume chart */}
      <ChartCard title="Task Volume — Created vs Completed">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 4, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="tasks_created" name="Created"   stroke={CHART_COLORS.created} strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="tasks_done"    name="Completed" stroke={CHART_COLORS.done}    strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* On-time rate + MV rate */}
      <ChartCard title="Delivery Rates — On-Time Tasks & MV Completion (%)">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 4, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} unit="%" />
            <Tooltip formatter={(v) => v !== null ? v + '%' : 'n/a'} />
            <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="on_time_rate" name="Task On-Time %"    stroke={CHART_COLORS.on_time} strokeWidth={2} dot={{ r: 3 }} connectNulls />
            <Line type="monotone" dataKey="mv_rate"      name="MV Completion %"   stroke={CHART_COLORS.mv_rate} strokeWidth={2} dot={{ r: 3 }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid-2" style={{ gap: 20 }}>
        {/* Hours logged */}
        <ChartCard title="Hours Logged per Month">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="hours_logged" name="Hours" fill={CHART_COLORS.hours} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Maintenance visits */}
        <ChartCard title="Maintenance Visits — Scheduled vs Completed">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="mv_total"     name="Scheduled"  fill="#c7d2fe" radius={[3, 3, 0, 0]} />
              <Bar dataKey="mv_completed" name="Completed"  fill={CHART_COLORS.mv_done} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}

export default function Reports() {
  const [summary, setSummary] = useState(null);
  const [projects, setProjects] = useState([]);
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.reportSummary(), api.reportProjects()]).then(([s, p]) => { setSummary(s); setProjects(p); setLoading(false); });
  }, []);

  if (loading || !summary) return <div className="page"><p className="text-muted">Loading…</p></div>;

  const byStatus = Object.fromEntries(summary.byStatus.map(s => [s.status, s.count]));

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Reports</h1>
        <span className="text-sm text-muted">Manager view only</span>
      </div>

      <div className="tabs">
        {[['overview','Overview'],['projects','Projects'],['kpis','KPIs'],['trends','Trends']].map(([k, l]) => (
          <button key={k} className={'tab' + (tab === k ? ' active' : '')} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <div className="grid-4" style={{ marginBottom: 24 }}>
            <div className="card stat"><div className="stat-value">{summary.total}</div><div className="stat-label">Total Projects</div></div>
            <div className="card stat"><div className="stat-value" style={{ color: 'var(--primary)' }}>{byStatus.active || 0}</div><div className="stat-label">Active</div></div>
            <div className="card stat"><div className="stat-value" style={{ color: 'var(--success)' }}>{byStatus.closed || 0}</div><div className="stat-label">Closed</div></div>
            <div className="card stat"><div className="stat-value" style={{ color: 'var(--danger)' }}>{summary.overdue}</div><div className="stat-label">Overdue</div></div>
          </div>

          <div className="grid-2" style={{ marginBottom: 24 }}>
            <div className="card">
              <div className="section-title">Task Breakdown</div>
              <div className="grid-3">
                <div className="stat"><div className="stat-value" style={{ fontSize: 24 }}>{summary.taskStats?.open || 0}</div><div className="stat-label">Open</div></div>
                <div className="stat"><div className="stat-value" style={{ fontSize: 24, color: 'var(--warning)' }}>{summary.taskStats?.in_progress || 0}</div><div className="stat-label">In Progress</div></div>
                <div className="stat"><div className="stat-value" style={{ fontSize: 24, color: 'var(--success)' }}>{summary.taskStats?.done || 0}</div><div className="stat-label">Done</div></div>
              </div>
              {summary.taskStats && <p className="text-sm text-muted mt-8">{summary.taskStats.adhoc} ad-hoc tasks total</p>}
            </div>

            <div className="card">
              <div className="section-title">Engineer Workload</div>
              {summary.engineerLoad.length === 0 ? <p className="text-muted text-sm">No engineers</p> : summary.engineerLoad.map(e => (
                <div key={e.name} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={{ width: 110, fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{e.name}</span>
                  <div className="progress-bar" style={{ flex: 1 }}>
                    <div className="progress-bar-fill" style={{ width: e.task_count ? `${(e.done_count / e.task_count) * 100}%` : '0%' }} />
                  </div>
                  <span className="text-sm text-muted">{e.done_count}/{e.task_count} done</span>
                </div>
              ))}
            </div>
          </div>

          {summary.pendingClosure.length > 0 && (
            <div className="card">
              <div className="section-title" style={{ color: 'var(--warning)' }}>Pending Closure ({summary.pendingClosure.length})</div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Project</th><th>Created By</th><th>Deadline</th><th>Action</th></tr></thead>
                  <tbody>{summary.pendingClosure.map(p => (
                    <tr key={p.id}>
                      <td><Link to={`/projects/${p.id}`}>{p.title}</Link></td>
                      <td>{p.created_by_name}</td>
                      <td className={isOverdue(p.deadline) ? 'overdue' : ''}>{fmtDate(p.deadline)}</td>
                      <td><Link to={`/projects/${p.id}`} className="btn btn-sm btn-success">Review & Approve</Link></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'projects' && (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Project</th><th>Status</th><th>Priority</th><th>Tasks</th><th>Members</th><th>Deadline</th></tr></thead>
            <tbody>{projects.map(p => (
              <tr key={p.id}>
                <td><Link to={`/projects/${p.id}`} style={{ fontWeight: 600 }}>{p.title}</Link></td>
                <td><StatusBadge s={p.status} /></td>
                <td><PriorityBadge p={p.priority} /></td>
                <td>
                  <span className="text-sm">{p.done_count}/{p.task_count}</span>
                  {p.task_count > 0 && <div className="progress-bar" style={{ width: 60, marginTop: 3 }}>
                    <div className="progress-bar-fill" style={{ width: `${(p.done_count / p.task_count) * 100}%` }} />
                  </div>}
                </td>
                <td>{p.member_count}</td>
                <td className={isOverdue(p.deadline) && p.status !== 'closed' ? 'overdue' : ''}>{fmtDate(p.deadline)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {tab === 'kpis' && (
        <div className="card table-wrap">
          {summary.kpiHealth.length === 0 ? <p className="text-muted text-sm">No KPIs defined yet</p> : (
            <table>
              <thead><tr><th>Project</th><th>KPI</th><th>Value</th><th>Progress</th></tr></thead>
              <tbody>{summary.kpiHealth.map((k, i) => <KpiHealthRow key={i} k={k} />)}</tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'trends' && <TrendsTab />}
    </div>
  );
}
