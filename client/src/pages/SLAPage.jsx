import React, { useEffect, useState } from 'react';
import {
  ShieldCheck, AlertTriangle, CheckCircle, XCircle,
  Clock, ChevronDown, ChevronRight, RefreshCw,
} from 'lucide-react';
import { api } from '../api';
import { fmtDate } from '../components/Shared';

/* ── helpers ─────────────────────────────────────────────── */
function pct(num, den) {
  if (!den) return null;
  return Math.round((num / den) * 100);
}

function StatusPill({ ok, atRisk, breached, total }) {
  if (total === 0)
    return <span style={{ fontSize: 12, color: 'var(--gray-400)', fontStyle: 'italic' }}>No items</span>;
  if (breached > 0)
    return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 20, padding: '3px 10px', fontSize: 12, fontWeight: 700 }}><XCircle size={12} /> {breached} breached</span>;
  if (atRisk > 0)
    return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a', borderRadius: 20, padding: '3px 10px', fontSize: 12, fontWeight: 700 }}><AlertTriangle size={12} /> {atRisk} at risk</span>;
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', borderRadius: 20, padding: '3px 10px', fontSize: 12, fontWeight: 700 }}><CheckCircle size={12} /> All compliant</span>;
}

function ComplianceBar({ value }) {
  if (value === null) return null;
  const color = value >= 90 ? '#22c55e' : value >= 70 ? '#f59e0b' : '#ef4444';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: 'var(--gray-100)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${value}%`, height: '100%', background: color, borderRadius: 4, transition: 'width .4s ease' }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color, minWidth: 32, textAlign: 'right' }}>{value}%</span>
    </div>
  );
}

/* ── SLA Card ─────────────────────────────────────────────── */
function SLACard({ icon: Icon, title, target, metric, renderItems }) {
  const [expanded, setExpanded] = useState(false);

  const { total = 0, ok = 0, at_risk = 0, breached = 0, on_time, compliant } = metric || {};
  const good = on_time ?? ok ?? compliant ?? (total - (at_risk + breached));
  const compliance = pct(good, total);
  const hasIssues = breached > 0 || at_risk > 0;

  return (
    <div className="card" style={{ padding: 20 }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10,
          background: breached > 0 ? '#fef2f2' : at_risk > 0 ? '#fffbeb' : '#f0fdf4',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Icon size={20} color={breached > 0 ? '#ef4444' : at_risk > 0 ? '#f59e0b' : '#22c55e'} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{title}</div>
          <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>Target: {target}</div>
        </div>
        <StatusPill ok={good} atRisk={at_risk} breached={breached} total={total} />
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--gray-900)' }}>{total}</div>
          <div style={{ fontSize: 11, color: 'var(--gray-500)' }}>Total</div>
        </div>
        {good > 0 && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#22c55e' }}>{good}</div>
            <div style={{ fontSize: 11, color: 'var(--gray-500)' }}>On Time</div>
          </div>
        )}
        {at_risk > 0 && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#f59e0b' }}>{at_risk}</div>
            <div style={{ fontSize: 11, color: 'var(--gray-500)' }}>At Risk</div>
          </div>
        )}
        {breached > 0 && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#ef4444' }}>{breached}</div>
            <div style={{ fontSize: 11, color: 'var(--gray-500)' }}>Breached</div>
          </div>
        )}
      </div>

      {/* Compliance bar */}
      {total > 0 && <ComplianceBar value={compliance} />}

      {/* Expand button */}
      {hasIssues && (
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 12, color: 'var(--primary)', marginTop: 10, padding: 0, fontWeight: 600,
          }}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {expanded ? 'Hide details' : 'Show details'}
        </button>
      )}

      {expanded && hasIssues && (
        <div style={{ marginTop: 12 }}>
          {renderItems(metric.items || [])}
        </div>
      )}
    </div>
  );
}

