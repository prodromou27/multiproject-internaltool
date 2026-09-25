import { useEffect, useState } from 'react';
import { AlertTriangle, Zap, ScrollText, Bell, Save, Loader2, RefreshCw, Download, ShieldAlert } from 'lucide-react';
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
    <div className="u-3f7efa5">
      {/* Live check card */}
      <div className="card mb-16">
        <div className="u-8f42c5f">
          <h3 className="u-334fee5">
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
            <p className="u-c55c866">
              Last checked: {fmtDateTime(lastCheck.checked_at)}
            </p>
            {lastCheck.alerts.length === 0
              ? <div className="u-d3cc753">✅ All systems healthy — no issues detected.</div>
              : lastCheck.alerts.map((a, i) => {
                  const c = LEVEL_COLORS[a.level] || LEVEL_COLORS.warning;
                  return (
                    <div key={i} className="u-3341873" style={{ background: c.bg, color: c.text }}>
                      <span className="u-1c642fd" style={{ background: c.dot }} />
                      <div><strong>{a.type.replace(/_/g, ' ')}</strong><br /><span className="u-f6411e3">{a.message}</span></div>
                    </div>
                  );
                })
            }
          </div>
        ) : (
          <p className="u-dd8016b">Click "Run Check Now" to scan for issues.</p>
        )}
      </div>

      {/* Alert preferences */}
      <div className="card mb-16">
        <div className="card-header">
          <h3 className="u-334fee5">
            <Bell size={15} /> Alert Preferences
          </h3>
          <span className="u-d65cb71">In-App / Email</span>
        </div>
        <table className="u-a55f31d">
          <thead>
            <tr>
              <th className="u-a295c4b">Alert</th>
              <th className="u-0fb8233">Enabled</th>
              <th className="u-0fb8233">Email</th>
            </tr>
          </thead>
          <tbody>
            {ALERT_TYPES.map(a => (
              <tr key={a.key} className="u-02c1276">
                <td className="u-4c62985">
                  <div className="u-b192d9f">{a.label}</div>
                  <div className="u-6755ac8">{a.desc}</div>
                </td>
                <td className="u-3c31141">
                  <input type="checkbox" checked={prefs[a.key]?.enabled ?? true}
                    onChange={e => setToggle(a.key, 'enabled', e.target.checked)}
                    className="u-0a83c50" />
                </td>
                <td className="u-3c31141">
                  <input type="checkbox" checked={prefs[a.key]?.email ?? false}
                    onChange={e => setToggle(a.key, 'email', e.target.checked)}
                    disabled={!prefs[a.key]?.enabled}
                    className="u-0a83c50" style={{ opacity: prefs[a.key]?.enabled ? 1 : 0.4 }} />
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
            <h3 className="u-334fee5">
              <AlertTriangle size={15} /> Recent System Alerts
            </h3>
          </div>
          {recentAlerts.map(n => (
            <div key={n.id} className="u-4775937">
              <div>
                <span className="font-medium">{n.title}</span>
                {n.body && <div className="u-711e404">{n.body}</div>}
              </div>
              <span className="u-0895817">{timeSince(n.created_at)}</span>
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
    <div className="u-b12974c">
      {/* Log Configuration */}
      <div className="card mb-16">
        <div className="card-header">
          <h3 className="u-334fee5">
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
          <select value={cfg.log_retention_days} onChange={e => set('log_retention_days', Number(e.target.value))} className="u-a828909">
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
          <h3 className="u-334fee5">
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
            <h3 className="u-334fee5">
              <Download size={15} /> Export Logs
            </h3>
          </div>
          <p className="u-2f19faf">
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
