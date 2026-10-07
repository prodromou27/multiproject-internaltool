import { useEffect, useState } from 'react';
import { ClipboardList, Trash2 } from 'lucide-react';
import { api } from '../api';
import { Modal, fmtDate, fmtNumber } from '../components/Shared';
import { Field, Surface, ToneBadge } from '../components/EnterpriseUI';
import { useToast } from '../components/Toast';
import { localDateISO } from '../utils/dates';

/* KPIs → Scorecard: every enabled KPI measured now, against its target, with
   each engineer's result when a KPI is measured per engineer; and the records
   (trainings, certifications…) behind "Recorded entries" KPIs.
   Server: GET /kpis/scorecard, /kpis/definitions/:id/records. */

const tone = status => ({ healthy: 'success', warning: 'warning', critical: 'danger' }[status] || 'neutral');
const STATUS = { healthy: 'On target', warning: 'Warning', critical: 'Critical', no_data: 'No data yet' };
const unitOf = (row, sources) => (row.data_source === 'records' ? row.calculation_config?.unit || '' : sources?.find(item => item.key === row.data_source)?.unit || '');
const show = (value, unit) => (value === null || value === undefined ? '—' : `${fmtNumber(value)}${unit === '%' ? '%' : ''}`);
const scopeName = row => row.team_name || row.customer_name || row.engineer_name || row.project_title || 'Organisation';

export function KpiScorecard({ sources, version, onRecords }) {
  const [data, setData] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController(); setError('');
    api.kpiScorecard({ signal: controller.signal }).then(result => { if (!controller.signal.aborted) setData({ rows: Array.isArray(result?.rows) ? result.rows : [] }); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [version]);
  return <Surface title="Scorecard" description="Every enabled KPI, measured now against its target.">
    {error ? <div className="error-msg" role="alert">{error}</div> : !data ? <p className="text-muted">Measuring…</p> : !data.rows.length ? <p className="text-muted">No enabled KPIs yet. Create one below.</p> :
      <div className="kpi-scorecard">{data.rows.map(row => {
        const unit = unitOf(row, sources);
        return <article key={row.id} className={`kpi-card is-${row.status}`} aria-label={row.name}>
          <header>
            <div><h3>{row.name}</h3><p>{scopeName(row)}{row.calculation_config?.per_engineer ? ' · each engineer' : ''}{row.period ? ` · ${row.period.label}` : ''}</p></div>
            <ToneBadge tone={tone(row.status)}>{STATUS[row.status] || row.status}</ToneBadge>
          </header>
          <div className="kpi-card-value"><strong>{show(row.value, unit)}</strong>{unit && unit !== '%' && <span>{unit}</span>}{row.calculation_config?.per_engineer && <span>average</span>}</div>
          <p className="kpi-card-target">Target {row.direction === 'lower' ? 'at most' : 'at least'} {show(row.target_value, unit)}{row.facts?.engineers !== undefined ? ` · ${row.facts.meeting_target} of ${row.facts.engineers} engineers on target` : ''}</p>
          {row.error && <p className="text-danger text-sm">{row.error}</p>}
          {row.breakdown?.length > 0 && <details className="kpi-card-breakdown" open={row.breakdown.length <= 6}>
            <summary>Each engineer</summary>
            <table><tbody>{row.breakdown.map(person => <tr key={person.user_id}>
              <th scope="row">{person.name}</th><td className="num">{show(person.value, unit)}</td>
              <td><ToneBadge tone={tone(person.status)}>{STATUS[person.status] || person.status}</ToneBadge></td>
            </tr>)}</tbody></table>
          </details>}
          {row.data_source === 'records' && onRecords && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRecords(row)}><ClipboardList size={13} /> Records</button>}
        </article>;
      })}</div>}
  </Surface>;
}

export function RecordsDialog({ definition, engineers, onClose }) {
  const toast = useToast();
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [version, setVersion] = useState(0);
  const [form, setForm] = useState({ user_id: '', record_date: localDateISO(new Date()), value: '1', note: '' });
  const sum = definition.calculation_config?.aggregate === 'sum', unit = definition.calculation_config?.unit || 'entries';
  useEffect(() => {
    const controller = new AbortController();
    api.kpiRecords(definition.id, { signal: controller.signal }).then(setData).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [definition.id, version]);
  async function add(event) {
    event.preventDefault(); setBusy(true);
    try {
      await api.addKpiRecord(definition.id, { user_id: form.user_id ? Number(form.user_id) : null, record_date: form.record_date, value: sum ? Number(form.value) : 1, note: form.note.trim() || null });
      toast.success('Recorded'); setForm(current => ({ ...current, note: '', value: '1' })); setVersion(v => v + 1);
    } catch (failure) { toast.error(failure.message); } finally { setBusy(false); }
  }
  async function remove(row) {
    try { await api.deleteKpiRecord(row.id); setVersion(v => v + 1); } catch (failure) { toast.error(failure.message); }
  }
  return <Modal title={`${definition.name}: records`} onClose={onClose} width={760} footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
    <form className="kpi-record-form" onSubmit={add}>
      <Field label="Engineer"><select value={form.user_id} onChange={event => setForm(current => ({ ...current, user_id: event.target.value }))}><option value="">Not one person</option>{engineers.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></Field>
      <Field label="Date" required><input type="date" required value={form.record_date} onChange={event => setForm(current => ({ ...current, record_date: event.target.value }))} /></Field>
      {sum && <Field label={`Amount (${unit})`} required><input type="number" step="any" required value={form.value} onChange={event => setForm(current => ({ ...current, value: event.target.value }))} /></Field>}
      <Field label="What" className="is-wide"><input value={form.note} maxLength={500} onChange={event => setForm(current => ({ ...current, note: event.target.value }))} placeholder="Fortinet NSE4 certification" /></Field>
      <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Saving…' : 'Add record'}</button>
    </form>
    {error ? <div className="error-msg" role="alert">{error}</div> : !data ? <p className="text-muted">Loading…</p> : !data.rows.length ? <p className="text-muted">Nothing recorded yet.</p> :
      <div className="table-wrap"><table>
        <thead><tr><th scope="col">Date</th><th scope="col">Engineer</th><th scope="col">What</th>{sum && <th scope="col" className="num">{unit}</th>}<th scope="col"><span className="sr-only">Remove</span></th></tr></thead>
        <tbody>{data.rows.map(row => <tr key={row.id}>
          <td>{fmtDate(row.record_date)}</td><td>{row.engineer_name || '—'}</td><td>{row.note || '—'}</td>{sum && <td className="num">{fmtNumber(row.value)}</td>}
          <td><button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove record from ${row.record_date}`} onClick={() => remove(row)}><Trash2 size={13} /></button></td>
        </tr>)}</tbody>
      </table></div>}
  </Modal>;
}