/* ── Item tables ─────────────────────────────────────────── */
function MVItems({ items }) {
  const show = items.filter(i => i.breached || i.at_risk);
  if (!show.length) return null;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--gray-100)' }}>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--gray-500)', fontWeight: 600 }}>Visit</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--gray-500)', fontWeight: 600 }}>Customer</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--gray-500)', fontWeight: 600 }}>Engineers</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--gray-500)', fontWeight: 600 }}>Scheduled</th>
            <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--gray-500)', fontWeight: 600 }}>Working Days</th>
            <th style={{ padding: '6px 8px' }} />
          </tr>
        </thead>
        <tbody>
          {show.map(item => (
            <tr key={item.id} style={{ borderBottom: '1px solid var(--gray-50)' }}>
              <td style={{ padding: '6px 8px', fontWeight: 600 }}>{item.title}</td>
              <td style={{ padding: '6px 8px', color: 'var(--gray-600)' }}>{item.customer_name}</td>
              <td style={{ padding: '6px 8px', color: 'var(--gray-600)' }}>{item.engineer_names || '—'}</td>
              <td style={{ padding: '6px 8px', color: 'var(--gray-600)' }}>{fmtDate(item.scheduled_date)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: item.breached ? '#ef4444' : '#f59e0b' }}>{item.working_days}</td>
              <td style={{ padding: '6px 8px' }}>
                {item.breached
                  ? <span style={{ color: '#ef4444', fontSize: 11, fontWeight: 700 }}>BREACHED</span>
                  : <span style={{ color: '#f59e0b', fontSize: 11, fontWeight: 700 }}>AT RISK</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProjectItems({ items }) {
  const show = items.filter(i => i.breached || i.at_risk);
  if (!show.length) return null;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--gray-100)' }}>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--gray-500)', fontWeight: 600 }}>Project</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--gray-500)', fontWeight: 600 }}>Status</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--gray-500)', fontWeight: 600 }}>Last Update</th>
            <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--gray-500)', fontWeight: 600 }}>Days Since</th>
            <th style={{ padding: '6px 8px' }} />
          </tr>
        </thead>
        <tbody>
          {show.map(item => (
            <tr key={item.id} style={{ borderBottom: '1px solid var(--gray-50)' }}>
              <td style={{ padding: '6px 8px', fontWeight: 600 }}>{item.title}</td>
              <td style={{ padding: '6px 8px', color: 'var(--gray-600)', textTransform: 'capitalize' }}>{item.status.replace('_', ' ')}</td>
              <td style={{ padding: '6px 8px', color: 'var(--gray-600)' }}>{fmtDate(item.last_update)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: item.breached ? '#ef4444' : '#f59e0b' }}>{item.days_since}d</td>
              <td style={{ padding: '6px 8px' }}>
                {item.breached
                  ? <span style={{ color: '#ef4444', fontSize: 11, fontWeight: 700 }}>OVERDUE</span>
                  : <span style={{ color: '#f59e0b', fontSize: 11, fontWeight: 700 }}>AT RISK</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TaskItems({ items }) {
  const show = items.filter(i => i.breached || i.at_risk);
  if (!show.length) return null;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--gray-100)' }}>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--gray-500)', fontWeight: 600 }}>Task</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--gray-500)', fontWeight: 600 }}>Project</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--gray-500)', fontWeight: 600 }}>Assigned To</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--gray-500)', fontWeight: 600 }}>Created</th>
            <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--gray-500)', fontWeight: 600 }}>Working Days Open</th>
          </tr>
        </thead>
        <tbody>
          {show.map(item => (
            <tr key={item.id} style={{ borderBottom: '1px solid var(--gray-50)' }}>
              <td style={{ padding: '6px 8px', fontWeight: 600 }}>{item.title}</td>
              <td style={{ padding: '6px 8px', color: 'var(--gray-600)' }}>{item.project_title || '—'}</td>
              <td style={{ padding: '6px 8px', color: 'var(--gray-600)' }}>{item.assigned_to_name || 'Unassigned'}</td>
              <td style={{ padding: '6px 8px', color: 'var(--gray-600)' }}>{fmtDate(item.created_at)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: item.breached ? '#ef4444' : '#f59e0b' }}>{item.working_days}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClosureItems({ items }) {
  const show = items.filter(i => i.breached || i.at_risk);
  if (!show.length) return null;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--gray-100)' }}>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--gray-500)', fontWeight: 600 }}>Project</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--gray-500)', fontWeight: 600 }}>Requested At</th>
            <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--gray-500)', fontWeight: 600 }}>Working Days</th>
            <th style={{ padding: '6px 8px' }} />
          </tr>
        </thead>
        <tbody>
          {show.map(item => (
            <tr key={item.id} style={{ borderBottom: '1px solid var(--gray-50)' }}>
              <td style={{ padding: '6px 8px', fontWeight: 600 }}>{item.title}</td>
              <td style={{ padding: '6px 8px', color: 'var(--gray-600)' }}>{fmtDate(item.closure_requested_at)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: item.breached ? '#ef4444' : '#f59e0b' }}>{item.working_days}</td>
              <td style={{ padding: '6px 8px' }}>
                {item.breached
                  ? <span style={{ color: '#ef4444', fontSize: 11, fontWeight: 700 }}>OVERDUE</span>
                  : <span style={{ color: '#f59e0b', fontSize: 11, fontWeight: 700 }}>AT RISK</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Overall health bar ──────────────────────────────────── */
function OverallHealth({ data }) {
  if (!data) return null;
  const { mv, project_status, high_priority_tasks, closure_approval } = data;

  const counts = [
    { label: 'MV Reports',       breached: mv?.breached || 0,             at_risk: mv?.at_risk || 0 },
    { label: 'Status Updates',   breached: project_status?.breached || 0, at_risk: project_status?.at_risk || 0 },
    { label: 'High-Prio Tasks',  breached: high_priority_tasks?.breached || 0, at_risk: high_priority_tasks?.at_risk || 0 },
    { label: 'Closure Reviews',  breached: closure_approval?.breached || 0,    at_risk: closure_approval?.at_risk || 0 },
  ];

  const totalBreached = counts.reduce((s, c) => s + c.breached, 0);
  const totalAtRisk   = counts.reduce((s, c) => s + c.at_risk, 0);

  const health = totalBreached === 0 && totalAtRisk === 0 ? 'green'
    : totalBreached > 0 ? 'red' : 'yellow';

  const bg    = { green: '#f0fdf4', yellow: '#fffbeb', red: '#fef2f2' }[health];
  const color = { green: '#166534', yellow: '#92400e', red: '#b91c1c' }[health];
  const icon  = { green: <CheckCircle size={20} />, yellow: <AlertTriangle size={20} />, red: <XCircle size={20} /> }[health];
  const msg   = { green: 'All SLA metrics are on track', yellow: `${totalAtRisk} item${totalAtRisk !== 1 ? 's' : ''} approaching SLA deadline`, red: `${totalBreached} item${totalBreached !== 1 ? 's' : ''} have breached SLA` }[health];

  return (
    <div style={{ background: bg, border: `1px solid ${color}33`, borderRadius: 12, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, color }}>
      {icon}
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{msg}</div>
        <div style={{ fontSize: 12, marginTop: 2, opacity: .75 }}>
          {counts.filter(c => c.breached > 0 || c.at_risk > 0).map(c =>
            `${c.label}: ${c.breached > 0 ? `${c.breached} breached` : ''}${c.breached > 0 && c.at_risk > 0 ? ', ' : ''}${c.at_risk > 0 ? `${c.at_risk} at risk` : ''}`
          ).join(' · ')}
        </div>
      </div>
    </div>
  );
}

/* ── Main page ───────────────────────────────────────────── */
export default function SLAPage() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (quiet = false) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const d = await api.slaOverview();
      setData(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  const genTime = data?.generated_at
    ? new Date(data.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShieldCheck size={22} /> SLA Compliance
          </h1>
          {genTime && <div style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 2 }}>Last updated at {genTime}</div>}
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => load(true)}
          disabled={refreshing}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
        >
          <RefreshCw size={13} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
          Refresh
        </button>
      </div>

      {loading && <div className="grid-2"><div className="skeleton-table"><span /><span /><span /></div><div className="skeleton-table"><span /><span /><span /></div></div>}
      {error   && <div className="alert alert-danger">{error}</div>}

      {data && !loading && (
        <>
          <OverallHealth data={data} />

          <div className={`alert ${data.forecast?.current_breaches ? 'alert-danger' : data.forecast?.predicted_breaches_next_working_day ? 'alert-warning' : 'alert-success'}`} style={{ marginBottom: 18 }}>
            <strong>SLA forecast:</strong>{' '}
            {data.forecast?.predicted_breaches_next_working_day || 0} predicted breach(es) next working day · {data.forecast?.current_breaches || 0} active breach(es).
            {data.forecast?.escalation_recommended?.length > 0 && (
              <div style={{ marginTop: 5, fontSize: 12 }}>
                Escalation recommended: {data.forecast.escalation_recommended.slice(0, 5).map(item => item.title).join(', ')}
                {data.forecast.escalation_recommended.length > 5 ? ` +${data.forecast.escalation_recommended.length - 5} more` : ''}
              </div>
            )}
          </div>

          <div className="grid-2" style={{ gap: 16 }}>
            <SLACard
              icon={Clock}
              title="MV Report Completed"
              target="Within 7 working days of visit"
              metric={data.mv}
              renderItems={items => <MVItems items={items} />}
            />

            <SLACard
              icon={RefreshCw}
              title="Project Status Updates"
              target="At least every 7 days"
              metric={data.project_status}
              renderItems={items => <ProjectItems items={items} />}
            />

            <SLACard
              icon={AlertTriangle}
              title="High-Priority Task Response"
              target="Respond within 1 working day"
              metric={data.high_priority_tasks}
              renderItems={items => <TaskItems items={items} />}
            />

            <SLACard
              icon={ShieldCheck}
              title="Closure Approval Review"
              target="Reviewed within 3 working days"
              metric={data.closure_approval}
              renderItems={items => <ClosureItems items={items} />}
            />
          </div>

          {/* Legend */}
          <div style={{ marginTop: 24, padding: '12px 16px', background: 'var(--gray-50)', borderRadius: 8, fontSize: 12, color: 'var(--gray-500)' }}>
            <strong style={{ color: 'var(--gray-700)' }}>How SLA is calculated:</strong>
            {' '}Working days = Mon–Fri only. &nbsp;
            <span style={{ color: '#ef4444', fontWeight: 600 }}>Breached</span> = past the deadline. &nbsp;
            <span style={{ color: '#f59e0b', fontWeight: 600 }}>At risk</span> = 1 working day remaining.
          </div>
        </>
      )}
    </div>
  );
}
