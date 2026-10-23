import { useEffect, useState } from 'react';
import { LoadError } from '../../components/LoadError';
import { CheckCircle2, AlertTriangle, Bell, Save, Loader2, AtSign } from 'lucide-react';
import { api } from '../../api';
import { PRODUCT_NAME } from '../../product';

/* Settings → Email (SMTP): the mail server every email from the app goes through
   (the weekly report, reminders, password resets, email confirmations). */
export function EmailSettingsTab() {
  const [smtp,        setSmtp]        = useState({ host:'', port:587, secure:false, user:'', password:'', from_name:PRODUCT_NAME, from_email:'' });
  const [smtpSaving,  setSmtpSaving]  = useState(false);
  const [smtpTesting, setSmtpTesting] = useState(false);
  const [smtpMsg,     setSmtpMsg]     = useState(null);
  const [testTo,      setTestTo]      = useState('');
  const set = k => e => setSmtp(s => ({ ...s, [k]: e.target.value }));
  // The form appears only once the stored settings are in: a failed load must not
  // look like an empty server that Save would then overwrite.
  const [loadState, setLoadState] = useState({ status: 'loading', error: '' });
  const load = () => {
    setLoadState({ status: 'loading', error: '' });
    api.getSmtp().then(s => {
      if (s && Object.keys(s).length > 0) setSmtp(prev => ({ ...prev, ...s, password: s.password_set ? '••••••••' : '' }));
      setLoadState({ status: 'ready', error: '' });
    }).catch(failure => setLoadState({ status: 'error', error: failure.message }));
  };
  useEffect(load, []);

  async function saveSmtp(e) {
    e.preventDefault();
    setSmtpSaving(true); setSmtpMsg(null);
    try {
      await api.saveSmtp(smtp);
      setSmtpMsg({ ok: true, text: 'SMTP settings saved.' });
    } catch (err) { setSmtpMsg({ ok: false, text: err.message }); }
    finally { setSmtpSaving(false); }
  }

  async function testSmtp() {
    setSmtpTesting(true); setSmtpMsg(null);
    try {
      const res = await api.testSmtp({ ...smtp, password: smtp.password === '••••••••' ? undefined : smtp.password }, testTo || undefined);
      setSmtpMsg({ ok: true, text: res.message || 'Connection successful!' });
    } catch (err) { setSmtpMsg({ ok: false, text: err.message }); }
    finally { setSmtpTesting(false); }
  }

  if (loadState.status === 'error') return <LoadError what="The email settings" error={loadState.error} onRetry={load} />;
  if (loadState.status === 'loading') return <p className="text-muted" role="status">Loading…</p>;
  return (
        <div className="card u-969a912">
      <h3 className="u-1fb1cdf">
        <AtSign size={15} color="var(--primary)" /> Email SMTP Configuration
      </h3>
      {smtpMsg && (
        <div className={`alert ${smtpMsg.ok ? 'alert-success' : 'alert-warning'} u-da12f28`}>
          {smtpMsg.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />} {smtpMsg.text}
        </div>
      )}
      <form onSubmit={saveSmtp}>
        <div className="form-row">
          <div className="form-group">
            <label>SMTP Host</label>
            <input aria-label="SMTP Host" value={smtp.host || ''} onChange={set('host')} placeholder="smtp.gmail.com" required />
          </div>
          <div className="form-group u-d579dc3">
            <label>Port</label>
            <input aria-label="Port" type="number" value={smtp.port || 587} onChange={set('port')} />
          </div>
        </div>
        <div className="form-group">
          <label className="u-c92fd94">
            <input type="checkbox" checked={!!smtp.secure} onChange={e => setSmtp(s => ({ ...s, secure: e.target.checked }))} className="u-30e741d" />
            Use SSL/TLS (port 465)
          </label>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Username / Email</label>
            <input aria-label="Username / Email" value={smtp.user || ''} onChange={set('user')} placeholder="noreply@company.com" />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input aria-label="Password" type="password" value={smtp.password || ''} onChange={set('password')} placeholder="•••••••" />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>From Name</label>
            <input aria-label="From Name" value={smtp.from_name || ''} onChange={set('from_name')} placeholder={PRODUCT_NAME} />
          </div>
          <div className="form-group">
            <label>From Email</label>
            <input aria-label="From Email" value={smtp.from_email || ''} onChange={set('from_email')} placeholder="noreply@company.com" />
          </div>
        </div>
        <div className="u-1161952">
          <button type="submit" className="btn btn-primary btn-sm inline-flex items-center gap-6" disabled={smtpSaving}>
            {smtpSaving ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={13} />} Save SMTP
          </button>
          <button type="button" className="btn btn-ghost btn-sm inline-flex items-center gap-6" disabled={smtpTesting} onClick={testSmtp}>
            {smtpTesting ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Bell size={13} />} Test Connection
          </button>
        </div>
        <div className="u-012c803">
          <input aria-label="Send a test email to" value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="Send test email to…" className="u-7829123" />
        </div>
      </form>
    </div>
  );
}
