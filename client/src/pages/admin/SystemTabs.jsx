import React, { useEffect, useState, useCallback } from 'react';
import { Shield, CheckCircle2, Lock, AlertTriangle, Zap, HardDrive, Save, Loader2, Activity, Settings, RefreshCw, Download, ShieldAlert } from 'lucide-react';
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
  const isError  = phase === 'error' && isActive;
  const color = isDone ? 'var(--success)' : isActive ? 'var(--primary)' : 'var(--gray-200)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%', background: color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, color: '#fff', fontWeight: 700,
        border: `2px solid ${color}`,
        transition: 'all .3s',
      }}>
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
      <div style={{ display: 'flex', gap: 6, marginBottom: 18 }} role="tablist" aria-label="System health section">
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
    <div style={{ maxWidth: 880 }}>
      <div className="card" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ width: 48, height: 48, borderRadius: 8, background: top.bg, color: top.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <TopIcon size={24} />
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{top.label}</div>
          <div style={{ fontSize: 13, color: 'var(--gray-500)', marginTop: 3 }}>
            Last checked {fmtDate(data.checked_at)}
          </div>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => load(true)}
          disabled={refreshing}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          {refreshing ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={13} />}
          Refresh
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        {[
          ['Environment', data.app?.node_env],
          ['Version', data.app?.version],
          ['Uptime', `${Math.floor((data.app?.uptime_seconds || 0) / 60)} min`],
          ['Process', data.app?.pid],
        ].map(([label, value]) => (
          <div key={label} className="card" style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: 11, color: 'var(--gray-400)', fontWeight: 700, textTransform: 'uppercase' }}>{label}</div>
            <div style={{ fontSize: 15, fontWeight: 800, marginTop: 4 }}>{value || '-'}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-header">
          <h3 style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7 }}>
            <HardDrive size={15} /> Deployment Checklist
          </h3>
        </div>
        <div style={{ padding: '6px 20px 14px' }}>
          {(data.checks || []).map(check => {
            const m = meta[check.status] || meta.warning;
            const Icon = m.Icon;
            return (
              <div key={check.key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 0', borderBottom: '1px solid var(--gray-100)' }}>
                <Icon size={16} color={m.color} style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{check.label}</div>
                  <div style={{ color: 'var(--gray-500)', fontSize: 12, marginTop: 2, lineHeight: 1.45 }}>{check.detail}</div>
                </div>
              </div>
            );
          })}
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
    <div style={{ maxWidth: 780 }}>

      {/* ── Header card ── */}
      <div className="card mb-16">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div style={{
            width: 52, height: 52, borderRadius: 12, flexShrink: 0,
            background: 'linear-gradient(135deg, #1d4ed8, #6366f1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Download size={24} color="#fff" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 3 }}>System Update</div>
            <div style={{ fontSize: 13, color: 'var(--gray-500)', lineHeight: 1.5 }}>
              Installs the latest npm packages for server &amp; client, rebuilds the frontend,
              and restarts the application.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={checkUpdates}
              disabled={checking || isRunning || updatesDisabled}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
            >
              {checking ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={13} />}
              {checking ? 'Checking…' : 'Check for Updates'}
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={startUpdate}
              disabled={isRunning || restarting || updatesDisabled}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
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
          className="card"
          style={{
            marginBottom: 16,
            borderColor: '#fde68a',
            background: 'var(--warning-light)',
            color: 'var(--tone-warning-text)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
          }}
        >
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>
            In-app updates are disabled in this environment. Use the approved Docker and branch deployment pipeline.
          </div>
        </div>
      )}

      {status?.outdated !== null && status?.outdated !== undefined && (
        <div className="card mb-16">
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 7 }}>
            <Activity size={14} />
            Package Status
            {totalOutdated > 0
              ? <span style={{ background: 'var(--warning-light)', color: 'var(--tone-warning-text)', borderRadius: 99, padding: '1px 8px', fontSize: 11, fontWeight: 700, marginLeft: 4 }}>
                  {totalOutdated} outdated
                </span>
              : <span style={{ background: 'var(--success-light)', color: 'var(--tone-success-text)', borderRadius: 99, padding: '1px 8px', fontSize: 11, fontWeight: 700, marginLeft: 4 }}>
                  All up to date
                </span>
            }
          </div>
          {totalOutdated === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <CheckCircle2 size={14} /> All packages are current.
            </p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[['server', status.outdated.server], ['client', status.outdated.client]].map(([scope, pkgs]) => (
                Object.keys(pkgs).length > 0 && (
                  <div key={scope}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
                      {scope} ({Object.keys(pkgs).length})
                    </div>
                    <div className="flex-col gap-4">
                      {Object.entries(pkgs).slice(0, 10).map(([name, info]) => (
                        <div key={name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, padding: '4px 8px', background: 'var(--gray-50)', borderRadius: 6 }}>
                          <span style={{ fontWeight: 600, color: '#374151' }}>{name}</span>
                          <span style={{ color: 'var(--gray-400)' }}>
                            <span style={{ color: 'var(--danger)' }}>{info.current}</span>
                            {' → '}
                            <span style={{ color: 'var(--success)', fontWeight: 700 }}>{info.latest}</span>
                          </span>
                        </div>
                      ))}
                      {Object.keys(pkgs).length > 10 && (
                        <div style={{ fontSize: 11, color: 'var(--gray-400)', paddingLeft: 8 }}>
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
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 7 }}>
            <Zap size={14} />
            Update Progress
            <span style={{ marginLeft: 'auto', fontSize: 12, color: phMeta.color, fontWeight: 600 }}>
              {phMeta.label}
            </span>
          </div>

          {/* Step indicators */}
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
            {STEPS.map((step, i) => (
              <React.Fragment key={step.key}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                  <StepDot phase={isError && phase !== step.key ? phase : phase} stepKey={step.key} />
                  <div style={{ fontSize: 10, color: 'var(--gray-500)', marginTop: 4, textAlign: 'center' }}>{step.label}</div>
                </div>
                {i < STEPS.length - 1 && (
                  <div style={{ height: 2, flex: 0.5, background: 'var(--gray-100)', marginBottom: 14, borderRadius: 1 }} />
                )}
              </React.Fragment>
            ))}
          </div>

          {/* Log output */}
          <div style={{
            background: '#0f172a', borderRadius: 8, padding: '12px 14px',
            maxHeight: 280, overflowY: 'auto', fontFamily: 'monospace',
            fontSize: 12, lineHeight: 1.6,
          }}>
            {logLines.length === 0
              ? <span style={{ color: '#64748b' }}>Waiting for output…</span>
              : logLines.map((l, i) => {
                  const col = l.level === 'ok' ? '#4ade80' : l.level === 'error' ? '#f87171' : l.level === 'warn' ? '#fbbf24' : '#94a3b8';
                  return <div key={i} style={{ color: col }}>{l.msg}</div>;
                })
            }
            <div ref={logEndRef} />
          </div>

          {/* Timestamps */}
          {status?.started_at && (
            <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 8 }}>
              Started: {fmtDateTime(status.started_at)}
              {status.done_at && ` · Completed: ${fmtDateTime(status.done_at)}`}
            </div>
          )}
        </div>
      )}

      {/* ── Error banner ── */}
      {isError && status?.error && (
        <div style={{ background: 'var(--danger-light)', border: '1px solid #fecaca', borderRadius: 8, padding: '12px 16px', marginBottom: 16, color: 'var(--tone-danger-text)', fontSize: 13, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <div><strong>Update failed:</strong> {status.error}</div>
        </div>
      )}

      {/* ── Restart card ── */}
      {isDone && status?.needs_restart && (
        <div style={{ background: 'var(--primary-light)', border: '1px solid #bfdbfe', borderRadius: 10, padding: '16px 20px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--tone-info-text)', marginBottom: 3 }}>
              🚀 Update complete — restart required
            </div>
            <div style={{ fontSize: 13, color: '#3b82f6' }}>
              The new client build is ready. Restart the server to serve the updated application to all users.
            </div>
          </div>
          <button
            className="btn btn-primary"
            onClick={restartServer}
            disabled={restarting || updatesDisabled}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
          >
            {restarting
              ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Restarting…</>
              : <><RefreshCw size={14} /> Restart Server Now</>
            }
          </button>
        </div>
      )}

      {restarting && (
        <div style={{ background: 'var(--warning-light)', border: '1px solid #fde68a', borderRadius: 8, padding: '12px 16px', fontSize: 13, color: 'var(--tone-warning-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function applyFilter(e) { e.preventDefault(); load(0); }

  const ENTITY_ICONS = { project: '📁', milestone: '◆', task: '✅', visit: '🔧', user: '👤' };
  const ACTION_COLORS = {
    created:  '#22c55e', updated: '#3b82f6', deleted: '#ef4444',
    completed: '#10b981', reopened: '#f59e0b', status_changed: '#8b5cf6',
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div className="section-title" style={{ margin: 0 }}>Audit Log</div>
          <p className="text-sm text-muted" style={{ marginTop: 2 }}>
            System-wide record of who changed what and when. {total > 0 && `${total} total entries.`}
          </p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => load(0)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Filters */}
      <form onSubmit={applyFilter} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, alignItems: 'flex-end' }}>
        <div className="flex-col gap-3">
          <label style={{ fontSize: 11, color: 'var(--gray-500)', fontWeight: 600 }}>Entity Type</label>
          <select value={filter.entity_type} onChange={e => setFilter(f => ({ ...f, entity_type: e.target.value }))} style={{ width: 130, fontSize: 12 }}>
            <option value="">All</option>
            {ENTITY_TYPES.map(et => <option key={et} value={et}>{et}</option>)}
          </select>
        </div>
        <div className="flex-col gap-3">
          <label style={{ fontSize: 11, color: 'var(--gray-500)', fontWeight: 600 }}>Action</label>
          <select value={filter.action} onChange={e => setFilter(f => ({ ...f, action: e.target.value }))} style={{ width: 130, fontSize: 12 }}>
            <option value="">All</option>
            {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div className="flex-col gap-3">
          <label style={{ fontSize: 11, color: 'var(--gray-500)', fontWeight: 600 }}>User</label>
          <select value={filter.user_id} onChange={e => setFilter(f => ({ ...f, user_id: e.target.value }))} style={{ width: 150, fontSize: 12 }}>
            <option value="">All users</option>
            {auditUsers.map(u => <option key={u.user_id} value={u.user_id}>{u.user_name}</option>)}
          </select>
        </div>
        <div className="flex-col gap-3">
          <label style={{ fontSize: 11, color: 'var(--gray-500)', fontWeight: 600 }}>From</label>
          <input type="date" value={filter.date_from} onChange={e => setFilter(f => ({ ...f, date_from: e.target.value }))} style={{ width: 140, fontSize: 12 }} />
        </div>
        <div className="flex-col gap-3">
          <label style={{ fontSize: 11, color: 'var(--gray-500)', fontWeight: 600 }}>To</label>
          <input type="date" value={filter.date_to} onChange={e => setFilter(f => ({ ...f, date_to: e.target.value }))} style={{ width: 140, fontSize: 12 }} />
        </div>
        <button type="submit" className="btn btn-primary btn-sm">Apply</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { const cleared = { entity_type: '', user_id: '', action: '', date_from: '', date_to: '' }; setFilter(cleared); load(0, cleared); }}>Clear</button>
      </form>

      {loading ? (
        <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--gray-400)' }}>
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
                  <th style={{ width: 150 }}>Date</th>
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
                    <td style={{ fontSize: 11, color: 'var(--gray-500)', whiteSpace: 'nowrap' }}>
                      {fmtDate(r.created_at)}
                    </td>
                    <td style={{ fontWeight: 600, fontSize: 13 }}>{r.user_name || '—'}</td>
                    <td>
                      {r.user_role && <span className={`badge badge-${r.user_role}`}>{r.user_role}</span>}
                    </td>
                    <td>
                      <span style={{ fontSize: 12 }}>
                        {ENTITY_ICONS[r.entity_type] || '•'} {r.entity_type}
                        {r.entity_id ? <span style={{ color: 'var(--gray-400)', marginLeft: 4 }}>#{r.entity_id}</span> : null}
                      </span>
                    </td>
                    <td>
                      <span style={{
                        display: 'inline-block', padding: '1px 8px', borderRadius: 8,
                        fontSize: 11, fontWeight: 700,
                        background: (ACTION_COLORS[r.action] || '#6b7280') + '18',
                        color: ACTION_COLORS[r.action] || '#6b7280',
                      }}>
                        {r.action}
                      </span>
                    </td>
                    <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
                      {r.entity_title || '—'}
                    </td>
                    <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: 'var(--gray-500)' }}>
                      {r.detail || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          {total > LIMIT && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, justifyContent: 'flex-end', fontSize: 12, color: 'var(--gray-500)' }}>
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
    <div style={{ maxWidth: 600 }}>
      <div className="card mb-16">
        <div className="card-header">
          <h3 style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7 }}>
            <Lock size={15} /> Password Policy
          </h3>
        </div>
        <div style={{ padding: '16px 20px' }}>
          <div className="form-group">
            <label>Password Expiry</label>
            <select
              value={cfg.password_expiry_days}
              onChange={e => setCfg(c => ({ ...c, password_expiry_days: Number(e.target.value) }))}
              style={{ maxWidth: 240 }}
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
          <h3 style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7 }}>
            <Shield size={15} /> Self-Service Reset
          </h3>
        </div>
        <div style={{ padding: '16px 20px' }}>
          <p className="text-sm text-muted">
            Users can reset their own password via the <em>Forgot your password?</em> link on the login
            page. A time-limited link (1 hour) is sent to their registered email address.
            Ensure SMTP is configured in <strong>Weekly Report → SMTP Settings</strong> for this to work.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-primary flex-center gap-6" onClick={save} disabled={saving || !dirty}
         >
          <Save size={13} /> {saving ? 'Saving…' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
