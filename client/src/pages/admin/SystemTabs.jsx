import React, { useEffect, useState, useCallback } from 'react';
import { Shield, CheckCircle2, Lock, AlertTriangle, Zap, HardDrive, Save, Loader2, Activity, RefreshCw, Download, ShieldAlert } from 'lucide-react';
import { api } from '../../api';
import { fmtDate, fmtDateTime } from '../../components/Shared';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/Confirm';
import { StatsTab } from './OverviewTab';
import { LoggingTab } from './AlertsLoggingTab';

/* ── System Update Tab ───────────────────────────────────── */
export const PHASE_LABELS = {
  idle:           { label: 'Idle',                     color: 'var(--gray-400)' },
  queued:         { label: 'Queued…',                  color: 'var(--primary)'  },
  install_server: { label: 'Installing server deps…',  color: 'var(--primary)'  },
  install_client: { label: 'Installing client deps…',  color: 'var(--primary)'  },
  build_client:   { label: 'Building client app…',     color: 'var(--warning)'  },
  done:           { label: 'Complete ✓',               color: 'var(--success)'  },
  error:          { label: 'Failed',                   color: 'var(--danger)'   },
};

export const STEPS = [
  { key: 'install_server', label: 'Install server deps' },
  { key: 'install_client', label: 'Install client deps' },
  { key: 'build_client',   label: 'Build client app'    },
  { key: 'done',           label: 'Ready to restart'    },
];

export function StepDot({ phase, stepKey }) {
  const phases = STEPS.map(s => s.key);
  const current = phases.indexOf(phase);
  const stepIdx = phases.indexOf(stepKey);
  const isDone  = current > stepIdx || phase === 'done';
  const isActive = phase === stepKey;
  const color = isDone ? 'var(--success)' : isActive ? 'var(--primary)' : 'var(--gray-200)';
  return (
    <div className="u-08d6c17">
      <div className="u-3fb8655" style={{ background: color, border: `2px solid ${color}` }}>
        {isDone ? '✓' : isActive ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : ''}
      </div>
    </div>
  );
}

/* ── System Health Tab ───────────────────────────────────── *
 * Combines three previously separate tabs (System Stats, Deployment Health,
 * Logging) — all read-only or rarely-touched operational monitoring, not
 * configuration a manager edits day to day — into one, to shorten the
 * Settings tab list. */
const SYSTEM_HEALTH_SECTIONS = [
  { key: 'stats',      label: 'Stats' },
  { key: 'deployment', label: 'Deployment' },
  { key: 'logging',    label: 'Logging' },
];

export function SystemHealthTab() {
  const [section, setSection] = useState('stats');
  return (
    <div>
      <div className="u-cb21afb" role="tablist" aria-label="System health section">
        {SYSTEM_HEALTH_SECTIONS.map(s => (
          <button key={s.key} type="button" role="tab" aria-selected={section === s.key}
            className={'btn btn-sm ' + (section === s.key ? 'btn-primary' : 'btn-ghost')}
            onClick={() => setSection(s.key)}>
            {s.label}
          </button>
        ))}
      </div>
      {section === 'stats' && <StatsTab />}
      {section === 'deployment' && <DeploymentHealthTab />}
      {section === 'logging' && <LoggingTab />}
    </div>
  );
}

