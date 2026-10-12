import { useEffect, useState } from 'react';
import { CalendarCheck, Download, FileText } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../App';
import { fmtDate } from './Shared';
import './CustomerReport.css';

/* Customer 360 → Reports: the report for the customer — what we did for them in
   the period. Pick the period, optionally write a summary and what comes next,
   choose what to include, see it, and download it as PDF or Word. No review
   steps. Server: customerValueReport.js. */

const PARTS = [
  ['changes', 'Changes and upgrades'], ['tickets', 'Tickets resolved'], ['tasks', 'Tasks completed'],
  ['work_log', 'Work log (every activity)'], ['recommendations', 'Our recommendations'], ['upcoming', 'Coming next'], ['assets', 'Devices we look after'],
];
const DEFAULT_PARTS = ['changes', 'tickets', 'tasks', 'work_log', 'recommendations', 'upcoming'];
const SHOWN = 8;

function PreviewTable({ title, columns, rows, empty }) {
  return <section className="crp-block" aria-label={title}>
    <h3>{title}</h3>
    {!rows.length ? <p className="text-muted text-sm">{empty}</p> : <>
      <div className="table-wrap"><table><thead><tr>{columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{rows.slice(0, SHOWN).map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell || '—'}</td>)}</tr>)}</tbody></table></div>
      {rows.length > SHOWN && <p className="text-muted text-sm">…and {rows.length - SHOWN} more in the report.</p>}
    </>}
  </section>;
}

