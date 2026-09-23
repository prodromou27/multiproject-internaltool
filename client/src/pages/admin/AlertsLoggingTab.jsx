import { useEffect, useState } from 'react';
import { AlertTriangle, Zap, ScrollText, Bell, Save, Loader2, Settings, RefreshCw, Download, ShieldAlert, Database } from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../../components/Toast';
import { timeSince, ToggleRow } from './shared';
import { fmtDateTime } from '../../components/Shared';

/* ── Admin Alerts Tab ────────────────────────────────────── */
export const ALERT_TYPES = [
  { key: 'background_job_failed',      label: 'Background job failed',           desc: 'A scheduled or background task did not complete successfully.' },
  { key: 'email_queue_failed',         label: 'Email queue has failed messages',  desc: 'One or more outbound emails could not be delivered.' },
  { key: 'db_backup_failed',           label: 'Database backup failed',           desc: 'The automatic database backup job failed.' },
  { key: 'storage_almost_full',        label: 'File storage almost full',         desc: 'Upload storage is approaching the configured threshold.' },
  { key: 'high_error_rate',            label: 'High error rate detected',         desc: 'The number of application errors has exceeded the threshold.' },
  { key: 'unauthorized_access',        label: 'Unauthorized access attempt',      desc: 'Repeated failed login attempts or forbidden access detected.' },
  { key: 'integration_token_expiring', label: 'Integration token expiring',       desc: 'A webhook or API token is missing or about to expire.' },
];

export const ALERT_DEFAULT = Object.fromEntries(ALERT_TYPES.map(a => [a.key, { enabled: true, email: false }]));