export function DeploymentHealthTab() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      setData(await api.deploymentHealth());
    } catch (e) {
      toast.error(e.message || 'Failed to load deployment health');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  const meta = {
    ok: { label: 'Healthy', color: 'var(--success)', bg: '#dcfce7', Icon: CheckCircle2 },
    warning: { label: 'Needs Attention', color: 'var(--tone-warning-text)', bg: 'var(--warning-light)', Icon: AlertTriangle },
    error: { label: 'Action Required', color: 'var(--danger)', bg: '#fee2e2', Icon: ShieldAlert },
  };

  if (loading) return <p className="text-muted">Loading...</p>;
  if (!data) return <p className="text-muted">Deployment health is unavailable.</p>;

  const top = meta[data.status] || meta.warning;
  const TopIcon = top.Icon;

  return (
    <div className="u-7af2e82">
      <div className="card u-d8d5ce6">
        <div className="u-de506d0" style={{ background: top.bg, color: top.color }}>
          <TopIcon size={24} />
        </div>
        <div className="u-6c0d09d">
          <div className="u-266e2f3">{top.label}</div>
          <div className="u-2973aa1">
            Last checked {fmtDate(data.checked_at)}
          </div>
        </div>
        <button
          className="btn btn-ghost btn-sm inline-flex items-center gap-6"
          onClick={() => load(true)}
          disabled={refreshing}
         
        >
          {refreshing ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={13} />}
          Refresh
        </button>
      </div>

      <div className="u-b159448">
        {[
          ['Environment', data.app?.node_env],
          ['Version', data.app?.version],
          ['Uptime', `${Math.floor((data.app?.uptime_seconds || 0) / 60)} min`],
          ['Process', data.app?.pid],
        ].map(([label, value]) => (
          <div key={label} className="card u-b622587">
            <div className="u-ca42a9a">{label}</div>
            <div className="u-13ce2a4">{value || '-'}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="u-334fee5">
            <HardDrive size={15} /> Deployment Checklist
          </h3>
        </div>
        <div className="u-1746797">
          {(data.checks || []).map(check => {
            const m = meta[check.status] || meta.warning;
            const Icon = m.Icon;
            return (
              <div key={check.key} className="u-ed783b2">
                <Icon size={16} color={m.color} style={{ flexShrink: 0, marginTop: 1 }} />
                <div className="u-3922d32">
                  <div className="u-88697ae">{check.label}</div>
                  <div className="u-b9fff97">{check.detail}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="card mt-16">
        <div className="card-header"><h3 className="u-334fee5"><Activity size={15} /> Database Query Activity</h3></div>
        <div className="u-b6f8408">
          <div className="grid-4 mb-12">
            <div className="stat-card"><strong>{data.database?.count || 0}</strong><span>Observed</span></div>
            <div className="stat-card"><strong>{data.database?.average_ms || 0}ms</strong><span>Average</span></div>
            <div className="stat-card"><strong>{data.database?.slow || 0}</strong><span>Slow</span></div>
            <div className="stat-card"><strong>{data.database?.pool?.waiting || 0}</strong><span>Pool waiting</span></div>
          </div>
          {(data.database?.recent_slow || []).length ? <div className="table-wrap"><table><thead><tr><th>Safe query label</th><th>Duration</th><th>Observed</th><th>Result</th></tr></thead><tbody>{data.database.recent_slow.map((query,index) => <tr key={`${query.occurred_at}-${index}`}><td>{query.label}</td><td>{query.duration_ms}ms</td><td>{fmtDateTime(query.occurred_at)}</td><td><span className={`badge ${query.failed?'badge-danger':'badge-warning'}`}>{query.failed?'Failed':'Slow'}</span></td></tr>)}</tbody></table></div> : <p className="text-muted text-sm">No queries have crossed the {data.database?.threshold_ms || 250}ms threshold since this process started.</p>}
          <p className="text-muted text-xs mt-8">Labels contain only the operation and database relation. SQL values and customer data are never retained.</p>
        </div>
      </div>
    </div>
  );
}

export function SystemUpdateTab() {
  const toast   = useToast();
  const confirm = useConfirm();
  const [status,    setStatus]    = useState(null);
  const [checking,  setChecking]  = useState(false);
  const [loading,   setLoading]   = useState(true);
  const [restarting, setRestarting] = useState(false);
  const logEndRef = React.useRef(null);
  const pollRef   = React.useRef(null);

  // Initial load
  useEffect(() => {
    api.systemUpdateStatus().then(s => { setStatus(s); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  // Poll when update is running
  useEffect(() => {
    if (status?.running) {
      pollRef.current = setInterval(async () => {
        try {
          const s = await api.systemUpdateStatus();
          setStatus(s);
          if (!s.running) clearInterval(pollRef.current);
        } catch {}
      }, 1200);
    }
    return () => clearInterval(pollRef.current);
  }, [status?.running]);

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [status?.log?.length]);

  async function checkUpdates() {
    setChecking(true);
    try {
      const res = await api.systemUpdateCheck();
      setStatus(s => ({ ...s, outdated: res.outdated }));
    } catch (e) { toast.error(e.message); }
    finally { setChecking(false); }
  }

  async function startUpdate() {
    const ok = await confirm('This will run npm install on server & client, then rebuild the frontend. Continue?', { title: 'Start Update', label: 'Update', danger: false });
    if (!ok) return;
    try {
      await api.systemUpdateStart();
      // Start polling immediately
      const s = await api.systemUpdateStatus();
      setStatus(s);
    } catch (e) { toast.error(e.message); }
  }

  async function restartServer() {
    const ok = await confirm('Restart the server now? You will be disconnected briefly.', { title: 'Restart Server', label: 'Restart' });
    if (!ok) return;
    setRestarting(true);
    try {
      await api.systemUpdateRestart();
    } catch {}
    // Server is restarting — wait then reload the page
    setTimeout(() => window.location.reload(), 5000);
  }

  // Count outdated packages
  const serverOutdated = Object.keys(status?.outdated?.server || {}).length;
  const clientOutdated = Object.keys(status?.outdated?.client || {}).length;
  const totalOutdated  = serverOutdated + clientOutdated;

  const phase    = status?.phase || 'idle';
  const phMeta   = PHASE_LABELS[phase] || PHASE_LABELS.idle;
  const isRunning = !!status?.running;
  const isDone    = phase === 'done';
  const isError   = phase === 'error';
  const updatesDisabled = status?.updates_enabled === false;

  const logLines = status?.log || [];

  if (loading) return <p className="text-muted">Loading…</p>;

  return (
    <div className="u-eccdaaf">

      {/* ── Header card ── */}
      <div className="card mb-16">
        <div className="u-0dda9e1">
          <div className="u-16a1fe0">
            <Download size={24} color="#fff" />
          </div>
          <div className="flex-1">
            <div className="u-43b65ef">System Update</div>
            <div className="u-5378421">
              Installs the latest npm packages for server &amp; client, rebuilds the frontend,
              and restarts the application.
            </div>
          </div>
          <div className="u-1e0f2f4">
            <button
              className="btn btn-ghost btn-sm inline-flex items-center gap-5"
              onClick={checkUpdates}
              disabled={checking || isRunning || updatesDisabled}
             
            >
              {checking ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={13} />}
              {checking ? 'Checking…' : 'Check for Updates'}
            </button>
            <button
              className="btn btn-primary btn-sm inline-flex items-center gap-5"
              onClick={startUpdate}
              disabled={isRunning || restarting || updatesDisabled}
             
            >
              {isRunning
                ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Updating…</>
                : <><Download size={13} /> Install &amp; Build</>
              }
            </button>
          </div>
        </div>
      </div>

      {/* ── Outdated packages ── */}
      {updatesDisabled && (
        <div
          className="card u-ff5cd8b"
        >
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <div className="u-0b422b6">
            In-app updates are disabled in this environment. Use the approved Docker and branch deployment pipeline.
          </div>
        </div>
      )}

      {status?.outdated !== null && status?.outdated !== undefined && (
        <div className="card mb-16">
          <div className="u-d18b41d">
            <Activity size={14} />
            Package Status
            {totalOutdated > 0
              ? <span className="u-42cefc6">
                  {totalOutdated} outdated
                </span>
              : <span className="u-d0dbc9c">
                  All up to date
                </span>
            }
          </div>
          {totalOutdated === 0 ? (
            <p className="u-d024ba9">
              <CheckCircle2 size={14} /> All packages are current.
            </p>
          ) : (
            <div className="u-8aed95a">
              {[['server', status.outdated.server], ['client', status.outdated.client]].map(([scope, pkgs]) => (
                Object.keys(pkgs).length > 0 && (
                  <div key={scope}>
                    <div className="u-d9e85d4">
                      {scope} ({Object.keys(pkgs).length})
                    </div>
                    <div className="flex-col gap-4">
                      {Object.entries(pkgs).slice(0, 10).map(([name, info]) => (
                        <div key={name} className="u-017da7d">
                          <span className="u-a82e7d9">{name}</span>
                          <span className="u-1e2ea2c">
                            <span className="u-497726e">{info.current}</span>
                            {' → '}
                            <span className="u-dce355a">{info.latest}</span>
                          </span>
                        </div>
                      ))}
                      {Object.keys(pkgs).length > 10 && (
                        <div className="u-058930d">
                          +{Object.keys(pkgs).length - 10} more…
                        </div>
                      )}
                    </div>
                  </div>
                )
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Progress steps ── */}
      {(isRunning || isDone || isError || logLines.length > 0) && (
        <div className="card mb-16">
          <div className="u-1fb4840">
            <Zap size={14} />
            Update Progress
            <span className="u-91580a3" style={{ color: phMeta.color }}>
              {phMeta.label}
            </span>
          </div>

          {/* Step indicators */}
          <div className="u-fdd1a13">
            {STEPS.map((step, i) => (
              <React.Fragment key={step.key}>
                <div className="u-08d6c17">
                  <StepDot phase={isError && phase !== step.key ? phase : phase} stepKey={step.key} />
                  <div className="u-8129b9e">{step.label}</div>
                </div>
                {i < STEPS.length - 1 && (
                  <div className="u-2cfd204" />
                )}
              </React.Fragment>
            ))}
          </div>

          {/* Log output */}
          <div className="u-19d86af">
            {logLines.length === 0
              ? <span className="u-064028e">Waiting for output…</span>
              : logLines.map((l, i) => {
                  const col = l.level === 'ok' ? '#4ade80' : l.level === 'error' ? '#f87171' : l.level === 'warn' ? '#fbbf24' : '#94a3b8';
                  return <div key={i} style={{ color: col }}>{l.msg}</div>;
                })
            }
            <div ref={logEndRef} />
          </div>

          {/* Timestamps */}
          {status?.started_at && (
            <div className="u-78c79f1">
              Started: {fmtDateTime(status.started_at)}
              {status.done_at && ` · Completed: ${fmtDateTime(status.done_at)}`}
            </div>
          )}
        </div>
      )}

      {/* ── Error banner ── */}
      {isError && status?.error && (
        <div className="u-230a533">
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <div><strong>Update failed:</strong> {status.error}</div>
        </div>
      )}

      {/* ── Restart card ── */}
      {isDone && status?.needs_restart && (
        <div className="u-d2b4194">
          <div className="flex-1">
            <div className="u-fe6e546">
              🚀 Update complete — restart required
            </div>
            <div className="u-db94630">
              The new client build is ready. Restart the server to serve the updated application to all users.
            </div>
          </div>
          <button
            className="btn btn-primary u-a1e050f"
            onClick={restartServer}
            disabled={restarting || updatesDisabled}
          >
            {restarting
              ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Restarting…</>
              : <><RefreshCw size={14} /> Restart Server Now</>
            }
          </button>
        </div>
      )}

      {restarting && (
        <div className="u-c5d7841">
          <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
          Server is restarting… the page will reload automatically in a few seconds.
        </div>
      )}
    </div>
  );
}

/* ── Audit Log Tab ───────────────────────────────────────── */
export function AuditLogTab() {
  const [rows,        setRows]        = useState([]);
  const [total,       setTotal]       = useState(0);
  const [auditUsers,  setAuditUsers]  = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [filter,      setFilter]      = useState({ entity_type: '', user_id: '', action: '', date_from: '', date_to: '' });
  const [offset,      setOffset]      = useState(0);
  const LIMIT = 50;

  const ENTITY_TYPES = ['project', 'milestone', 'task', 'visit', 'user'];
  const ACTIONS      = ['created', 'updated', 'deleted', 'completed', 'reopened', 'status_changed'];

  const load = useCallback(async (off = 0, filterOverride) => {
    setLoading(true);
    const f = filterOverride ?? filter;
    try {
      const params = { limit: LIMIT, offset: off };
      if (f.entity_type) params.entity_type = f.entity_type;
      if (f.user_id)     params.user_id     = f.user_id;
      if (f.action)      params.action       = f.action;
      if (f.date_from)   params.date_from    = f.date_from;
      if (f.date_to)     params.date_to      = f.date_to;
      const data = await api.auditLog(params);
      setRows(data.rows ?? []);
      setTotal(data.total ?? 0);
      setOffset(off);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => {
    api.auditLogUsers().then(setAuditUsers).catch(() => {});
    load(0);
  }, []);  

  function applyFilter(e) { e.preventDefault(); load(0); }

  const ENTITY_ICONS = { project: '📁', milestone: '◆', task: '✅', visit: '🔧', user: '👤' };
  const ACTION_COLORS = {
    created:  '#22c55e', updated: '#3b82f6', deleted: '#ef4444',
    completed: '#10b981', reopened: '#f59e0b', status_changed: '#8b5cf6',
  };

  return (
    <div>
      <div className="u-aba76af">
        <div>
          <div className="section-title m-0">Audit Log</div>
          <p className="text-sm text-muted u-7a21c6a">
            System-wide record of who changed what and when. {total > 0 && `${total} total entries.`}
          </p>
        </div>
        <button className="btn btn-ghost btn-sm inline-flex items-center gap-5" onClick={() => load(0)}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Filters */}
      <form onSubmit={applyFilter} className="u-bda3218">
        <div className="flex-col gap-3">
          <label className="u-bdcd12d">Entity Type</label>
          <select value={filter.entity_type} onChange={e => setFilter(f => ({ ...f, entity_type: e.target.value }))} className="u-5a5bc97">
            <option value="">All</option>
            {ENTITY_TYPES.map(et => <option key={et} value={et}>{et}</option>)}
          </select>
        </div>
        <div className="flex-col gap-3">
          <label className="u-bdcd12d">Action</label>
          <select value={filter.action} onChange={e => setFilter(f => ({ ...f, action: e.target.value }))} className="u-5a5bc97">
            <option value="">All</option>
            {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div className="flex-col gap-3">
          <label className="u-bdcd12d">User</label>
          <select value={filter.user_id} onChange={e => setFilter(f => ({ ...f, user_id: e.target.value }))} className="u-3575e56">
            <option value="">All users</option>
            {auditUsers.map(u => <option key={u.user_id} value={u.user_id}>{u.user_name}</option>)}
          </select>
        </div>
        <div className="flex-col gap-3">
          <label className="u-bdcd12d">From</label>
          <input type="date" value={filter.date_from} onChange={e => setFilter(f => ({ ...f, date_from: e.target.value }))} className="u-e6f862a" />
        </div>
        <div className="flex-col gap-3">
          <label className="u-bdcd12d">To</label>
          <input type="date" value={filter.date_to} onChange={e => setFilter(f => ({ ...f, date_to: e.target.value }))} className="u-e6f862a" />
        </div>
        <button type="submit" className="btn btn-primary btn-sm">Apply</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { const cleared = { entity_type: '', user_id: '', action: '', date_from: '', date_to: '' }; setFilter(cleared); load(0, cleared); }}>Clear</button>
      </form>

      {loading ? (
        <div className="u-9320eb7">
          <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-muted text-sm">No audit entries found for the selected filters.</p>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="u-7c07cdf">Date</th>
                  <th>User</th>
                  <th>Role</th>
                  <th>Entity</th>
                  <th>Action</th>
                  <th>Title</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td className="u-23713e2">
                      {fmtDate(r.created_at)}
                    </td>
                    <td className="u-160b067">{r.user_name || '—'}</td>
                    <td>
                      {r.user_role && <span className={`badge badge-${r.user_role}`}>{r.user_role}</span>}
                    </td>
                    <td>
                      <span className="text-sm">
                        {ENTITY_ICONS[r.entity_type] || '•'} {r.entity_type}
                        {r.entity_id ? <span className="u-74919f5">#{r.entity_id}</span> : null}
                      </span>
                    </td>
                    <td>
                      <span className="u-3a02a12" style={{ background: (ACTION_COLORS[r.action] || '#6b7280') + '18', color: ACTION_COLORS[r.action] || '#6b7280' }}>
                        {r.action}
                      </span>
                    </td>
                    <td className="u-f46b0f0">
                      {r.entity_title || '—'}
                    </td>
                    <td className="u-a96e237">
                      {r.detail || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          {total > LIMIT && (
            <div className="u-48db00f">
              <span>{offset + 1}–{Math.min(offset + LIMIT, total)} of {total}</span>
              <button className="btn btn-ghost btn-sm" disabled={offset === 0} onClick={() => load(Math.max(0, offset - LIMIT))}>← Prev</button>
              <button className="btn btn-ghost btn-sm" disabled={offset + LIMIT >= total} onClick={() => load(offset + LIMIT)}>Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── SECURITY TAB ────────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */
export function SecurityTab() {
  const toast = useToast();
  const [cfg, setCfg]     = useState({ password_expiry_days: 90 });
  const [saved, setSaved] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getSecuritySettings()
      .then(d => { if (d) { setCfg(d); setSaved(d); } setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const dirty = JSON.stringify(cfg) !== JSON.stringify(saved);

  async function save() {
    setSaving(true);
    try { await api.saveSecuritySettings(cfg); setSaved({ ...cfg }); toast.success('Security settings saved'); }
    catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  if (loading) return <p className="text-muted">Loading…</p>;

  return (
    <div className="u-cd90f7a">
      <div className="card mb-16">
        <div className="card-header">
          <h3 className="u-334fee5">
            <Lock size={15} /> Password Policy
          </h3>
        </div>
        <div className="u-01b9273">
          <div className="form-group">
            <label>Password Expiry</label>
            <select
              value={cfg.password_expiry_days}
              onChange={e => setCfg(c => ({ ...c, password_expiry_days: Number(e.target.value) }))}
              className="u-a5d7a03"
            >
              <option value={0}>Never expires</option>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days (recommended)</option>
              <option value={180}>180 days</option>
              <option value={365}>365 days</option>
            </select>
            <p className="text-sm text-muted mt-4">
              Users will be forced to set a new password after this period.
              Set to <em>Never expires</em> to disable the policy.
            </p>
          </div>
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-header">
          <h3 className="u-334fee5">
            <Shield size={15} /> Self-Service Reset
          </h3>
        </div>
        <div className="u-01b9273">
          <p className="text-sm text-muted">
            Users can reset their own password via the <em>Forgot your password?</em> link on the login
            page. A time-limited link (1 hour) is sent to their registered email address.
            Ensure SMTP is configured in <strong>Weekly Report → SMTP Settings</strong> for this to work.
          </p>
        </div>
      </div>

      <div className="u-b5c9733">
        <button className="btn btn-primary flex-center gap-6" onClick={save} disabled={saving || !dirty}
         >
          <Save size={13} /> {saving ? 'Saving…' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
