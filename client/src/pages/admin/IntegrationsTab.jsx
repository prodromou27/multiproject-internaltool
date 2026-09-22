import { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, Send, Bell, Save, Loader2, Settings } from 'lucide-react';
import { api } from '../../api';
import { Toggle } from './shared';
import RequestTrackerIntegration from './RequestTrackerIntegration';

/* ══════════════════════════════════════════════════════════ */
/* ── INTEGRATIONS TAB ────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */
export const DEFAULT_SETTINGS = {
  teams:  { enabled: false, webhook_url: '' },
  webex:  { enabled: false, bot_token: '', mode: 'both', space_id: '', test_email: '' },
  notify_on: { task_assigned: true, project_assigned: true, visit_assigned: true, report_submitted: true, visit_reminder: true },
};

export function IntegrationsTab() {
  const [cfg,    setCfg]    = useState(DEFAULT_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [testing,setTesting]= useState({});
  const [msg,    setMsg]    = useState('');
  const [err,    setErr]    = useState('');
  const [loaded, setLoaded] = useState(false);

  const [loadRetry,setLoadRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setErr(''); setLoaded(false);
    api.getIntegrations({ signal: controller.signal }).then(d => {
      if (controller.signal.aborted) return;
      if (d && Object.keys(d).length) {
        setCfg(prev => ({
          teams:     { ...DEFAULT_SETTINGS.teams,     ...d.teams },
          webex:     { ...DEFAULT_SETTINGS.webex,     ...d.webex },
          notify_on: { ...DEFAULT_SETTINGS.notify_on, ...d.notify_on },
        }));
      }
      setLoaded(true);
    }).catch(failure => { if (!controller.signal.aborted) setErr(failure.message); });
    return () => controller.abort();
  }, [loadRetry]);

  const setTeams  = (k, v) => setCfg(c => ({ ...c, teams: { ...c.teams,[k]: v,...(k==='webhook_url' ? { clear_webhook_url: false } : {}) } }));
  const setWebex  = (k, v) => setCfg(c => ({ ...c, webex: { ...c.webex,[k]: v,...(k==='bot_token' ? { clear_bot_token: false } : {}) } }));
  const setNotify = (k, v) => setCfg(c => ({ ...c, notify_on: { ...c.notify_on, [k]: v } }));

  async function save() {
    setSaving(true); setMsg(''); setErr('');
    try { await api.saveIntegrations(cfg); const updated = await api.getIntegrations(); setCfg({ teams: { ...DEFAULT_SETTINGS.teams,...updated.teams },webex: { ...DEFAULT_SETTINGS.webex,...updated.webex },notify_on: { ...DEFAULT_SETTINGS.notify_on,...updated.notify_on } }); setMsg('Settings saved successfully.'); }
    catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  async function test(platform) {
    setTesting(t => ({ ...t, [platform]: true })); setMsg(''); setErr('');
    try { const r = await api.testIntegration(platform, cfg); setMsg(r.message || `Test sent via ${platform}`); }
    catch (e) { setErr(e.message || 'Test failed'); }
    finally { setTesting(t => ({ ...t, [platform]: false })); }
  }

  if (!loaded && err) return <div className="error-msg" role="alert">{err} <button className="btn btn-ghost" onClick={() => setLoadRetry(value => value+1)}>Retry</button></div>;
  if (!loaded) return <p className="text-muted">Loading…</p>;

  const sectionStyle = { background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 10, padding: '20px 24px', marginBottom: 20 };
  const labelStyle   = { fontSize: 12, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6, display: 'block' };

  return (
    <fieldset disabled={saving || Object.values(testing).some(Boolean)} style={{ maxWidth: 680,border: 0,padding: 0 }}>
      {msg && <div className="alert alert-success" style={{ marginBottom: 16, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}><CheckCircle2 size={14} /> {msg}</div>}
      {err && <div className="alert alert-danger"  style={{ marginBottom: 16, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}><AlertTriangle size={14} /> {err}</div>}

      <RequestTrackerIntegration sectionStyle={sectionStyle} labelStyle={labelStyle} />

      <div style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: 8, background: '#e8f0fe', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="4" fill="#4a6cf7"/><path d="M13 7h5v2h-5V7zm0 3h5v2h-5v-2zm-6 5v-8h4a3 3 0 010 6H9v2H7zm2-4h2a1 1 0 000-2H9v2z" fill="white"/></svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Microsoft Teams</div>
            <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>Post to a channel via a Workflows (or legacy Incoming) webhook</div>
          </div>
          <Toggle checked={cfg.teams.enabled} onChange={v => setTeams('enabled', v)} label={cfg.teams.enabled ? 'Enabled' : 'Disabled'} />
        </div>
        {cfg.teams.enabled && (
          <>
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Incoming Webhook URL</label>
              <input type="password" autoComplete="new-password" value={cfg.teams.webhook_url} onChange={e => setTeams('webhook_url', e.target.value)} placeholder="https://prod-00.westeurope.logic.azure.com/workflows/..." />
              {cfg.teams.webhook_url_set && <p className="text-muted text-sm">{cfg.teams.clear_webhook_url ? 'Stored webhook will be removed when saved.' : 'Webhook configured. Leave blank to retain it.'} <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCfg(c => ({ ...c,teams: { ...c.teams,webhook_url: '',clear_webhook_url: !c.teams.clear_webhook_url } }))}>{cfg.teams.clear_webhook_url ? 'Keep stored webhook' : 'Remove stored webhook'}</button></p>}
              <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 4 }}>In Teams: channel → ··· → Workflows → "Post to a channel when a webhook request is received". Legacy *.webhook.office.com connector URLs also work.</div>
            </div>
            <button className="btn btn-ghost btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} disabled={(!cfg.teams.webhook_url && (!cfg.teams.webhook_url_set || cfg.teams.clear_webhook_url)) || testing.teams} onClick={() => test('teams')}>
              {testing.teams ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Sending…</> : <><Bell size={13} /> Send Test</>}
            </button>
          </>
        )}
      </div>

      <div style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: 8, background: '#e6f9f0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#00BF6F"/><path d="M8 10a4 4 0 108 0" stroke="white" strokeWidth="2" strokeLinecap="round"/><circle cx="12" cy="14" r="1.5" fill="white"/></svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Cisco Webex</div>
            <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>Send notifications via a Webex Bot</div>
          </div>
          <Toggle checked={cfg.webex.enabled} onChange={v => setWebex('enabled', v)} label={cfg.webex.enabled ? 'Enabled' : 'Disabled'} />
        </div>
        {cfg.webex.enabled && (
          <>
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Bot Access Token</label>
              <input type="password" autoComplete="new-password" value={cfg.webex.bot_token} onChange={e => setWebex('bot_token', e.target.value)} placeholder="Your Webex Bot access token" />
              {cfg.webex.bot_token_set && <p className="text-muted text-sm">{cfg.webex.clear_bot_token ? 'Stored token will be removed when saved.' : 'Token configured. Leave blank to retain it.'} <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCfg(c => ({ ...c,webex: { ...c.webex,bot_token: '',clear_bot_token: !c.webex.clear_bot_token } }))}>{cfg.webex.clear_bot_token ? 'Keep stored token' : 'Remove stored token'}</button></p>}
              <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 4 }}>Create a bot at <strong>developer.webex.com</strong> and paste its Access Token here.</div>
            </div>
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Delivery Mode</label>
              <div className="flex gap-8">
                {[['direct','Direct (email)'],['space','Space (room)'],['both','Both']].map(([v,l]) => (
                  <button key={v} className={'btn btn-sm ' + (cfg.webex.mode === v ? 'btn-primary' : 'btn-ghost')} onClick={() => setWebex('mode', v)}>{l}</button>
                ))}
              </div>
            </div>
            {(cfg.webex.mode === 'space' || cfg.webex.mode === 'both') && (
              <div className="form-group" style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Webex Space / Room ID</label>
                <input value={cfg.webex.space_id} onChange={e => setWebex('space_id', e.target.value)} placeholder="Y2lzY29zcGFyazovL3VzL1JPT00v..." />
              </div>
            )}
            {(cfg.webex.mode === 'direct' || cfg.webex.mode === 'both') && (
              <div className="form-group" style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Test Email (for test button only)</label>
                <input type="email" value={cfg.webex.test_email} onChange={e => setWebex('test_email', e.target.value)} placeholder="engineer@yourcompany.com" />
              </div>
            )}
            <button className="btn btn-ghost btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} disabled={!cfg.webex.bot_token || testing.webex} onClick={() => test('webex')}>
              {testing.webex ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Sending…</> : <><Bell size={13} /> Send Test</>}
            </button>
          </>
        )}
      </div>

      {(cfg.teams.enabled || cfg.webex.enabled) && (
        <div style={sectionStyle}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}><Bell size={15} /> Notification Events</div>
          <div style={{ fontSize: 12, color: 'var(--gray-500)', marginBottom: 16 }}>Choose which events trigger a notification.</div>
          <div className="flex-col gap-12">
            <Toggle checked={cfg.notify_on.task_assigned}    onChange={v => setNotify('task_assigned', v)}    label="Task assigned to an engineer" />
            <Toggle checked={cfg.notify_on.project_assigned} onChange={v => setNotify('project_assigned', v)} label="Engineer added to a project" />
            <Toggle checked={cfg.notify_on.visit_assigned}   onChange={v => setNotify('visit_assigned', v)}   label="Maintenance visit assigned to an engineer" />
            <Toggle checked={cfg.notify_on.report_submitted} onChange={v => setNotify('report_submitted', v)} label="Visit report submitted (to the space / channel)" />
            <Toggle checked={cfg.notify_on.visit_reminder}   onChange={v => setNotify('visit_reminder', v)}   label="Reminder the day before a maintenance visit" />
          </div>
        </div>
      )}

      <button className="btn btn-primary" onClick={save} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {saving ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</> : <><Save size={14} /> Save Integration Settings</>}
      </button>
    </fieldset>
  );
}
