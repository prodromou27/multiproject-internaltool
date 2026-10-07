import { useEffect, useState } from 'react';
import {
  ShieldCheck, AlertTriangle, CheckCircle, XCircle,
  Clock, ChevronDown, ChevronRight, RefreshCw, Ticket, Settings2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { fmtDate, fmtDateTime } from '../components/Shared';
import { useLiveRefresh } from '../live';

/* ── helpers ─────────────────────────────────────────────── */
function pct(num, den) {
  if (!den) return null;
  return Math.round((num / den) * 100);
}

function StatusPill({ ok, atRisk, breached, total }) {
  if (total === 0)
    return <span className="u-d0f2cbf">No items</span>;
  if (breached > 0)
    return <span className="u-adf3ce7"><XCircle size={12} /> {breached} breached</span>;
  if (atRisk > 0)
    return <span className="u-b070131"><AlertTriangle size={12} /> {atRisk} at risk</span>;
  return <span className="u-09d944d"><CheckCircle size={12} /> All compliant</span>;
}

function ComplianceBar({ value }) {
  if (value === null) return null;
  const color = value >= 90 ? '#22c55e' : value >= 70 ? '#f59e0b' : '#ef4444';
  return (
    <div className="flex-center gap-8">
      <div className="u-eda03e0">
        <div className="u-b8c11ab" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="u-ab410bc" style={{ color }}>{value}%</span>
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
    <div className="card u-769fed3">
      {/* Header row */}
      <div className="u-d771e38">
        <div className={["u-4030aa7", (breached > 0 ? 'u-60cd622' : (at_risk > 0 ? 'u-4ba476d' : 'u-725d2d4'))].filter(Boolean).join(' ')}>
          <Icon size={20} color={breached > 0 ? '#ef4444' : at_risk > 0 ? '#f59e0b' : '#22c55e'} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="u-dfe9a73">{title}</div>
          <div className="u-1a57d8f">Target: {target}</div>
        </div>
        <StatusPill ok={good} atRisk={at_risk} breached={breached} total={total} />
      </div>

      {/* Stats row */}
      <div className="u-9ed45fb">
        <div className="text-center">
          <div className="u-d7a888e">{total}</div>
          <div className="u-0bc90e3">Total</div>
        </div>
        {good > 0 && (
          <div className="text-center">
            <div className="u-18cbb50">{good}</div>
            <div className="u-0bc90e3">On Time</div>
          </div>
        )}
        {at_risk > 0 && (
          <div className="text-center">
            <div className="u-bda7b6b">{at_risk}</div>
            <div className="u-0bc90e3">At Risk</div>
          </div>
        )}
        {breached > 0 && (
          <div className="text-center">
            <div className="u-bdcb49e">{breached}</div>
            <div className="u-0bc90e3">Breached</div>
          </div>
        )}
      </div>

      {/* Compliance bar */}
      {total > 0 && <ComplianceBar value={compliance} />}

      {/* Expand button */}
      {hasIssues && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="u-cc10427"
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {expanded ? 'Hide details' : 'Show details'}
        </button>
      )}

      {expanded && hasIssues && (
        <div className="mt-12">
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
    <div className="overflow-x-auto">
      <table className="u-2cff907">
        <thead>
          <tr className="u-02c1276">
            <th className="u-6282c46">Visit</th>
            <th className="u-6282c46">Customer</th>
            <th className="u-6282c46">Engineers</th>
            <th className="u-6282c46">Scheduled</th>
            <th className="u-856eb7b">Working Days</th>
            <th className="u-8c20179" />
          </tr>
        </thead>
        <tbody>
          {show.map(item => (
            <tr key={item.id} className="u-6e42c53">
              <td className="u-d33fadf">{item.title}</td>
              <td className="u-beae6cf">{item.customer_name}</td>
              <td className="u-beae6cf">{item.engineer_names || '—'}</td>
              <td className="u-beae6cf">{fmtDate(item.scheduled_date)}</td>
              <td className={["u-aa06794", (item.breached ? 'u-b0eb59c' : 'u-6a6a237')].filter(Boolean).join(' ')}>{item.working_days}</td>
              <td className="u-8c20179">
                {item.breached
                  ? <span className="u-cd50164">BREACHED</span>
                  : <span className="u-5ed8284">AT RISK</span>}
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
    <div className="overflow-x-auto">
      <table className="u-2cff907">
        <thead>
          <tr className="u-02c1276">
            <th className="u-6282c46">Project</th>
            <th className="u-6282c46">Status</th>
            <th className="u-6282c46">Last Update</th>
            <th className="u-856eb7b">Days Since</th>
            <th className="u-8c20179" />
          </tr>
        </thead>
        <tbody>
          {show.map(item => (
            <tr key={item.id} className="u-6e42c53">
              <td className="u-d33fadf">{item.title}</td>
              <td className="u-da7c2af">{item.status.replace('_', ' ')}</td>
              <td className="u-beae6cf">{fmtDate(item.last_update)}</td>
              <td className={["u-aa06794", (item.breached ? 'u-b0eb59c' : 'u-6a6a237')].filter(Boolean).join(' ')}>{item.days_since}d</td>
              <td className="u-8c20179">
                {item.breached
                  ? <span className="u-cd50164">OVERDUE</span>
                  : <span className="u-5ed8284">AT RISK</span>}
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
    <div className="overflow-x-auto">
      <table className="u-2cff907">
        <thead>
          <tr className="u-02c1276">
            <th className="u-6282c46">Task</th>
            <th className="u-6282c46">Project</th>
            <th className="u-6282c46">Assigned To</th>
            <th className="u-6282c46">Created</th>
            <th className="u-856eb7b">Working Days Open</th>
          </tr>
        </thead>
        <tbody>
          {show.map(item => (
            <tr key={item.id} className="u-6e42c53">
              <td className="u-d33fadf">{item.title}</td>
              <td className="u-beae6cf">{item.project_title || '—'}</td>
              <td className="u-beae6cf">{item.assigned_to_name || 'Unassigned'}</td>
              <td className="u-beae6cf">{fmtDate(item.created_at)}</td>
              <td className={["u-aa06794", (item.breached ? 'u-b0eb59c' : 'u-6a6a237')].filter(Boolean).join(' ')}>{item.working_days}</td>
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
    <div className="overflow-x-auto">
      <table className="u-2cff907">
        <thead>
          <tr className="u-02c1276">
            <th className="u-6282c46">Project</th>
            <th className="u-6282c46">Requested At</th>
            <th className="u-856eb7b">Working Days</th>
            <th className="u-8c20179" />
          </tr>
        </thead>
        <tbody>
          {show.map(item => (
            <tr key={item.id} className="u-6e42c53">
              <td className="u-d33fadf">{item.title}</td>
              <td className="u-beae6cf">{fmtDate(item.closure_requested_at)}</td>
              <td className={["u-aa06794", (item.breached ? 'u-b0eb59c' : 'u-6a6a237')].filter(Boolean).join(' ')}>{item.working_days}</td>
              <td className="u-8c20179">
                {item.breached
                  ? <span className="u-cd50164">OVERDUE</span>
                  : <span className="u-5ed8284">AT RISK</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TicketItems({ items }) {
  if (!items.length) return null;
  return (
    <div className="overflow-x-auto">
      <table className="u-2cff907">
        <thead>
          <tr className="u-02c1276">
            <th className="u-6282c46">Ticket</th>
            <th className="u-6282c46">Customer</th>
            <th className="u-6282c46">Engineer</th>
            <th className="u-6282c46">Due</th>
            <th className="u-8c20179" />
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr key={item.id} className="u-6e42c53">
              <td className="u-d33fadf">{item.external_url ? <a href={item.external_url} target="_blank" rel="noreferrer">#{item.ticket_number}</a> : `#${item.ticket_number}`} {item.subject}</td>
              <td className="u-beae6cf">{item.customer_name}</td>
              <td className="u-beae6cf">{item.engineer_name || '—'}</td>
              <td className="u-beae6cf">{fmtDateTime(item.due_at)}</td>
              <td className="u-8c20179">
                {item.breached && <span className="u-cd50164">PAST DUE</span>}
                {item.late_complete && <span className="u-cd50164">LATE</span>}
                {item.at_risk && <span className="u-5ed8284">DUE IN {Math.max(0, Math.round(item.hours_left))}H</span>}
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
  const { mv, project_status, high_priority_tasks, closure_approval, tickets } = data;

  const counts = [
    { label: 'MV Reports',       breached: mv?.breached || 0,             at_risk: mv?.at_risk || 0 },
    { label: 'Status Updates',   breached: project_status?.breached || 0, at_risk: project_status?.at_risk || 0 },
    { label: 'High-Prio Tasks',  breached: high_priority_tasks?.breached || 0, at_risk: high_priority_tasks?.at_risk || 0 },
    { label: 'Closure Reviews',  breached: closure_approval?.breached || 0,    at_risk: closure_approval?.at_risk || 0 },
    { label: 'Tickets',          breached: tickets?.breached || 0,         at_risk: tickets?.at_risk || 0 },
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
    <div className="u-ac05f01" style={{ background: bg, border: `1px solid ${color}33`, color }}>
      {icon}
      <div className="flex-1">
        <div className="u-4aaa243">{msg}</div>
        <div className="u-58adcf3">
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
  useLiveRefresh(() => load(true));

  const genTime = data?.generated_at
    ? new Date(data.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title flex-center gap-8">
            <ShieldCheck size={22} /> SLA Compliance
          </h1>
          {genTime && <div className="u-f48fc2c">Last updated at {genTime}</div>}
        </div>
        <button
          className="btn btn-ghost btn-sm inline-flex items-center gap-5"
          onClick={() => load(true)}
          disabled={refreshing}
         
        >
          <RefreshCw size={13} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
          Refresh
        </button>
        <Link className="btn btn-ghost btn-sm inline-flex items-center gap-5" to="/settings/sla"><Settings2 size={13} /> Change SLAs</Link>
      </div>

      {loading && <div className="grid-2"><div className="skeleton-table"><span /><span /><span /></div><div className="skeleton-table"><span /><span /><span /></div></div>}
      {error   && <div className="alert alert-danger">{error}</div>}

      {data && !loading && (
        <>
          <OverallHealth data={data} />

          <div className={`alert ${data.forecast?.current_breaches ? 'alert-danger' : data.forecast?.predicted_breaches_next_working_day ? 'alert-warning' : 'alert-success'} u-905d8b3`}>
            <strong>SLA forecast:</strong>{' '}
            {data.forecast?.predicted_breaches_next_working_day || 0} predicted breach(es) next working day · {data.forecast?.current_breaches || 0} active breach(es).
            {data.forecast?.escalation_recommended?.length > 0 && (
              <div className="u-c5f8168">
                Escalation recommended: {data.forecast.escalation_recommended.slice(0, 5).map(item => item.title).join(', ')}
                {data.forecast.escalation_recommended.length > 5 ? ` +${data.forecast.escalation_recommended.length - 5} more` : ''}
              </div>
            )}
          </div>

          <div className="grid-2 u-f6ce4d1">
            {data.mv?.enabled !== false && <SLACard
              icon={Clock}
              title="MV Report Completed"
              target={`Within ${data.mv.sla_days} working days of the visit`}
              metric={data.mv}
              renderItems={items => <MVItems items={items} />}
            />}

            {data.project_status?.enabled !== false && <SLACard
              icon={RefreshCw}
              title="Project Status Updates"
              target={`At least every ${data.project_status.sla_days} days`}
              metric={data.project_status}
              renderItems={items => <ProjectItems items={items} />}
            />}

            {data.high_priority_tasks?.enabled !== false && <SLACard
              icon={AlertTriangle}
              title="High-Priority Task Response"
              target={`Picked up within ${data.high_priority_tasks.sla_days} working day${data.high_priority_tasks.sla_days === 1 ? '' : 's'}`}
              metric={data.high_priority_tasks}
              renderItems={items => <TaskItems items={items} />}
            />}

            {data.closure_approval?.enabled !== false && <SLACard
              icon={ShieldCheck}
              title="Closure Approval Review"
              target={`Reviewed within ${data.closure_approval.sla_days} working days`}
              metric={data.closure_approval}
              renderItems={items => <ClosureItems items={items} />}
            />}

            {data.tickets?.enabled && <SLACard
              icon={Ticket}
              title="Tickets resolved by their due date"
              target={`Request Tracker due date; at risk ${data.tickets.warning_hours} hours before it`}
              metric={{ ...data.tickets, total: data.tickets.on_time + data.tickets.late_complete + data.tickets.open }}
              renderItems={items => <TicketItems items={items} />}
            />}
          </div>

          {/* Legend */}
          <div className="u-9b25793">
            <strong className="u-3a065eb">How SLA is calculated:</strong>
            {' '}Working days = Mon–Fri only. &nbsp;
            <span className="u-7ed4c86">Breached</span> = past the deadline. &nbsp;
            <span className="u-71b98aa">At risk</span> = 1 working day remaining. &nbsp;
            Which SLAs apply, and their limits, are set in <Link to="/settings/sla">Settings → SLAs</Link>.
          </div>
        </>
      )}
    </div>
  );
}
