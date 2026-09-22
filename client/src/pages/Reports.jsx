import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { api } from '../api';
import { fmtHours, plural, buildMix, HoursHero, Ranking } from '../components/ServiceCharts';
import { fmtDuration, mixOf } from '../components/activityLedger';
import './ServiceReport.css';
import { StatusBadge, PriorityBadge, fmtDate, isOverdue } from '../components/Shared';
import ReportBuilder from '../components/ReportBuilder';

function KpiHealthRow({ k }) {
  const color = k.pct >= 100 ? 'var(--success)' : k.pct >= 70 ? 'var(--primary)' : k.pct >= 40 ? 'var(--warning)' : 'var(--danger)';
  return (
    <tr>
      <td>{k.title}</td>
      <td>{k.name}</td>
      <td>{k.current_value}{k.unit || ''} / {k.target_value}{k.unit || ''}</td>
      <td>
        <div className="flex-center gap-8">
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
    <div className="card mb-20">
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
      .then(d => { setData(d ?? []); setLoading(false); })
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
      <div className="grid-4 mb-20">
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

/* ── Service Activity Report tab ──────────────────────────── */
function ServiceActivityReportTab() {
  const [reportType, setReportType] = useState('customer');
  const [customers, setCustomers] = useState([]);
  const [engineers, setEngineers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [entityId, setEntityId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [month, setMonth] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const isMonthly = reportType === 'monthly_msp';

  function monthBounds(ym) {
    const [y, m] = ym.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate(); // local calendar, so no UTC day shift
    return [`${ym}-01`, `${ym}-${String(lastDay).padStart(2, '0')}`];
  }

  useEffect(() => {
    Promise.all([api.customers(), api.users(), api.teams()]).then(([c, u, t]) => {
      setCustomers(c); setEngineers(u.filter(x => x.role === 'engineer')); setTeams(t);
    }).catch(() => {});
  }, []);

  async function runReport() {
    if (!entityId) return;
    setLoading(true); setError('');
    const [rangeFrom, rangeTo] = isMonthly ? monthBounds(month) : [from || undefined, to || undefined];
    const params = { from: rangeFrom, to: rangeTo };
    if (reportType === 'customer' || isMonthly) params.customer_id = entityId;
    if (reportType === 'engineer') params.engineer_id = entityId;
    if (reportType === 'team') params.team_id = entityId;
    try {
      const fn = (reportType === 'customer' || isMonthly) ? api.serviceActivityCustomerReport
        : reportType === 'engineer' ? api.serviceActivityEngineerReport
        : api.serviceActivityTeamReport;
      const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
      setResult(await fn(clean));
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function exportReport() {
    try {
      const { token } = await api.downloadToken();
      const [rangeFrom, rangeTo] = isMonthly ? monthBounds(month) : [from, to];
      const params = new URLSearchParams({ ...(rangeFrom ? { from: rangeFrom } : {}), ...(rangeTo ? { to: rangeTo } : {}), token });
      if (reportType === 'customer' || isMonthly) params.set('customer_id', entityId);
      if (reportType === 'engineer') params.set('engineer_id', entityId);
      if (reportType === 'team') params.set('team_id', entityId);
      const a = document.createElement('a');
      a.href = '/api/reports/service-activity/export?' + params.toString();
      a.download = 'service_activity_report.xlsx';
      a.click();
    } catch (e) { setError(e.message); }
  }

  const entityOptions = (reportType === 'customer' || isMonthly) ? customers : reportType === 'engineer' ? engineers : teams;

  return (
    <div>
      <div className="card mb-20">
        <div className="form-row">
          <div className="form-group"><label htmlFor="sr-type">Report type</label>
            <select id="sr-type" value={reportType} onChange={e => { setReportType(e.target.value); setEntityId(''); setResult(null); }}>
              <option value="customer">Customer activity report</option>
              <option value="engineer">Engineer activity report</option>
              <option value="team">Team activity report</option>
              <option value="monthly_msp">Monthly MSP service report</option>
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="sr-entity">{isMonthly ? 'Customer' : reportType === 'customer' ? 'Customer' : reportType === 'engineer' ? 'Engineer' : 'Team'}</label>
            <select id="sr-entity" value={entityId} onChange={e => setEntityId(e.target.value)}>
              <option value="">Select one</option>
              {entityOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
        </div>
        {isMonthly ? (
          <div className="form-group" style={{ maxWidth: 220 }}><label htmlFor="sr-month">Month</label>
            <input id="sr-month" type="month" value={month} onChange={e => setMonth(e.target.value)} />
          </div>
        ) : (
          <div className="form-row">
            <div className="form-group"><label htmlFor="sr-from">From</label><input id="sr-from" type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
            <div className="form-group"><label htmlFor="sr-to">To</label><input id="sr-to" type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
          </div>
        )}
        <div className="flex gap-8">
          <button className="btn btn-primary" onClick={runReport} disabled={!entityId || loading}>{loading ? 'Running…' : 'Run report'}</button>
          {result && <button className="btn btn-ghost" onClick={exportReport}>Export to Excel</button>}
        </div>
      </div>

      {error && <div className="alert alert-warning">{error}</div>}

      {result && (() => {
        const sum = result.summary;
        const name = entityOptions.find(o => String(o.id) === String(entityId))?.name;
        const kind = isMonthly ? 'Monthly MSP service report'
          : reportType === 'customer' ? 'Customer activity report'
          : reportType === 'engineer' ? 'Engineer activity report' : 'Team activity report';
        const period = isMonthly ? new Date(`${month}-02`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
          : from || to ? 'selected dates' : 'all dates';
        const rankings = [
          <Ranking key="cat" title="Hours by category" rows={sum.byCategory || []} valueKey="hours" format={fmtHours}
            detail={r => plural(r.count, 'activity', 'activities')} />,
          reportType !== 'engineer' && <Ranking key="eng" title="Hours by engineer" rows={sum.byEngineer || []} valueKey="hours" format={fmtHours} />,
          (reportType === 'engineer' || reportType === 'team') && <Ranking key="cus" title="Hours by customer" rows={sum.byCustomer || []} valueKey="hours" format={fmtHours} />,
          <Ranking key="tech" title="Activities by technology" note="Activities can carry more than one technology"
            rows={sum.byTechnology || []} valueKey="count" format={n => String(n)} />,
        ];
        return (
          <div className="svc-report">
            <header className="svc-report-head">
              <h2>{name}</h2>
              <p>{kind}, {period}</p>
            </header>

            <HoursHero hours={sum.total_hours} mix={buildMix(sum.byBillable)}
              context={`${plural(sum.total_activities, 'activity', 'activities')} in this report.`} />

            {sum.total_activities > 0 && <div className="svc-report-grid">{rankings}</div>}

            <div className="card table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Engineer</th><th>Category</th><th>Activity</th><th>Time</th><th>Billing</th><th>Ticket</th></tr></thead>
                <tbody>
                  {result.rows.map((r, i) => (
                    <tr key={`${r.activity_date}-${i}`}>
                      <td>{fmtDate(r.activity_date)}</td>
                      <td>{r.engineer}</td>
                      <td>{r.category}</td>
                      <td>{r.title}</td>
                      <td>{r.duration_minutes != null ? fmtDuration(r.duration_minutes) : 'Not set'}</td>
                      <td>{r.billable_classification ? mixOf(r.billable_classification).label : 'Not set'}</td>
                      <td>{r.ticket_reference || 'Not set'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.rows.length === 0 && <p className="text-muted" style={{ padding: 16 }}>No activities were logged for these dates.</p>}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export default function Reports() {
  const [summary, setSummary] = useState(null);
  const [projects, setProjects] = useState([]);
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [loadError,setLoadError] = useState('');
  const [retry,setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController(),options = { signal: controller.signal };
    setLoading(true); setLoadError('');
    Promise.all([api.reportSummary(options), api.reportProjects(options)]).then(([s, p]) => { if (!controller.signal.aborted) { setSummary(s); setProjects(p); } })
      .catch(error => { if (!controller.signal.aborted) setLoadError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);

  if (loading || !summary) return <div className="page"><h1>Reports</h1>{tab==='builder' ? <ReportBuilder /> : loading ? <p role="status">Loading reports...</p> : <div className="error-msg" role="alert">{loadError || 'Report summaries unavailable'} <button className="btn btn-ghost" onClick={() => setRetry(value => value+1)}>Retry summaries</button><button className="btn btn-primary" onClick={() => setTab('builder')}>Open Report Builder</button></div>}</div>;

  const byStatus = Object.fromEntries(summary.byStatus.map(s => [s.status, s.count]));
  // "Active" = everything that isn't closed or cancelled
  const activeCount = summary.byStatus
    .filter(s => s.status !== 'closed' && s.status !== 'cancelled')
    .reduce((sum, s) => sum + s.count, 0);

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Reports</h1>
        <span className="text-sm text-muted">Manager view only</span>
      </div>

      <div className="tabs">
        {[['overview','Overview'],['builder','Report Builder'],['projects','Projects'],['kpis','KPIs'],['trends','Trends'],['service_activity','Service Activity']].map(([k, l]) => (
          <button key={k} className={'tab' + (tab === k ? ' active' : '')} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <div className="grid-4" style={{ marginBottom: 24 }}>
            <div className="card stat"><div className="stat-value">{summary.total}</div><div className="stat-label">Total Projects</div></div>
            <div className="card stat"><div className="stat-value" style={{ color: 'var(--primary)' }}>{activeCount}</div><div className="stat-label">Active</div></div>
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
                <td><StatusBadge entityType="project" s={p.status} /></td>
                <td><PriorityBadge p={p.priority} /></td>
                <td>
                  <span className="text-sm">{p.done_count}/{p.task_count}</span>
                  {p.task_count > 0 && <div className="progress-bar" style={{ width: 60, marginTop: 3 }}>
                    <div className="progress-bar-fill" style={{ width: `${(p.done_count / p.task_count) * 100}%` }} />
                  </div>}
                </td>
                <td>{p.member_count}</td>
                <td className={isOverdue(p.deadline) && !['closed','cancelled'].includes(p.status) ? 'overdue' : ''}>{fmtDate(p.deadline)}</td>
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
      {tab === 'builder' && <ReportBuilder />}
      {tab === 'service_activity' && <ServiceActivityReportTab />}
    </div>
  );
}
