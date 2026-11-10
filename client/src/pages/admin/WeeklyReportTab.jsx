import { useEffect, useState } from 'react';
import { LoadError } from '../../components/LoadError';
import { CheckCircle2, AlertTriangle, Send, ScrollText, Save, Loader2, Settings, ExternalLink } from 'lucide-react';
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

  // Until the stored schedule is in, it cannot be saved (the defaults would replace it).
  const [scheduleState, setScheduleState] = useState({ status: 'loading', error: '' });
  const [managersError, setManagersError] = useState('');
  function loadSchedule() {
    setScheduleState({ status: 'loading', error: '' });
    api.getReportSchedule().then(value => { setSchedule(value); setScheduleState({ status: 'ready', error: '' }); })
      .catch(failure => setScheduleState({ status: 'error', error: failure.message }));
  }
  useEffect(() => {
    loadSchedule();
    api.reportManagers().then(setManagers).catch(failure => setManagersError(failure.message));
  }, []);

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

  const setSch = k => e => setSchedule(s => ({ ...s, [k]: e.target.value !== undefined ? (isNaN(e.target.value) ? e.target.value : Number(e.target.value)) : e.target.checked }));

  return (
    <div>
      <div className="u-828bb81">
        <div>
          <h2 className="u-c458441">Weekly Status Report</h2>
          <p className="u-af50806">
            Automatically email a comprehensive status report to management each week.
          </p>
        </div>
        <div className="flex gap-10">
          <button className="btn btn-ghost btn-sm inline-flex items-center gap-6" onClick={loadPreview} disabled={previewing}>
            {previewing ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <ScrollText size={13} />}
            Preview Report
          </button>
          <button className="btn btn-primary btn-sm inline-flex items-center gap-6" onClick={sendNow} disabled={sending}>
            {sending ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={13} />}
            Send Now
          </button>
        </div>
      </div>

      {sendMsg && (
        <div className={`alert ${sendMsg.ok ? 'alert-success' : 'alert-warning'} u-87c136d`}>
          {sendMsg.ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />} {sendMsg.text}
        </div>
      )}

      {/* ── Last sent info ── */}
      {schedule.last_sent && (
        <div className="u-bbe7a43">
          <CheckCircle2 size={14} color="var(--success)" />
          Last report sent: <strong>{fmtDateTime(schedule.last_sent)}</strong>
        </div>
      )}

      <div className="u-7cce4cc">

        {/* ── Right: Schedule config ── */}
        <div className="card u-969a912">
          <h3 className="u-1fb1cdf">
            <Settings size={15} color="var(--primary)" /> Report Schedule
          </h3>
          {schedMsg && (
            <div className={`alert ${schedMsg.ok ? 'alert-success' : 'alert-warning'} u-da12f28`}>
              {schedMsg.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />} {schedMsg.text}
            </div>
          )}
          {scheduleState.status === 'error' ? <LoadError compact what="The report schedule" error={scheduleState.error} onRetry={loadSchedule} /> : <form onSubmit={saveSchedule}>
            <div className="form-group">
              <label className="u-c92fd94">
                <input type="checkbox" checked={!!schedule.enabled} onChange={e => setSchedule(s => ({ ...s, enabled: e.target.checked }))} className="u-30e741d" />
                <span className="font-semibold">Enable automatic weekly report</span>
              </label>
              {!schedule.enabled && (
                <p className="u-2fb0f6a">Enable to have the report sent automatically on schedule.</p>
              )}
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Send On</label>
                <select aria-label="Send On" value={schedule.day ?? 1} onChange={setSch('day')}>
                  {DAY_OPTIONS.map(d => <option key={d.v} value={d.v}>{d.l}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>At (Hour)</label>
                <select aria-label="At (Hour)" value={schedule.hour ?? 9} onChange={setSch('hour')}>
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label>Recipients — Managers</label>
              {managersError ? <LoadError compact what="The list of managers" error={managersError} onRetry={() => { setManagersError(''); api.reportManagers().then(setManagers).catch(failure => setManagersError(failure.message)); }} /> : managers.length === 0
                ? <p className="u-dd8016b">No active managers found.</p>
                : <div className="u-4c3ce0d">
                    {managers.map(m => (
                      <label key={m.id} className="u-5fe57ae" style={{ background: schedule.recipients?.includes(m.id) ? '#eff6ff' : 'transparent' }}>
                        <input type="checkbox" className="u-30e741d"
                          checked={schedule.recipients?.includes(m.id) || false}
                          onChange={() => toggleRecipient(m.id)} />
                        <span className="font-semibold">{m.name}</span>
                        <span className="u-f3ab819">{m.email || '—'}</span>
                      </label>
                    ))}
                  </div>
              }
            </div>

            <button type="submit" className="btn btn-primary btn-sm inline-flex items-center gap-6" disabled={schedSaving || scheduleState.status !== 'ready'}>
              {schedSaving ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={13} />} Save Schedule
            </button>
          </form>}
        </div>
      </div>

      {/* ── Report Sections Overview ── */}
      <div className="card u-2d16f0b">
        <h3 className="u-1fb1cdf">
          <ScrollText size={15} color="var(--primary)" /> Report Contents
        </h3>
        <div className="u-5ac6b39">
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
            <div key={s.title} className="u-1a922eb">
              <div className="u-e6ef123">{s.emoji} <strong className="u-5e0faad">{s.title}</strong></div>
              <div className="u-5be3ef4">{s.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Preview Modal ── */}
      {showPreview && preview && (
        <Modal title="Report Preview" onClose={() => setShowPreview(false)} width={780}>
          <div className="mb-12">
            <div className="u-7d2b03a">
              <strong>Subject:</strong> {preview.subject}
            </div>
            <div className="u-592ab7b">
              {[
                { label: 'Active Projects',  val: preview.stats?.activeProjects },
                { label: 'Open Tasks',       val: preview.stats?.openTasks },
                { label: 'Overdue Projects', val: preview.stats?.overdueProjects },
                { label: 'Pending Closure',  val: preview.stats?.pendingClosure },
              ].map(s => (
                <div key={s.label} className="u-d419cf7">
                  <div className="u-6df2889">{s.val ?? 0}</div>
                  <div className="u-5be3ef4">{s.label}</div>
                </div>
              ))}
            </div>
            <div className="u-6675343">
              {[
                { emoji: '📁', label: 'Projects opened',   val: preview.projectsOpened?.length },
                { emoji: '📅', label: 'Upcoming deadlines',val: preview.upcomingDeadlines?.length },
                { emoji: '🔴', label: 'High-pri tasks',    val: preview.highPriorityTasks?.length },
                { emoji: '🔧', label: 'MV this period',    val: preview.maintenanceVisits?.length },
                { emoji: '📄', label: 'Reports pending',   val: preview.reportsPending?.length },
                { emoji: '⏳', label: 'Pending closure',   val: preview.closurePending?.length },
              ].map(s => (
                <div key={s.label} className="u-46d2236">
                  <span>{s.emoji}</span>
                  <span className="u-7f83e9d">{s.label}</span>
                  <strong className="u-433de30">{s.val ?? 0}</strong>
                </div>
              ))}
            </div>
            <a
              href="/api/report-settings/preview"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost btn-sm u-5de5886"
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