function Preview({ report }) {
  const f = report.figures, has = key => report.sections.includes(key);
  const figures = [['Hours of work', f.hours], ['Activities', f.activities], ['Changes and upgrades', f.changes], ...(f.tickets_resolved == null ? [] : [['Tickets resolved', f.tickets_resolved]]), ['Tasks completed', f.tasks_completed]];
  const max = Math.max(...report.categories.map(c => c.hours), 0.1);
  return <article className="crp-paper" aria-label="Report preview">
    <header className="crp-cover">
      <span>Service report</span>
      <h2>{report.customer.name}</h2>
      <p>{fmtDate(report.period.from)} – {fmtDate(report.period.to)}{report.customer.team ? ` · ${report.customer.team}` : ''}</p>
    </header>
    <div className="crp-figures">{figures.map(([label, value]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
    {report.summary && <section className="crp-block"><h3>Summary</h3><p className="crp-text">{report.summary}</p></section>}
    <section className="crp-block" aria-label="Work delivered">
      <h3>Work delivered</h3>
      {!report.categories.length ? <p className="text-muted text-sm">No activities were recorded in this period.</p>
        : <ul className="crp-bars">{report.categories.map(c => <li key={c.name}><span>{c.name}</span><span className="crp-bar"><i style={{ width: `${c.hours / max * 100}%` }} /></span><strong>{c.hours} h</strong><small>{c.activities}</small></li>)}</ul>}
    </section>
    {has('changes') && <PreviewTable title="Changes and upgrades" columns={['Date', 'Device', 'From', 'To', 'Change']} empty="No changes or upgrades in this period."
      rows={report.changes.map(c => [fmtDate(c.date), c.device, c.from, c.to, c.what])} />}
    {has('tickets') && f.tickets_resolved != null && <PreviewTable title="Tickets resolved" columns={['Ticket', 'Subject', 'Resolved']} empty="No tickets were resolved in this period."
      rows={report.tickets.map(t => [t.number, t.subject, fmtDate(t.resolved)])} />}
    {has('tasks') && <PreviewTable title="Tasks completed" columns={['Task', 'Completed']} empty="No tasks were completed in this period." rows={report.tasks.map(t => [t.title, fmtDate(t.completed)])} />}
    {has('work_log') && <PreviewTable title="Work log" columns={['Date', 'Work', 'Type', 'Hours']} empty="No activities were recorded in this period."
      rows={report.work_log.map(w => [fmtDate(w.date), w.title, w.category, String(w.hours)])} />}
    {has('recommendations') && <PreviewTable title="Our recommendations" columns={['Finding', 'Recommendation', 'Risk', 'Due']} empty="We have no open recommendations."
      rows={report.recommendations.map(r => [r.finding, r.recommendation, r.risk, fmtDate(r.due)])} />}
    {has('assets') && report.assets && <PreviewTable title="Devices we look after" columns={['Device', 'Type', 'Version', 'Support']} empty="No devices are recorded."
      rows={report.assets.rows.map(a => [a.name, a.type, a.version, a.support])} />}
    {has('upcoming') && (report.coming_next || report.upcoming.length > 0) && <section className="crp-block"><h3>Coming next</h3>
      {report.coming_next && <p className="crp-text">{report.coming_next}</p>}
      {report.upcoming.length > 0 && <ul className="crp-list">{report.upcoming.map((u, i) => <li key={i}>{u.title}{u.due ? ` (planned by ${fmtDate(u.due)})` : ''}</li>)}</ul>}
    </section>}
  </article>;
}

export default function CustomerReport({ customerId, range, due, onUsePeriod }) {
  const { user } = useAuth();
  const canDownload = !!user?.permissions?.['managed_reports.generate'];
  const [summary, setSummary] = useState(''), [comingNext, setComingNext] = useState(''), [parts, setParts] = useState(DEFAULT_PARTS);
  const [report, setReport] = useState(null), [loading, setLoading] = useState(false), [busy, setBusy] = useState(null), [error, setError] = useState('');
  const body = { from: range.from, to: range.to, sections: parts, summary, coming_next: comingNext };

  // The preview follows the period and the parts chosen; the written notes are applied when typing pauses.
  const key = JSON.stringify(body);
  useEffect(() => {
    if (!range.from || !range.to) { setReport(null); return undefined; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true); setError('');
      api.customerReportPreview(customerId, JSON.parse(key), { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setReport(result); })
        .catch(failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [customerId, key, range.from, range.to]);

  const save = (blob, name) => { const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  async function download(format) {
    setBusy(format); setError('');
    try {
      const blob = await api.customerReportDownload(customerId, format, body);
      const safe = (report?.customer.name || 'customer').replace(/[^a-z0-9_-]+/gi, '_');
      save(blob, `${safe}_report_${range.from}_${range.to}.${format}`);
    } catch (failure) { setError(failure.message); } finally { setBusy(null); }
  }
  const toggle = partKey => setParts(current => (current.includes(partKey) ? current.filter(k => k !== partKey) : [...current, partKey]));
  const owedOther = due && !['sent', 'not_yet_due'].includes(due.status) && !(range.from === due.from && range.to === due.to);

  return <div className="crp">
    <section className="card crp-controls" aria-label="Customer report">
      <header className="crp-head">
        <div><h2><FileText size={18} aria-hidden="true" /> Customer report</h2>
          <p className="text-muted text-sm">What we did for {report?.customer.name || 'the customer'} from {fmtDate(range.from)} to {fmtDate(range.to)}.</p></div>
        {canDownload && <div className="crp-downloads">
          <button type="button" className="btn btn-primary" disabled={!report || !!busy} onClick={() => download('pdf')}><Download size={14} /> {busy === 'pdf' ? 'Preparing…' : 'Download PDF'}</button>
          <button type="button" className="btn btn-ghost" disabled={!report || !!busy} onClick={() => download('docx')}><Download size={14} /> {busy === 'docx' ? 'Preparing…' : 'Download Word'}</button>
        </div>}
      </header>
      {owedOther && onUsePeriod && <p className="crp-owed"><CalendarCheck size={14} aria-hidden="true" /> The {due.label} report is {due.overdue ? 'overdue' : `due by ${fmtDate(due.due_date)}`}.
        <button type="button" className="btn-link" onClick={() => onUsePeriod(due)}>Use {due.label}</button></p>}
      {error && <div className="error-msg" role="alert">{error}</div>}
      <div className="crp-notes">
        <div className="form-group"><label htmlFor="crp-summary">Summary for the customer (optional)</label>
          <textarea id="crp-summary" rows={3} maxLength={5000} value={summary} onChange={event => setSummary(event.target.value)} placeholder="e.g. A stable month: all firewalls brought to the supported release and no service interruptions." /></div>
        <div className="form-group"><label htmlFor="crp-next">Coming next (optional)</label>
          <textarea id="crp-next" rows={3} maxLength={5000} value={comingNext} onChange={event => setComingNext(event.target.value)} placeholder="e.g. Next month we will test the WAF failover and review the backup policy." /></div>
      </div>
      <fieldset className="crp-parts"><legend>Include</legend>
        {PARTS.map(([partKey, label]) => <label key={partKey}><input type="checkbox" checked={parts.includes(partKey)} onChange={() => toggle(partKey)} /> {label}</label>)}
      </fieldset>
    </section>

    {!range.from || !range.to ? <p className="card text-muted">Choose both dates of the period.</p>
      : !report ? <p className="card text-muted" role="status">{loading ? 'Preparing the preview…' : ''}</p>
        : <div className={loading ? 'crp-stale' : ''}><Preview report={report} /></div>}

  </div>;
}
