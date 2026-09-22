import { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, Send, ScrollText, Bell, Save, Loader2, Settings, AtSign, ExternalLink } from 'lucide-react';
import { api } from '../../api';
import { Modal, fmtDateTime } from '../../components/Shared';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/Confirm';

/* ══════════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════════ */
/* ── Weekly Report Tab ───────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */
export const DAY_OPTIONS = [
  { v: 0, l: 'Sunday' }, { v: 1, l: 'Monday' }, { v: 2, l: 'Tuesday' },
  { v: 3, l: 'Wednesday' }, { v: 4, l: 'Thursday' }, { v: 5, l: 'Friday' }, { v: 6, l: 'Saturday' },
];

export function WeeklyReportTab() {
  const toast   = useToast();
  const confirm = useConfirm();
  // ── SMTP state ────────────────────────────────────────────
  const [smtp,        setSmtp]        = useState({ host:'', port:587, secure:false, user:'', password:'', from_name:'Solutions Hub', from_email:'' });
  const [smtpSaving,  setSmtpSaving]  = useState(false);
  const [smtpTesting, setSmtpTesting] = useState(false);
  const [smtpMsg,     setSmtpMsg]     = useState(null);
  const [testTo,      setTestTo]      = useState('');

  // ── Schedule state ────────────────────────────────────────
  const [schedule,    setSchedule]    = useState({ enabled: false, day: 1, hour: 9, minute: 0, recipients: [], last_sent: null });
  const [managers,    setManagers]    = useState([]);
  const [schedSaving, setSchedSaving] = useState(false);
  const [schedMsg,    setSchedMsg]    = useState(null);

  // ── Preview / Send state ──────────────────────────────────
  const [preview,     setPreview]     = useState(null);
  const [previewing,  setPreviewing]  = useState(false);
  const [sending,     setSending]     = useState(false);
  const [sendMsg,     setSendMsg]     = useState(null);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    api.getSmtp().then(s => {
      if (s && Object.keys(s).length > 0) setSmtp(prev => ({ ...prev, ...s, password: s.password_set ? '••••••••' : '' }));
    }).catch(() => {});
    api.getReportSchedule().then(setSchedule).catch(() => {});
    api.reportManagers().then(setManagers).catch(() => {});
  }, []);

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

  async function saveSchedule(e) {
    e.preventDefault();
    setSchedSaving(true); setSchedMsg(null);
    try {
      await api.saveReportSchedule(schedule);
      setSchedMsg({ ok: true, text: 'Schedule saved. Scheduler updated.' });
    } catch (err) { setSchedMsg({ ok: false, text: err.message }); }
    finally { setSchedSaving(false); }
  }

  async function loadPreview() {
    setPreviewing(true); setPreview(null);
    try {
      const data = await api.previewReportData();
      setPreview(data);
      setShowPreview(true);
    } catch (err) { toast.error('Preview failed: ' + err.message); }
    finally { setPreviewing(false); }
  }

  async function sendNow() {
    const ok = await confirm('Send the weekly report now to all configured recipients?', { title: 'Send Report Now', label: 'Send', danger: false });
    if (!ok) return;
    setSending(true); setSendMsg(null);
    try {
      const res = await api.sendReportNow();
      setSendMsg({ ok: true, text: res.message });
      // Refresh schedule to update last_sent
      api.getReportSchedule().then(setSchedule).catch(() => {});
    } catch (err) { setSendMsg({ ok: false, text: err.message }); }
    finally { setSending(false); }
  }

  const toggleRecipient = (id) => {
    setSchedule(s => ({
      ...s,
      recipients: s.recipients.includes(id)
        ? s.recipients.filter(r => r !== id)
        : [...s.recipients, id],
    }));
  };

  const set    = k => e => setSmtp(s => ({ ...s, [k]: e.target.value }));
  const setSch = k => e => setSchedule(s => ({ ...s, [k]: e.target.value !== undefined ? (isNaN(e.target.value) ? e.target.value : Number(e.target.value)) : e.target.checked }));

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--gray-900)', marginBottom: 4 }}>Weekly Status Report</h2>
          <p style={{ fontSize: 13, color: 'var(--gray-500)' }}>
            Automatically email a comprehensive status report to management each week.
          </p>
        </div>
        <div className="flex gap-10">
          <button className="btn btn-ghost btn-sm" onClick={loadPreview} disabled={previewing} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {previewing ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <ScrollText size={13} />}
            Preview Report
          </button>
          <button className="btn btn-primary btn-sm" onClick={sendNow} disabled={sending} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {sending ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={13} />}
            Send Now
          </button>
        </div>
      </div>

      {sendMsg && (
        <div className={`alert ${sendMsg.ok ? 'alert-success' : 'alert-warning'}`} style={{ marginBottom: 16 }}>
          {sendMsg.ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />} {sendMsg.text}
        </div>
      )}

      {/* ── Last sent info ── */}
      {schedule.last_sent && (
        <div style={{ background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: 13, color: 'var(--gray-600)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <CheckCircle2 size={14} color="var(--success)" />
          Last report sent: <strong>{fmtDateTime(schedule.last_sent)}</strong>
        </div>
      )}

      <div className="grid-2" style={{ gap: 20, alignItems: 'start' }}>

        {/* ── Left: SMTP config ── */}
        <div className="card" style={{ padding: '20px 24px' }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <AtSign size={15} color="var(--primary)" /> Email SMTP Configuration
          </h3>
          {smtpMsg && (
            <div className={`alert ${smtpMsg.ok ? 'alert-success' : 'alert-warning'}`} style={{ marginBottom: 12 }}>
              {smtpMsg.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />} {smtpMsg.text}
            </div>
          )}
          <form onSubmit={saveSmtp}>
            <div className="form-row">
              <div className="form-group">
                <label>SMTP Host</label>
                <input value={smtp.host || ''} onChange={set('host')} placeholder="smtp.gmail.com" required />
              </div>
              <div className="form-group" style={{ maxWidth: 100 }}>
                <label>Port</label>
                <input type="number" value={smtp.port || 587} onChange={set('port')} />
              </div>
            </div>
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={!!smtp.secure} onChange={e => setSmtp(s => ({ ...s, secure: e.target.checked }))} style={{ width: 'auto' }} />
                Use SSL/TLS (port 465)
              </label>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Username / Email</label>
                <input value={smtp.user || ''} onChange={set('user')} placeholder="noreply@company.com" />
              </div>
              <div className="form-group">
                <label>Password</label>
                <input type="password" value={smtp.password || ''} onChange={set('password')} placeholder="•••••••" />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>From Name</label>
                <input value={smtp.from_name || ''} onChange={set('from_name')} placeholder="Solutions Hub" />
              </div>
              <div className="form-group">
                <label>From Email</label>
                <input value={smtp.from_email || ''} onChange={set('from_email')} placeholder="noreply@company.com" />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button type="submit" className="btn btn-primary btn-sm" disabled={smtpSaving} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {smtpSaving ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={13} />} Save SMTP
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={smtpTesting} onClick={testSmtp} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {smtpTesting ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Bell size={13} />} Test Connection
              </button>
            </div>
            <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
              <input value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="Send test email to…" style={{ flex: 1, fontSize: 13 }} />
            </div>
          </form>
        </div>

        {/* ── Right: Schedule config ── */}
        <div className="card" style={{ padding: '20px 24px' }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Settings size={15} color="var(--primary)" /> Report Schedule
          </h3>
          {schedMsg && (
            <div className={`alert ${schedMsg.ok ? 'alert-success' : 'alert-warning'}`} style={{ marginBottom: 12 }}>
              {schedMsg.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />} {schedMsg.text}
            </div>
          )}
          <form onSubmit={saveSchedule}>
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={!!schedule.enabled} onChange={e => setSchedule(s => ({ ...s, enabled: e.target.checked }))} style={{ width: 'auto' }} />
                <span style={{ fontWeight: 600 }}>Enable automatic weekly report</span>
              </label>
              {!schedule.enabled && (
                <p style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 4 }}>Enable to have the report sent automatically on schedule.</p>
              )}
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Send On</label>
                <select value={schedule.day ?? 1} onChange={setSch('day')}>
                  {DAY_OPTIONS.map(d => <option key={d.v} value={d.v}>{d.l}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>At (Hour)</label>
                <select value={schedule.hour ?? 9} onChange={setSch('hour')}>
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label>Recipients — Managers</label>
              {managers.length === 0
                ? <p style={{ fontSize: 13, color: 'var(--gray-400)' }}>No active managers found.</p>
                : <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                    {managers.map(m => (
                      <label key={m.id} style={{
                        display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                        padding: '6px 10px', borderRadius: 6, border: '1px solid var(--gray-200)',
                        background: schedule.recipients?.includes(m.id) ? '#eff6ff' : 'transparent',
                        fontSize: 13,
                      }}>
                        <input type="checkbox" style={{ width: 'auto' }}
                          checked={schedule.recipients?.includes(m.id) || false}
                          onChange={() => toggleRecipient(m.id)} />
                        <span style={{ fontWeight: 600 }}>{m.name}</span>
                        <span style={{ color: 'var(--gray-400)', fontSize: 12 }}>{m.email || '—'}</span>
                      </label>
                    ))}
                  </div>
              }
            </div>

            <button type="submit" className="btn btn-primary btn-sm" disabled={schedSaving} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {schedSaving ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={13} />} Save Schedule
            </button>
          </form>
        </div>
      </div>

      {/* ── Report Sections Overview ── */}
      <div className="card" style={{ marginTop: 20, padding: '20px 24px' }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <ScrollText size={15} color="var(--primary)" /> Report Contents
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
          {[
            { emoji: '📁', title: 'Projects Opened',         desc: 'New projects from the past 7 days' },
            { emoji: '📅', title: 'Upcoming Deadlines',      desc: 'Projects & tasks due in 14 days' },
            { emoji: '🔴', title: 'High-Priority Tasks',     desc: 'All open high-priority tasks' },
            { emoji: '🔧', title: 'Maintenance Visits',      desc: 'Visits ±7 days with report status' },
            { emoji: '📄', title: 'Reports Pending',         desc: 'Visits with no submitted report' },
            { emoji: '👷', title: 'Engineer Workload',       desc: 'Tasks, completed & overdue per engineer' },
            { emoji: '⏳', title: 'Closure Approvals',       desc: 'Projects awaiting closure sign-off' },
            { emoji: '📊', title: 'SLA Compliance',          desc: 'Breach summary for all 4 SLA metrics' },
            { emoji: '🏢', title: 'New Customers',           desc: 'Customers added this week' },
          ].map(s => (
            <div key={s.title} style={{ padding: '10px 12px', background: 'var(--gray-50)', borderRadius: 8, border: '1px solid var(--gray-100)' }}>
              <div style={{ fontSize: 14, marginBottom: 2 }}>{s.emoji} <strong style={{ fontSize: 13 }}>{s.title}</strong></div>
              <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>{s.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Preview Modal ── */}
      {showPreview && preview && (
        <Modal title="Report Preview" onClose={() => setShowPreview(false)} width={780}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 8 }}>
              <strong>Subject:</strong> {preview.subject}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              {[
                { label: 'Active Projects',  val: preview.stats?.activeProjects },
                { label: 'Open Tasks',       val: preview.stats?.openTasks },
                { label: 'Overdue Projects', val: preview.stats?.overdueProjects },
                { label: 'Pending Closure',  val: preview.stats?.pendingClosure },
              ].map(s => (
                <div key={s.label} style={{ background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 8, padding: '8px 14px', textAlign: 'center', minWidth: 90 }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--primary)' }}>{s.val ?? 0}</div>
                  <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>{s.label}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8, marginBottom: 12 }}>
              {[
                { emoji: '📁', label: 'Projects opened',   val: preview.projectsOpened?.length },
                { emoji: '📅', label: 'Upcoming deadlines',val: preview.upcomingDeadlines?.length },
                { emoji: '🔴', label: 'High-pri tasks',    val: preview.highPriorityTasks?.length },
                { emoji: '🔧', label: 'MV this period',    val: preview.maintenanceVisits?.length },
                { emoji: '📄', label: 'Reports pending',   val: preview.reportsPending?.length },
                { emoji: '⏳', label: 'Pending closure',   val: preview.closurePending?.length },
              ].map(s => (
                <div key={s.label} style={{ padding: '8px 12px', background: 'var(--gray-50)', borderRadius: 6, border: '1px solid var(--gray-100)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{s.emoji}</span>
                  <span style={{ fontSize: 12, color: 'var(--gray-600)', flex: 1 }}>{s.label}</span>
                  <strong style={{ fontSize: 14 }}>{s.val ?? 0}</strong>
                </div>
              ))}
            </div>
            <a
              href="/api/report-settings/preview"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost btn-sm"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}
            >
              <ExternalLink size={12} /> Open Full HTML Preview in new tab
            </a>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════ */
/* ── STATUS MANAGEMENT TAB ───────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */
