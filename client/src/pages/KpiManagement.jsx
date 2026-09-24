import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, History, Play, Plus, RefreshCw, Settings2 } from 'lucide-react';
import { api } from '../api';
import { DataTable, Field, MetricStrip, Pagination, Surface, ToneBadge } from '../components/EnterpriseUI';
import { Modal, fmtDateTime, fmtNumber } from '../components/Shared';
import { PageHeader } from '../components/PageLayout';
import { useToast } from '../components/Toast';
import './KpiManagement.css';

const PAGE_SIZE = 25;
const emptyForm = {
  name: '', description: '', category: '', data_source: 'manual', manual_value: '0',
  target_value: '100', warning_threshold: '75', critical_threshold: '50', direction: 'higher',
  scope_type: 'organization', team_id: '', project_id: '', enabled: true, display_order: '0',
  visualization_type: 'number', version: undefined,
};

const label = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, character => character.toUpperCase());
const healthTone = status => status === 'healthy' ? 'success' : status === 'warning' ? 'warning' : status === 'critical' ? 'danger' : 'neutral';

function toForm(definition) {
  if (!definition) return { ...emptyForm };
  return {
    ...definition,
    manual_value: definition.calculation_config?.manual_value ?? '0',
    target_value: String(definition.target_value), warning_threshold: String(definition.warning_threshold),
    critical_threshold: String(definition.critical_threshold), display_order: String(definition.display_order),
    team_id: definition.team_id ? String(definition.team_id) : '', project_id: definition.project_id ? String(definition.project_id) : '',
  };
}

function payload(form) {
  return {
    name: form.name, description: form.description, category: form.category, data_source: form.data_source,
    calculation_config: form.data_source === 'manual' ? { manual_value: Number(form.manual_value) } : {},
    target_value: Number(form.target_value), warning_threshold: Number(form.warning_threshold), critical_threshold: Number(form.critical_threshold),
    direction: form.direction, scope_type: form.scope_type,
    team_id: form.scope_type === 'team' ? Number(form.team_id) : null,
    project_id: form.scope_type === 'project' ? Number(form.project_id) : null,
    enabled: !!form.enabled, display_order: Number(form.display_order), visualization_type: form.visualization_type,
    ...(form.version ? { version: form.version } : {}),
  };
}

