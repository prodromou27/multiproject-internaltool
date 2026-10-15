import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { PageHeader } from '../components/PageLayout';
import { LoadError } from '../components/LoadError';
import { Modal, fmtDate } from '../components/Shared';
import CustomerSearchSelect from '../components/CustomerSearchSelect';
import { useConfirm } from '../components/Confirm';
import { useToast } from '../components/Toast';
import { businessToday } from '../utils/dates';

/* My time: the hours you logged on tasks and visits, day by day, as your own
   reference for filling in the company timesheet (CRM/ERP). Copy pastes as
   columns into a spreadsheet; CSV downloads the same rows. */
const addDays = (iso, days) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const mondayOf = iso => { const d = new Date(`${iso}T00:00:00Z`); return addDays(iso, -((d.getUTCDay() + 6) % 7)); };
const round = value => Math.round(value * 100) / 100;
const workOf = row => row.task_title || row.visit_title || row.category_label || 'Work';
const kindOf = row => (row.task_id ? 'Task' : row.visit_id ? 'Visit' : 'General');

// Time that is not on a task or visit: a meeting, admin, internal work…
function OtherTime({ onClose, onSaved }) {
  const toast = useToast();
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState({ work_date: businessToday(), hours: '', category: '', customer_id: '', description: '' });
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  useEffect(() => { api.timeCategories().then(rows => setCategories(Array.isArray(rows) ? rows : [])).catch(() => setCategories([])); }, []);
  const set = key => event => setForm(f => ({ ...f, [key]: event.target.value }));
  async function submit(event) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      await api.logTime({ hours: Number(form.hours), category: form.category, work_date: form.work_date, description: form.description.trim() || null, ...(form.customer_id ? { customer_id: Number(form.customer_id) } : {}) });
      toast.success(`${form.hours}h logged for ${fmtDate(form.work_date)}`); onSaved();
    } catch (failure) { setError(failure.message); } finally { setSaving(false); }
  }
  return <Modal title="Log other time" onClose={onClose} busy={saving}>
    <form onSubmit={submit}>
      {error && <p className="error-msg" role="alert">{error}</p>}
      <div className="form-row">
        <div className="form-group"><label htmlFor="other-date">Day worked</label><input id="other-date" type="date" required max={businessToday()} value={form.work_date} onChange={set('work_date')} /></div>
        <div className="form-group"><label htmlFor="other-hours">Hours</label><input id="other-hours" type="number" required min="0.25" max="24" step="0.25" value={form.hours} onChange={set('hours')} autoFocus /></div>
      </div>
      <div className="form-group"><label htmlFor="other-kind">What was it?</label><select id="other-kind" required value={form.category} onChange={set('category')}><option value="">Choose…</option>{categories.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select></div>
      <div className="form-group"><label htmlFor="other-customer">Customer (optional)</label><CustomerSearchSelect id="other-customer" value={form.customer_id} onChange={id => setForm(f => ({ ...f, customer_id: id ? String(id) : '' }))} /></div>
      <div className="form-group"><label htmlFor="other-note">Note (optional)</label><input id="other-note" maxLength={2000} value={form.description} onChange={set('description')} placeholder="e.g. Weekly team meeting" /></div>
      <div className="modal-footer"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={saving || !form.hours || !form.category}>{saving ? 'Saving…' : 'Log time'}</button></div>
    </form>
  </Modal>;
}
const COLUMNS = ['Date', 'Hours', 'Customer', 'Work', 'Type', 'Project', 'Ticket', 'Note'];
const cells = row => [row.work_date, round(Number(row.hours)), row.customer_name || '', workOf(row), kindOf(row), row.project_title || '', row.ticket_reference || '', row.description || ''];
const csvCell = value => (/[",\n;]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value));

export default function MyTime() {
  const toast = useToast(), confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const [range, setRange] = useState(() => { const from = mondayOf(businessToday()); return { from, to: addDays(from, 6) }; });
  const [rows, setRows] = useState(null), [error, setError] = useState(null);
  const load = useCallback(() => { setError(null); setRows(null); return api.myTimeLogs(range.from, range.to).then(data => setRows(Array.isArray(data) ? data : [])).catch(setError); }, [range]);
  useEffect(() => { load(); }, [load]);
  const shift = weeks => setRange(r => ({ from: addDays(r.from, weeks * 7), to: addDays(r.to, weeks * 7) }));

  const days = new Map();
  for (const row of rows || []) { const list = days.get(row.work_date) || []; list.push(row); days.set(row.work_date, list); }
  const ordered = [...days.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const total = round((rows || []).reduce((sum, row) => sum + Number(row.hours), 0));
  const sorted = ordered.flatMap(([, list]) => list);

  async function copy(list) {
    const text = [COLUMNS, ...list.map(cells)].map(line => line.join('\t')).join('\n');
    try { await navigator.clipboard.writeText(text); toast.success('Copied: paste into a spreadsheet or your timesheet'); }
    catch { toast.error('Could not copy; use Export CSV instead'); }
  }
  async function remove(row) {
    if (!await confirm(`Remove ${round(Number(row.hours))}h of ${workOf(row)} on ${fmtDate(row.work_date)}?`, { title: 'Remove hours', label: 'Remove' })) return;
    try { await api.deleteTimeLog(row.id); toast.success('Removed'); load(); }
    catch (failure) { toast.error(failure.message); }
  }
  function exportCsv() {
    const text = '﻿' + [COLUMNS, ...sorted.map(cells)].map(line => line.map(csvCell).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = `my-time-${range.from}-to-${range.to}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(a.href);
  }

  return <div className="page">
    <PageHeader title="My time" meta="The hours you logged, by the day you did the work. Use it to fill in the company timesheet." />
    <div className="flex gap-8 mb-16" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>Log other time</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => shift(-1)}>Previous week</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => shift(1)}>Next week</button>
      <label className="text-sm">From<input aria-label="From" type="date" value={range.from} max={range.to} onChange={e => e.target.value && setRange(r => ({ ...r, from: e.target.value }))} /></label>
      <label className="text-sm">To<input aria-label="To" type="date" value={range.to} min={range.from} onChange={e => e.target.value && setRange(r => ({ ...r, to: e.target.value }))} /></label>
      {rows?.length > 0 && <>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(sorted)}>Copy all</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={exportCsv}>Export CSV</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.print()}>Print</button>
      </>}
    </div>
    {error ? <LoadError what="Your hours" error={error} onRetry={load} /> : !rows ? <p className="text-muted" role="status">Loading…</p> : <>
      <p><strong>{total}h</strong> from {fmtDate(range.from)} to {fmtDate(range.to)}</p>
      {!rows.length && <p className="text-muted">No hours logged in these days. Log hours from a task (the clock on Tasks), on a visit, or with Log other time for meetings and other work.</p>}
      {ordered.map(([day, list]) => <section key={day} className="card mb-16" aria-label={fmtDate(day)} style={{ padding: 12 }}>
        <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="section-title" style={{ fontSize: 15 }}>{new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long' })} {fmtDate(day)} · {round(list.reduce((s, r) => s + Number(r.hours), 0))}h</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(list)} aria-label={`Copy ${fmtDate(day)}`}>Copy day</button>
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th scope="col">Hours</th><th scope="col">Customer</th><th scope="col">Work</th><th scope="col">Ticket</th><th scope="col">Note</th><th scope="col"><span className="sr-only">Remove</span></th></tr></thead>
          <tbody>{list.map(row => <tr key={row.id}>
            <td>{round(Number(row.hours))}h</td>
            <td>{row.customer_name || <span className="text-muted">Internal</span>}</td>
            <td>{row.task_id ? <Link to={`/tasks?filter=all`}>{workOf(row)}</Link> : row.visit_id ? <Link to={`/maintenance-visits?visit=${row.visit_id}`}>{workOf(row)}</Link> : workOf(row)}<div className="text-sm text-muted">{kindOf(row)}{row.project_title ? ` · ${row.project_title}` : ''}</div></td>
            <td>{row.ticket_reference || '—'}</td>
            <td>{row.description || ''}</td>
            <td><button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove ${round(Number(row.hours))}h ${workOf(row)} on ${fmtDate(row.work_date)}`} onClick={() => remove(row)}>Remove</button></td>
          </tr>)}</tbody>
        </table></div>
      </section>)}
    </>}
    {adding && <OtherTime onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
  </div>;
}