export function AdminAlertsTab() {
  const toast = useToast();
  const [prefs, setPrefs]   = useState(ALERT_DEFAULT);
  const [saved, setSaved]   = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [lastCheck, setLastCheck] = useState(null);
  const [recentAlerts, setRecentAlerts] = useState([]);

  useEffect(() => {
    Promise.all([api.getAdminNotifications(), api.notifications()])
      .then(([p, notes]) => {
        setPrefs(p); setSaved(p);
        const list = notes.notifications || notes || [];
        setRecentAlerts(list.filter(n => n.type === 'system_alert').slice(0, 20));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const setToggle = (key, field, val) => setPrefs(p => ({ ...p, [key]: { ...p[key], [field]: val } }));
  const dirty = JSON.stringify(prefs) !== JSON.stringify(saved);

  async function save() {
    setSaving(true);
    try { await api.saveAdminNotifications(prefs); setSaved({ ...prefs }); toast.success('Alert preferences saved'); }
    catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  async function runCheck() {
    setChecking(true);
    try {
      const result = await api.runSystemCheck();
      setLastCheck(result);
      const notes = await api.notifications();
      const list = notes.notifications || notes || [];
      setRecentAlerts(list.filter(n => n.type === 'system_alert').slice(0, 20));
    } catch (e) { toast.error(e.message); }
    finally { setChecking(false); }
  }

  if (loading) return <p className="text-muted">Loading…</p>;

  const LEVEL_COLORS = { warning: { bg: '#fef3c7', text: '#92400e', dot: '#f59e0b' }, error: { bg: '#fee2e2', text: '#991b1b', dot: '#ef4444' }, ok: { bg: '#dcfce7', text: '#166534', dot: '#22c55e' } };

  return (
    <div style={{ maxWidth: 800 }}>
      {/* Live check card */}
      <div className="card mb-16">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7 }}>
            <ShieldAlert size={15} /> System Health Check
          </h3>
          <button className="btn btn-ghost btn-sm inline-flex items-center gap-5" onClick={runCheck} disabled={checking}
           >
            {checking ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={13} />}
            {checking ? 'Checking…' : 'Run Check Now'}
          </button>
        </div>

        {lastCheck ? (
          <div>
            <p style={{ fontSize: 12, color: 'var(--gray-400)', marginBottom: 10 }}>
              Last checked: {fmtDateTime(lastCheck.checked_at)}
            </p>
            {lastCheck.alerts.length === 0
              ? <div style={{ padding: '10px 14px', background: 'var(--success-light)', borderRadius: 8, color: 'var(--tone-success-text)', fontSize: 13 }}>✅ All systems healthy — no issues detected.</div>
              : lastCheck.alerts.map((a, i) => {
                  const c = LEVEL_COLORS[a.level] || LEVEL_COLORS.warning;
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 12px', background: c.bg, borderRadius: 8, color: c.text, fontSize: 13, marginBottom: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.dot, flexShrink: 0, marginTop: 4 }} />
                      <div><strong>{a.type.replace(/_/g, ' ')}</strong><br /><span style={{ opacity: .85 }}>{a.message}</span></div>
                    </div>
                  );
                })
            }
          </div>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--gray-400)' }}>Click "Run Check Now" to scan for issues.</p>
        )}
      </div>

      {/* Alert preferences */}
      <div className="card mb-16">
        <div className="card-header">
          <h3 style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7 }}>
            <Bell size={15} /> Alert Preferences
          </h3>
          <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>In-App / Email</span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '6px 0', fontSize: 11, color: 'var(--gray-400)', fontWeight: 600, borderBottom: '1px solid var(--gray-100)' }}>Alert</th>
              <th style={{ textAlign: 'center', padding: '6px 8px', fontSize: 11, color: 'var(--gray-400)', fontWeight: 600, borderBottom: '1px solid var(--gray-100)', width: 80 }}>Enabled</th>
              <th style={{ textAlign: 'center', padding: '6px 8px', fontSize: 11, color: 'var(--gray-400)', fontWeight: 600, borderBottom: '1px solid var(--gray-100)', width: 80 }}>Email</th>
            </tr>
          </thead>
          <tbody>
            {ALERT_TYPES.map(a => (
              <tr key={a.key} style={{ borderBottom: '1px solid var(--gray-100)' }}>
                <td style={{ padding: '10px 0' }}>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{a.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 1 }}>{a.desc}</div>
                </td>
                <td style={{ textAlign: 'center', padding: '10px 8px' }}>
                  <input type="checkbox" checked={prefs[a.key]?.enabled ?? true}
                    onChange={e => setToggle(a.key, 'enabled', e.target.checked)}
                    style={{ width: 15, height: 15, cursor: 'pointer', accentColor: 'var(--primary)' }} />
                </td>
                <td style={{ textAlign: 'center', padding: '10px 8px' }}>
                  <input type="checkbox" checked={prefs[a.key]?.email ?? false}
                    onChange={e => setToggle(a.key, 'email', e.target.checked)}
                    disabled={!prefs[a.key]?.enabled}
                    style={{ width: 15, height: 15, cursor: 'pointer', accentColor: 'var(--primary)', opacity: prefs[a.key]?.enabled ? 1 : 0.4 }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Recent system alerts */}
      {recentAlerts.length > 0 && (
        <div className="card mb-16">
          <div className="card-header">
            <h3 style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7 }}>
              <AlertTriangle size={15} /> Recent System Alerts
            </h3>
          </div>
          {recentAlerts.map(n => (
            <div key={n.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid var(--gray-100)', fontSize: 13 }}>
              <div>
                <span className="font-medium">{n.title}</span>
                {n.body && <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 2 }}>{n.body}</div>}
              </div>
              <span style={{ fontSize: 11, color: 'var(--gray-400)', whiteSpace: 'nowrap', marginLeft: 16 }}>{timeSince(n.created_at)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-10">
        <button className="btn btn-primary inline-flex items-center gap-6" disabled={!dirty || saving} onClick={save}
         >
          {saving ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={14} />}
          {saving ? 'Saving…' : 'Save Preferences'}
        </button>
        {dirty && <button className="btn btn-ghost" onClick={() => setPrefs({ ...saved })}>Discard Changes</button>}
      </div>
    </div>
  );
}

/* ── Logging Settings Tab ────────────────────────────────── */
export const DEFAULT_LOGGING = {
  log_level: 'info', logging_provider: 'file', log_retention_days: 30,
  structured_logging: true, correlation_id_enabled: true, request_logging: true,
  exception_logging: true, sensitive_data_masking: false, log_download_enabled: true,
};

export function LoggingTab() {
  const toast = useToast();
  const [cfg, setCfg]     = useState(DEFAULT_LOGGING);
  const [saved, setSaved] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getLogging().then(d => { if (d) { setCfg(d); setSaved(d); } setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const set = (k, v) => setCfg(c => ({ ...c, [k]: v }));
  const dirty = JSON.stringify(cfg) !== JSON.stringify(saved);

  async function save() {
    setSaving(true);
    try { await api.saveLogging(cfg); setSaved({ ...cfg }); toast.success('Logging settings saved'); }
    catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  if (loading) return <p className="text-muted">Loading…</p>;

  return (
    <div style={{ maxWidth: 720 }}>
      {/* Log Configuration */}
      <div className="card mb-16">
        <div className="card-header">
          <h3 style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7 }}>
            <ScrollText size={15} /> Log Configuration
          </h3>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Log Level</label>
            <select value={cfg.log_level} onChange={e => set('log_level', e.target.value)}>
              <option value="error">Error</option>
              <option value="warning">Warning</option>
              <option value="info">Info</option>
              <option value="debug">Debug</option>
            </select>
            <p className="text-sm text-muted mt-4">Controls verbosity. Debug captures the most detail.</p>
          </div>
          <div className="form-group">
            <label>Logging Provider</label>
            <select value={cfg.logging_provider} onChange={e => set('logging_provider', e.target.value)}>
              <option value="file">File</option>
              <option value="database">Database</option>
              <option value="application_insights">Application Insights</option>
              <option value="seq">Seq</option>
            </select>
            <p className="text-sm text-muted mt-4">Where logs are persisted.</p>
          </div>
        </div>

        <div className="form-group">
          <label>Log Retention</label>
          <select value={cfg.log_retention_days} onChange={e => set('log_retention_days', Number(e.target.value))} style={{ maxWidth: 200 }}>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={180}>180 days</option>
          </select>
          <p className="text-sm text-muted mt-4">Logs older than this will be purged automatically.</p>
        </div>
      </div>

      {/* Feature toggles */}
      <div className="card mb-16">
        <div className="card-header">
          <h3 style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7 }}>
            <Zap size={15} /> Logging Features
          </h3>
        </div>
        <ToggleRow
          label="Structured Logging" recommended
          description="Emit logs as JSON for easier parsing and filtering."
          value={cfg.structured_logging} onChange={v => set('structured_logging', v)}
        />
        <ToggleRow
          label="Correlation ID"
          description="Attach a unique ID to every request to trace actions across services."
          value={cfg.correlation_id_enabled} onChange={v => set('correlation_id_enabled', v)}
        />
        <ToggleRow
          label="Request Logging"
          description="Log all incoming HTTP requests (method, path, status, duration)."
          value={cfg.request_logging} onChange={v => set('request_logging', v)}
        />
        <ToggleRow
          label="Exception Logging"
          description="Capture and log all unhandled exceptions with stack traces."
          value={cfg.exception_logging} onChange={v => set('exception_logging', v)}
        />
        <ToggleRow
          label="Sensitive Data Masking"
          description="Automatically redact passwords, tokens, and email addresses from logs."
          value={cfg.sensitive_data_masking} onChange={v => set('sensitive_data_masking', v)}
        />
        <ToggleRow
          label="Log Download"
          description="Allow admins to export activity logs as a CSV file for troubleshooting."
          value={cfg.log_download_enabled} onChange={v => set('log_download_enabled', v)}
        />
      </div>

      {/* Log download */}
      {cfg.log_download_enabled && saved?.log_download_enabled && (
        <div className="card mb-16">
          <div className="card-header">
            <h3 style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7 }}>
              <Download size={15} /> Export Logs
            </h3>
          </div>
          <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 14 }}>
            Download recent application activity as a CSV file (up to last 1 000 entries).
            {cfg.sensitive_data_masking && <strong> Sensitive data masking is active.</strong>}
          </p>
          <button className="btn btn-ghost inline-flex items-center gap-6"
            onClick={() => api.downloadLogs()}>
            <Download size={14} /> Download Log CSV
          </button>
        </div>
      )}

      {/* Save */}
      <div className="flex gap-10">
        <button className="btn btn-primary inline-flex items-center gap-6" disabled={!dirty || saving} onClick={save}
         >
          {saving ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={14} />}
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
        {dirty && (
          <button className="btn btn-ghost" onClick={() => setCfg({ ...saved })}>Discard Changes</button>
        )}
      </div>
    </div>
  );
}