function DefinitionDialog({ definition, meta, onClose, onSaved }) {
  const [form, setForm] = useState(() => toForm(definition));
  const [saving, setSaving] = useState(false), [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState(''), [preview, setPreview] = useState(null);
  const set = key => event => setForm(current => ({ ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));

  async function runPreview() {
    setPreviewing(true); setError('');
    try { setPreview(await api.previewKpiDefinition(payload(form))); }
    catch (failure) { setPreview(null); setError(failure.message); }
    finally { setPreviewing(false); }
  }

  async function save(event) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      if (definition) await api.updateKpiDefinition(definition.id, payload(form));
      else await api.createKpiDefinition(payload(form));
      onSaved(definition ? 'KPI definition updated' : 'KPI definition created');
    } catch (failure) { setError(failure.status === 409 ? 'This definition changed elsewhere. Close and reopen it before saving.' : failure.message); }
    finally { setSaving(false); }
  }

  return <Modal title={definition ? 'Edit KPI definition' : 'Create KPI definition'} onClose={onClose} width={820} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-ghost" type="button" onClick={runPreview} disabled={previewing || saving}><Play size={15} /> {previewing ? 'Testing…' : 'Preview calculation'}</button><button className="btn btn-primary" type="submit" form="kpi-definition-form" disabled={saving}>{saving ? 'Saving…' : 'Save definition'}</button></>}>
    <form id="kpi-definition-form" className="kpi-definition-form" onSubmit={save}>
      {error && <div className="error-msg" role="alert">{error}</div>}
      <section><h3>Identity</h3><div className="kpi-form-grid">
        <Field label="Name" required><input value={form.name} onChange={set('name')} maxLength={120} required autoFocus /></Field>
        <Field label="Category" required><input value={form.category} onChange={set('category')} maxLength={80} required placeholder="Delivery, Service, Quality…" /></Field>
        <Field label="Description" className="is-wide"><textarea value={form.description || ''} onChange={set('description')} maxLength={1000} rows={3} /></Field>
      </div></section>
      <section><h3>Calculation</h3><div className="kpi-form-grid">
        <Field label="Data source" required><select value={form.data_source} onChange={set('data_source')}>{meta.data_sources.map(source => <option key={source.key} value={source.key}>{source.label}</option>)}</select></Field>
        {form.data_source === 'manual' && <Field label="Manual value" required help="Used for previews and recorded snapshots."><input type="number" step="any" value={form.manual_value} onChange={set('manual_value')} required /></Field>}
        <p className="kpi-source-help is-wide">{meta.data_sources.find(source => source.key === form.data_source)?.description}</p>
      </div></section>
      <section><h3>Evaluation</h3><div className="kpi-form-grid is-four">
        <Field label="Target" required><input type="number" step="any" value={form.target_value} onChange={set('target_value')} required /></Field>
        <Field label="Warning threshold" required><input type="number" step="any" value={form.warning_threshold} onChange={set('warning_threshold')} required /></Field>
        <Field label="Critical threshold" required><input type="number" step="any" value={form.critical_threshold} onChange={set('critical_threshold')} required /></Field>
        <Field label="Direction" required><select value={form.direction} onChange={set('direction')}><option value="higher">Higher is better</option><option value="lower">Lower is better</option></select></Field>
      </div><p className="kpi-source-help">{form.direction === 'higher' ? 'Critical ≤ warning ≤ target.' : 'Target ≤ warning ≤ critical.'}</p></section>
      <section><h3>Scope and presentation</h3><div className="kpi-form-grid is-four">
        <Field label="Scope" required><select value={form.scope_type} onChange={set('scope_type')}><option value="organization">Organization</option><option value="team">Team</option><option value="project">Project</option></select></Field>
        {form.scope_type === 'team' && <Field label="Team" required><select value={form.team_id} onChange={set('team_id')} required><option value="">Select team</option>{meta.teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></Field>}
        {form.scope_type === 'project' && <Field label="Project" required><select value={form.project_id} onChange={set('project_id')} required><option value="">Select project</option>{meta.projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}</select></Field>}
        <Field label="Visualization"><select value={form.visualization_type} onChange={set('visualization_type')}>{meta.visualizations.map(item => <option key={item} value={item}>{label(item)}</option>)}</select></Field>
        <Field label="Display order"><input type="number" min="0" max="1000000" value={form.display_order} onChange={set('display_order')} /></Field>
        <label className="kpi-enabled-control"><input type="checkbox" checked={form.enabled} onChange={set('enabled')} /><span><strong>Enabled</strong><small>Available for calculation and dashboards</small></span></label>
      </div></section>
      {preview && <div className={`kpi-preview is-${preview.status}`} role="status"><div><span>Calculated preview</span><strong>{fmtNumber(preview.value)}</strong></div><ToneBadge tone={healthTone(preview.status)}>{label(preview.status)}</ToneBadge><small>{preview.facts?.records === undefined ? 'Manual source' : `${preview.facts.records} matching records`}</small></div>}
    </form>
  </Modal>;
}

function HistoryDialog({ definition, onClose }) {
  const [data, setData] = useState({ rows: [], total: 0, page: 1, page_size: 10 });
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const load = useCallback(async page => {
    setLoading(true); setError('');
    try { setData(await api.kpiDefinitionValues(definition.id, { page, page_size: 10 })); }
    catch (failure) { setError(failure.message); }
    finally { setLoading(false); }
  }, [definition.id]);
  useEffect(() => { load(1); }, [load]);
  const values = [...data.rows].reverse().map(row => Number(row.value));
  const min = Math.min(...values, 0), max = Math.max(...values, 1), range = max - min || 1;
  const points = values.map((value, index) => `${values.length === 1 ? 50 : index * 100 / (values.length - 1)},${42 - (value - min) * 36 / range}`).join(' ');
  return <Modal title={`${definition.name} history`} onClose={onClose} width={760} footer={<button className="btn btn-primary" onClick={onClose}>Close</button>}>
    {values.length > 0 && <div className="kpi-trend" aria-label={`Trend containing ${values.length} recorded values`}><svg viewBox="0 0 100 48" role="img"><polyline points={points} /></svg><span>{fmtNumber(min)} – {fmtNumber(max)}</span></div>}
    <DataTable loading={loading} error={error} onRetry={() => load(data.page)} rows={data.rows} empty="No calculated values have been recorded." columns={[
      { key: 'calculated_at', label: 'Calculated', render: row => fmtDateTime(row.calculated_at) },
      { key: 'value', label: 'Value', numeric: true, render: row => fmtNumber(row.value) },
      { key: 'status', label: 'Health', render: row => <ToneBadge tone={healthTone(row.status)}>{label(row.status)}</ToneBadge> },
      { key: 'calculated_by_name', label: 'Calculated by', render: row => row.calculated_by_name || 'System' },
    ]} />
    <Pagination page={data.page} total={data.total} pageSize={data.page_size} loading={loading} onPageChange={load} />
  </Modal>;
}

export default function KpiManagement() {
  const toast = useToast();
  const [meta, setMeta] = useState(null), [data, setData] = useState({ rows: [], total: 0, counts: {} });
  const [filters, setFilters] = useState({ search: '', data_source: '', scope_type: '', enabled: '' }), [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [editing, setEditing] = useState(undefined), [history, setHistory] = useState(null), [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);

  const load = useCallback(async (signal) => {
    setLoading(true); setError('');
    try { setData(await api.kpiDefinitions({ ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== '')), page, page_size: PAGE_SIZE }, { signal })); }
    catch (failure) { if (failure.name !== 'AbortError') setError(failure.message); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [filters, page]);

  useEffect(() => {
    const controller = new AbortController(), timer = setTimeout(() => load(controller.signal), filters.search ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [load, filters.search]);
  useEffect(() => { const controller = new AbortController(); api.kpiDefinitionMeta({ signal: controller.signal }).then(setMeta).catch(failure => { if (failure.name !== 'AbortError') setError(failure.message); }); return () => controller.abort(); }, []);

  function changeFilter(key, value) { setFilters(current => ({ ...current, [key]: value })); setPage(1); }
  async function action(row, type) {
    const id = `${type}:${row.id}`; setBusy(id); setResult(null);
    try {
      if (type === 'state') { await api.setKpiDefinitionState(row.id, !row.enabled, row.version); toast.success(row.enabled ? 'KPI deactivated' : 'KPI activated'); }
      else {
        const response = type === 'test' ? await api.testKpiDefinition(row.id) : await api.calculateKpiDefinition(row.id);
        setResult({ name: row.name, type, ...response }); toast.success(type === 'test' ? 'Calculation test completed' : 'KPI value recorded');
      }
      await load();
    } catch (failure) { setError(failure.status === 409 ? `${failure.message}. The list has been refreshed.` : failure.message); await load(); }
    finally { setBusy(''); }
  }

  const sourceLabels = useMemo(() => Object.fromEntries((meta?.data_sources || []).map(source => [source.key, source.label])), [meta]);
  const columns = [
    { key: 'name', label: 'KPI', render: row => <div className="kpi-name-cell"><strong>{row.name}</strong><span>{row.description || row.category}</span></div> },
    { key: 'source', label: 'Source', render: row => <><strong>{sourceLabels[row.data_source] || label(row.data_source)}</strong><small className="kpi-cell-note">{row.category}</small></> },
    { key: 'scope', label: 'Scope', render: row => <><ToneBadge>{label(row.scope_type)}</ToneBadge><small className="kpi-cell-note">{row.team_name || row.project_title || 'All operations'}</small></> },
    { key: 'current', label: 'Current value', numeric: true, render: row => row.current_value == null ? <span className="text-muted">Not calculated</span> : <><strong>{fmtNumber(row.current_value)}</strong><small className="kpi-cell-note">Target {fmtNumber(row.target_value)}</small></> },
    { key: 'health', label: 'Health', render: row => <><ToneBadge tone={healthTone(row.current_status)}>{row.current_status ? label(row.current_status) : 'No value'}</ToneBadge><small className="kpi-cell-note">{row.enabled ? 'Enabled' : 'Disabled'}</small></> },
    { key: 'actions', label: 'Actions', render: row => <div className="kpi-row-actions">
      <button className="btn btn-ghost btn-sm" onClick={() => setEditing(row)}>Edit</button>
      <button className="btn btn-ghost btn-sm" onClick={() => action(row, 'test')} disabled={!!busy}><Play size={13} /> Test</button>
      <button className="btn btn-ghost btn-sm" onClick={() => action(row, 'calculate')} disabled={!!busy || !row.enabled}><RefreshCw size={13} className={busy === `calculate:${row.id}` ? 'spin' : ''} /> Calculate</button>
      <button className="btn btn-ghost btn-sm" onClick={() => setHistory(row)}><History size={13} /> History</button>
      <button className="btn btn-ghost btn-sm" onClick={() => action(row, 'state')} disabled={!!busy}>{row.enabled ? 'Deactivate' : 'Activate'}</button>
    </div> },
  ];

  return <div className="page kpi-management-page">
    <PageHeader eyebrow="Management intelligence" title="KPI Management" description="Define trusted indicators, test their calculations, and review recorded performance without exposing management data to engineers." actions={<button className="btn btn-primary" onClick={() => setEditing(null)} disabled={!meta}><Plus size={16} /> New KPI</button>} />
    <MetricStrip items={[
      { key: 'all', label: 'Definitions', value: data.counts?.total || 0, note: 'Configured indicators' },
      { key: 'enabled', label: 'Enabled', value: data.counts?.enabled || 0, tone: 'success', note: 'Available to calculate' },
      { key: 'disabled', label: 'Disabled', value: data.counts?.disabled || 0, note: 'History retained' },
      { key: 'team', label: 'Team scoped', value: data.counts?.team_scoped || 0, tone: 'info', note: 'Team-specific measures' },
    ]} />
    {result && <div className={`kpi-run-result is-${result.status}`} role="status"><BarChart3 size={18} /><div><strong>{result.name}: {fmtNumber(result.value)}</strong><span>{result.type === 'test' ? 'Test result only; no history was changed.' : 'Value recorded in KPI history.'}</span></div><ToneBadge tone={healthTone(result.status)}>{label(result.status)}</ToneBadge><button onClick={() => setResult(null)} aria-label="Dismiss result">×</button></div>}
    <Surface title="Definition catalogue" description="Search and filter the approved KPI catalogue. Calculations always run on the server.">
      <div className="kpi-toolbar">
        <input type="search" value={filters.search} onChange={event => changeFilter('search', event.target.value)} placeholder="Search name, category or description" aria-label="Search KPI definitions" />
        <select value={filters.data_source} onChange={event => changeFilter('data_source', event.target.value)} aria-label="Filter by data source"><option value="">All sources</option>{meta?.data_sources.map(source => <option key={source.key} value={source.key}>{source.label}</option>)}</select>
        <select value={filters.scope_type} onChange={event => changeFilter('scope_type', event.target.value)} aria-label="Filter by scope"><option value="">All scopes</option><option value="organization">Organization</option><option value="team">Team</option><option value="project">Project</option></select>
        <select value={filters.enabled} onChange={event => changeFilter('enabled', event.target.value)} aria-label="Filter by state"><option value="">Any state</option><option value="true">Enabled</option><option value="false">Disabled</option></select>
      </div>
      <DataTable columns={columns} rows={data.rows} loading={loading} error={error} onRetry={() => load()} empty="No KPI definitions match these filters." caption="KPI definitions" />
      <Pagination page={page} total={data.total} pageSize={PAGE_SIZE} loading={loading} onPageChange={setPage} />
    </Surface>
    {editing !== undefined && meta && <DefinitionDialog definition={editing} meta={meta} onClose={() => setEditing(undefined)} onSaved={message => { setEditing(undefined); toast.success(message); load(); }} />}
    {history && <HistoryDialog definition={history} onClose={() => setHistory(null)} />}
  </div>;
}
