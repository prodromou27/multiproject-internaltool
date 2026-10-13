import { useEffect, useRef, useState } from 'react';
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
const SHOWN = 8;
// The built-in wording, for a report from a server that sends none (customerValueReport.js WORDING_DEFAULTS).
const BUILT_IN = { title: 'Service report', intro: '', closing: '', color: '#1f3a5f',
  headings: { summary: 'Summary', work: 'Work delivered', changes: 'Changes and upgrades', tickets: 'Tickets resolved', tasks: 'Tasks completed', work_log: 'Work log', recommendations: 'Our recommendations', assets: 'Devices we look after', upcoming: 'Coming next' },
  figures: { hours: 'Hours of work', activities: 'Activities', changes: 'Changes and upgrades', tickets: 'Tickets resolved', tasks: 'Tasks completed' },
  empty: { work: 'No activities were recorded in this period.', changes: 'No changes or upgrades in this period.', tickets: 'No tickets were resolved in this period.', tasks: 'No tasks were completed in this period.', work_log: 'No activities were recorded in this period.', recommendations: 'We have no open recommendations.', assets: 'No devices are recorded.' } };

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
  // The wording and colour of the company report template (Settings → Customer report template).
  const W = report.wording || BUILT_IN, H = W.headings, E = W.empty, L = W.figures;
  const figures = [[L.hours, f.hours], [L.activities, f.activities], [L.changes, f.changes], ...(f.tickets_resolved == null ? [] : [[L.tickets, f.tickets_resolved]]), [L.tasks, f.tasks_completed]];
  const max = Math.max(...report.categories.map(c => c.hours), 0.1);
  return <article className="crp-paper" aria-label="Report preview" style={{ '--crp-color': W.color }}>
    <header className="crp-cover">
      <span>{W.title}</span>
      <h2>{report.customer.name}</h2>
      <p>{fmtDate(report.period.from)} – {fmtDate(report.period.to)}{report.customer.team ? ` · ${report.customer.team}` : ''}</p>
    </header>
    <div className="crp-figures">{figures.map(([label, value]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
    {W.intro && <section className="crp-block"><p className="crp-text">{W.intro}</p></section>}
    {report.summary && <section className="crp-block"><h3>{H.summary}</h3><p className="crp-text">{report.summary}</p></section>}
    <section className="crp-block" aria-label={H.work}>
      <h3>{H.work}</h3>
      {!report.categories.length ? <p className="text-muted text-sm">{E.work}</p>
        : <ul className="crp-bars">{report.categories.map(c => <li key={c.name}><span>{c.name}</span><span className="crp-bar"><i style={{ width: `${c.hours / max * 100}%` }} /></span><strong>{c.hours} h</strong><small>{c.activities}</small></li>)}</ul>}
    </section>
    {has('changes') && <PreviewTable title={H.changes} columns={['Date', 'Device', 'From', 'To', 'Change']} empty={E.changes}
      rows={report.changes.map(c => [fmtDate(c.date), c.device, c.from, c.to, c.what])} />}
    {has('tickets') && f.tickets_resolved != null && <PreviewTable title={H.tickets} columns={['Ticket', 'Subject', 'Resolved']} empty={E.tickets}
      rows={report.tickets.map(t => [t.number, t.subject, fmtDate(t.resolved)])} />}
    {has('tasks') && <PreviewTable title={H.tasks} columns={['Task', 'Completed']} empty={E.tasks} rows={report.tasks.map(t => [t.title, fmtDate(t.completed)])} />}
    {has('work_log') && <PreviewTable title={H.work_log} columns={['Date', 'Work', 'Type', 'Hours']} empty={E.work_log}
      rows={report.work_log.map(w => [fmtDate(w.date), w.title, w.category, String(w.hours)])} />}
    {has('recommendations') && <PreviewTable title={H.recommendations} columns={['Finding', 'Recommendation', 'Risk', 'Due']} empty={E.recommendations}
      rows={report.recommendations.map(r => [r.finding, r.recommendation, r.risk, fmtDate(r.due)])} />}
    {has('assets') && report.assets && <PreviewTable title={H.assets} columns={['Device', 'Type', 'Version', 'Support']} empty={E.assets}
      rows={report.assets.rows.map(a => [a.name, a.type, a.version, a.support])} />}
    {has('upcoming') && (report.coming_next || report.upcoming.length > 0) && <section className="crp-block"><h3>{H.upcoming}</h3>
      {report.coming_next && <p className="crp-text">{report.coming_next}</p>}
      {report.upcoming.length > 0 && <ul className="crp-list">{report.upcoming.map((u, i) => <li key={i}>{u.title}{u.due ? ` (planned by ${fmtDate(u.due)})` : ''}</li>)}</ul>}
    </section>}
    {W.closing && <section className="crp-block"><p className="crp-text">{W.closing}</p></section>}
  </article>;
}

export default function CustomerReport({ customerId, range, due, onUsePeriod }) {
  const { user } = useAuth();
  const canDownload = !!user?.permissions?.['managed_reports.generate'];
  const [summary, setSummary] = useState(''), [comingNext, setComingNext] = useState(''), [parts, setParts] = useState(null);
  const [report, setReport] = useState(null), [loading, setLoading] = useState(false), [busy, setBusy] = useState(null), [error, setError] = useState('');
  const body = { from: range.from, to: range.to, ...(parts ? { sections: parts } : {}), summary, coming_next: comingNext };
  // The template's default sections and starting text, taken once from the first preview.
  const started = useRef(false);
  useEffect(() => {
    if (!report || started.current) return;
    started.current = true;
    setParts(report.sections || []);
    if (report.defaults?.summary) setSummary(current => current || report.defaults.summary);
    if (report.defaults?.coming_next) setComingNext(current => current || report.defaults.coming_next);
  }, [report]);

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
  const toggle = partKey => setParts(current => { const list = current || report?.sections || []; return list.includes(partKey) ? list.filter(k => k !== partKey) : [...list, partKey]; });
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
        {PARTS.map(([partKey, label]) => <label key={partKey}><input type="checkbox" checked={(parts || report?.sections || []).includes(partKey)} onChange={() => toggle(partKey)} /> {label}</label>)}
      </fieldset>
    </section>

    {!range.from || !range.to ? <p className="card text-muted">Choose both dates of the period.</p>
      : !report ? <p className="card text-muted" role="status">{loading ? 'Preparing the preview…' : ''}</p>
        : <div className={loading ? 'crp-stale' : ''}><Preview report={report} /></div>}

  </div>;
}
