import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../App';
import { Link } from 'react-router-dom';
import ReportScheduleDialog from './ReportScheduleDialog';
import { useLatestRequest } from '../hooks/useLatestRequest';
import { Modal } from './Shared';
import { useToast } from './Toast';
import { useConfirm } from './Confirm';

const initial = () => ({ source: 'tasks',fields: ['id','title','status'],filters: [],group_by: [],aggregations: [],sort: [] });

function SaveDialog({ selected,definition,references,onSaved,onClose }) {
  const [name,setName] = useState(selected?.name || '');
  const [visibility,setVisibility] = useState(selected?.visibility || 'private');
  const [sharedUsers,setSharedUsers] = useState(selected?.shared_user_ids || []);
  const [sharedTeams,setSharedTeams] = useState(selected?.shared_team_ids || []);
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState('');
  const lock = useRef(false);
  async function submit(event) {
    event.preventDefault();
    if (lock.current) return;
    lock.current=true; setSaving(true); setError('');
    try {
      const body = { name,visibility,definition,shared_user_ids: visibility==='shared' ? sharedUsers : [],shared_team_ids: visibility==='shared' ? sharedTeams : [] };
      const result = selected ? await api.updateSavedReport(selected.id,{ ...body,version: selected.version }) : await api.createSavedReport(body);
      onSaved({ ...body,...result,can_edit: true }); onClose();
    } catch (failure) { setError(failure.message); }
    finally { lock.current=false; setSaving(false); }
  }
  return <Modal title={selected ? 'Update saved report' : 'Save new report'} onClose={saving ? () => {} : onClose}>
    <form onSubmit={submit}>
      {error && <div className="error-msg" role="alert">{error}</div>}
      <div className="form-group"><label htmlFor="report-name">Name</label><input id="report-name" value={name} onChange={event => setName(event.target.value)} required maxLength={200} disabled={saving} autoFocus /></div>
      <div className="form-group"><label htmlFor="report-visibility">Visibility</label><select id="report-visibility" value={visibility} onChange={event => setVisibility(event.target.value)} disabled={saving}><option value="private">Private to you</option><option value="shared">Specific managers or teams</option><option value="management">All management</option></select></div>
      {visibility==='shared' && <div className="form-row" style={{ alignItems: 'start' }}>
        <fieldset><legend>Managers</legend><div style={{ maxHeight: 180,overflowY: 'auto' }}>{references.share_users.map(row => <label key={row.id} className="flex gap-6"><input type="checkbox" checked={sharedUsers.includes(row.id)} onChange={event => setSharedUsers(old => event.target.checked ? [...old,row.id] : old.filter(id => id!==row.id))} disabled={saving} />{row.name}</label>)}</div></fieldset>
        <fieldset><legend>Teams</legend><div style={{ maxHeight: 180,overflowY: 'auto' }}>{references.share_teams.map(row => <label key={row.id} className="flex gap-6"><input type="checkbox" checked={sharedTeams.includes(row.id)} onChange={event => setSharedTeams(old => event.target.checked ? [...old,row.id] : old.filter(id => id!==row.id))} disabled={saving} />{row.name}</label>)}</div></fieldset>
        <p className="text-muted text-sm">Team sharing grants access to active managers who belong to those teams. Scheduled recipients must also have report access.</p>
      </div>}
      <p className="text-muted text-sm">Definitions store the query choices. Runs use current data and permissions; results are not stored here.</p>
      <div className="modal-footer"><button className="btn btn-ghost" type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save report'}</button></div>
    </form>
  </Modal>;
}

export default function ReportBuilder() {
  const { user } = useAuth();
  const toast = useToast(),confirm = useConfirm();
  const [page,setPage] = useState(1);
  const [references,setReferences] = useState(null);
  const [loaded,setLoaded] = useState(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [definition,setDefinition] = useState(initial);
  const [selected,setSelected] = useState(null);
  const [preview,setPreview] = useState(null);
  const [running,setRunning] = useState(false);
  const [exporting,setExporting] = useState(false);
  const [save,setSave] = useState(null);
  const [schedule,setSchedule] = useState(null);
  const scope = `${user.id}:${page}`;
  const signature = `${user.id}:${JSON.stringify(definition)}`;
  const reads = useLatestRequest(scope),runs = useLatestRequest(signature),opens = useLatestRequest(`${signature}:open`);
  const load = useCallback(() => {
    const request = reads.begin();
    if (request.signal.aborted) return;
    setLoading(true); setError('');
    const options = { signal: request.signal };
    Promise.all([api.customReportSources(options),api.savedReports({ page },options)]).then(([metadata,saved]) => {
      if (!reads.isCurrent(request)) return;
      setReferences({ ...metadata,saved }); setLoaded(scope);
      const last = Math.max(1,Math.ceil(saved.total/saved.page_size));
      if (page>last) setPage(last);
    }).catch(failure => { if (reads.isCurrent(request)) setError(failure.message); })
      .finally(() => { if (reads.isCurrent(request)) setLoading(false); });
  }, [page,scope,reads.begin,reads.isCurrent]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPreview(null); setRunning(false); }, [signature]);
  useEffect(() => { setSelected(null); setDefinition(initial()); setSave(null); setSchedule(null); }, [user.id]);
  const source = references?.sources.find(row => row.key===definition.source);
  const grouped = !!(definition.group_by.length || definition.aggregations.length);
  const set = (key,value) => setDefinition(old => ({ ...old,[key]: value }));
  const change = (key,index,value) => set(key,definition[key].map((entry,i) => {
    if (i!==index) return entry;
    const next={ ...entry,...value };
    for (const [name,item] of Object.entries(value)) if (item===undefined) delete next[name];
    return next;
  }));
  function collect() {
    return { ...definition,filters: definition.filters.map(filter => {
      if (['is_null','is_not_null'].includes(filter.operator)) return { field: filter.field,operator: filter.operator };
      const field = source.fields.find(row => row.key===filter.field);
      if (filter.relative) {
        if (String(filter.relative.offset_days).trim()==='') throw new Error(`Enter a relative day offset for ${field.label}`);
        return { field: filter.field,operator: filter.operator,relative: { anchor: filter.relative.anchor,offset_days: Number(filter.relative.offset_days) } };
      }
      const parse = value => {
        if (['number','id'].includes(field.type)) {
          if (String(value).trim()==='') throw new Error(`Enter a value for ${field.label}`);
          return Number(value);
        }
        return value;
      };
      return { ...filter,value: ['in','not_in'].includes(filter.operator) ? String(filter.value).split(',').map(value => parse(value.trim())) : parse(filter.value) };
    }) };
  }
  async function run(event) {
    event.preventDefault();
    const request = runs.begin();
    setRunning(true); setError('');
    try {
      const result = await api.customReportPreview(collect(),{ signal: request.signal });
      if (runs.isCurrent(request)) setPreview({ ...result,signature });
    } catch (failure) { if (runs.isCurrent(request)) setError(failure.message); }
    finally { if (runs.isCurrent(request)) setRunning(false); }
  }
  async function exportReport(format) {
    if (exporting) return;
    setExporting(true); setError('');
    try {
      const blob = await api.customReportExport(collect(),format);
      const url = URL.createObjectURL(blob),anchor = document.createElement('a');
      anchor.href=url; anchor.download=`custom-report.${format}`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url),1000);
    } catch (failure) { setError(failure.message); }
    finally { setExporting(false); }
  }
  async function openReport(id) {
    const request = opens.begin();
    try {
      const row = await api.savedReport(id,{ signal: request.signal });
      if (opens.isCurrent(request)) { setSelected(row); setDefinition({ ...initial(),...row.definition }); setError(''); }
    } catch (failure) { if (opens.isCurrent(request)) setError(failure.message); }
  }
  function saveReport(overwrite) {
    try { setSave({ selected: overwrite ? selected : null,definition: collect() }); }
    catch (failure) { setError(failure.message); }
  }
  async function deleteReport() {
    const target = selected;
    if (!await confirm(`Delete saved report "${target.name}"?`,{ title: 'Delete saved report' })) return;
    try { await api.deleteSavedReport(target.id,target.version); setSelected(null); load(); toast.success('Saved report deleted'); }
    catch (failure) { setError(failure.message); }
  }
  const busy = loading || loaded!==scope;
  if (busy && !error) return <p role="status">Loading report sources and definitions...</p>;
  if (busy || !references || !source) return <div className="error-msg" role="alert">{error || 'Report metadata unavailable'} <button className="btn btn-ghost" onClick={load}>Retry</button><button className="btn btn-ghost" onClick={() => { setSelected(null); setDefinition(initial()); }}>New definition</button></div>;
  const output = grouped ? [...definition.group_by.map(key => ({ key,label: source.fields.find(row => row.key===key)?.label || key })),...definition.aggregations.map((entry,i) => ({ key: `metric_${i}`,label: `${entry.operation} ${entry.field}` }))] : source.fields;
  return <section>
    {error && <div className="error-msg" role="alert">{error}</div>}
    <section className="card mb-20">
      <h2 style={{ fontSize: 18 }}>Report templates</h2>
      <p className="text-muted text-sm">Preview date: {references.templates.as_of} UTC. Template date ranges stay relative and resolve again whenever a saved or scheduled report runs.</p>
      <div style={{ display: 'grid',gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))',gap: 12 }}>
        {references.templates.rows.map(template => <div key={template.key}>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => { opens.begin(); setSelected(null); setDefinition({ ...initial(),...template.definition }); setError(''); }}>{template.label}</button>
          <p className="text-muted text-sm">{template.description}</p>
        </div>)}
        <div><Link className="btn btn-ghost btn-sm" to="/workload">Workload and capacity</Link><p className="text-muted text-sm">Review recorded effort, missing estimates and weekly availability in the workload model.</p></div>
      </div>
    </section>
    <section className="card mb-20">
      <h2 style={{ fontSize: 18 }}>Saved reports</h2>
      <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>{references.saved.rows.map(row => <button className="btn btn-ghost btn-sm" key={row.id} onClick={() => openReport(row.id)}>{row.name} · {row.visibility}</button>)}</div>
      <div className="flex gap-8 mt-12"><button className="btn btn-ghost btn-sm" disabled={page<=1} onClick={() => setPage(value => value-1)}>Previous</button><span>Page {page} · {references.saved.total} definitions</span><button className="btn btn-ghost btn-sm" disabled={page*25>=references.saved.total} onClick={() => setPage(value => value+1)}>Next</button><button className="btn btn-ghost btn-sm" onClick={load}>Refresh</button></div>
    </section>
    <form onSubmit={run} className="card">
      <h2 style={{ fontSize: 18 }}>Report Builder{selected ? ` · ${selected.name}` : ''}</h2>
      <p className="text-muted text-sm">{source.grain}. Preview up to {references.preview_limit} rows; exports reject more than {references.export_limit} rows.</p>
      {selected && !selected.can_edit && <p className="text-muted">Shared report: you may run it or save a copy. Its owner controls changes.</p>}
      <div className="form-group"><label htmlFor="report-source">Source</label><select id="report-source" value={definition.source} onChange={event => { setSelected(null); setDefinition({ source: event.target.value,fields: ['id'],filters: [],group_by: [],aggregations: [],sort: [] }); }}>{references.sources.map(row => <option key={row.key} value={row.key}>{row.label}</option>)}</select></div>
      <label className="flex gap-8"><input type="checkbox" checked={grouped} onChange={event => setDefinition(old => ({ ...old,fields: [],group_by: [],aggregations: event.target.checked ? [{ field: '*',operation: 'count' }] : [],sort: [] }))} />Group and aggregate</label>
      <fieldset style={{ border: '1px solid var(--gray-200)',padding: 12,margin: '12px 0' }}><legend>{grouped ? 'Grouping fields (up to 4)' : 'Output fields (up to 12)'}</legend><div style={{ display: 'flex',flexWrap: 'wrap',gap: 12 }}>{source.fields.map(field => <label key={field.key} className="flex gap-6"><input type="checkbox" checked={definition.fields.includes(field.key)} disabled={!definition.fields.includes(field.key) && definition.fields.length>=(grouped ? 4 : 12)} onChange={event => { const fields=event.target.checked ? [...definition.fields,field.key] : definition.fields.filter(key => key!==field.key); setDefinition(old => ({ ...old,fields,group_by: grouped ? fields : [],sort: [] })); }} />{field.label}</label>)}</div></fieldset>
      {grouped && <fieldset><legend>Aggregations</legend>{definition.aggregations.map((entry,index) => <div className="form-row" key={index}>
        <select aria-label={`Measure ${index+1}`} value={entry.field} onChange={event => change('aggregations',index,{ field: event.target.value,operation: 'count' })}><option value="*">All records</option>{source.fields.map(field => <option key={field.key} value={field.key}>{field.label}</option>)}</select>
        <select aria-label={`Aggregation ${index+1}`} value={entry.operation} onChange={event => change('aggregations',index,{ operation: event.target.value })}>{(entry.field==='*' ? ['count'] : source.fields.find(field => field.key===entry.field)?.aggregations || ['count']).map(value => <option key={value} value={value}>{value}</option>)}</select>
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => set('aggregations',definition.aggregations.filter((_,i) => i!==index))}>Remove</button>
      </div>)}<button className="btn btn-ghost btn-sm" type="button" disabled={definition.aggregations.length>=6} onClick={() => set('aggregations',[...definition.aggregations,{ field: '*',operation: 'count' }])}>Add aggregation</button></fieldset>}
      <fieldset style={{ margin: '16px 0' }}><legend>Filters (all must match)</legend>{definition.filters.map((entry,index) => {
        const field=source.fields.find(row => row.key===entry.field);
        return <div className="form-row" key={index}>
          <select aria-label={`Filter field ${index+1}`} value={entry.field} onChange={event => change('filters',index,{ field: event.target.value,operator: 'eq',value: '',relative: undefined })}>{source.fields.map(row => <option key={row.key} value={row.key}>{row.label}</option>)}</select>
          <select aria-label={`Filter operator ${index+1}`} value={entry.operator} onChange={event => change('filters',index,{ operator: event.target.value,...(['in','not_in','is_null','is_not_null'].includes(event.target.value) ? { relative: undefined } : {}) })}>{field.operators.map(value => <option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}</select>
          {field.type==='date' && !['in','not_in','is_null','is_not_null'].includes(entry.operator) && <select aria-label={`Date mode ${index+1}`} value={entry.relative?.anchor || 'fixed'} onChange={event => change('filters',index,event.target.value==='fixed' ? { relative: undefined,value: '' } : { value: undefined,relative: { anchor: event.target.value,offset_days: 0 } })}><option value="fixed">Fixed date</option><option value="today">Run date</option><option value="week_start">Start of run week</option><option value="week_end">End of run week</option><option value="month_start">Start of run month</option><option value="month_end">End of run month</option></select>}
          {entry.relative && <input aria-label={`Relative day offset ${index+1}`} type="number" min="-3660" max="3660" step="1" required value={entry.relative.offset_days} onChange={event => change('filters',index,{ relative: { ...entry.relative,offset_days: event.target.value } })} title="Days before (-) or after (+) the selected anchor" />}
          {!entry.relative && !['is_null','is_not_null'].includes(entry.operator) && <input aria-label={`Filter value ${index+1}`} value={Array.isArray(entry.value) ? entry.value.join(',') : entry.value} onChange={event => change('filters',index,{ value: event.target.value })} type={['in','not_in'].includes(entry.operator) ? 'text' : field.type==='date' ? 'date' : ['id','number'].includes(field.type) ? 'number' : 'text'} step={field.type==='id' ? 1 : 'any'} min={field.type==='id' ? 1 : undefined} placeholder={['in','not_in'].includes(entry.operator) ? 'Comma-separated values' : 'Value'} maxLength={5000} />}
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => set('filters',definition.filters.filter((_,i) => i!==index))}>Remove</button>
        </div>;
      })}<button className="btn btn-ghost btn-sm" type="button" disabled={definition.filters.length>=12} onClick={() => set('filters',[...definition.filters,{ field: source.fields[0].key,operator: 'eq',value: '' }])}>Add filter</button></fieldset>
      <fieldset style={{ margin: '16px 0' }}><legend>Sorts</legend>{definition.sort.map((entry,index) => <div className="form-row" key={index}><select aria-label={`Sort field ${index+1}`} value={entry.field} onChange={event => change('sort',index,{ field: event.target.value })}>{output.map(row => <option key={row.key} value={row.key}>{row.label}</option>)}</select><select aria-label={`Sort direction ${index+1}`} value={entry.direction} onChange={event => change('sort',index,{ direction: event.target.value })}><option value="asc">Ascending</option><option value="desc">Descending</option></select><button className="btn btn-ghost btn-sm" type="button" onClick={() => set('sort',definition.sort.filter((_,i) => i!==index))}>Remove</button></div>)}<button className="btn btn-ghost btn-sm" type="button" disabled={definition.sort.length>=3 || !output.length} onClick={() => set('sort',[...definition.sort,{ field: output[0].key,direction: 'asc' }])}>Add sort</button></fieldset>
      <div className="flex gap-8" style={{ flexWrap: 'wrap' }}><button className="btn btn-primary" type="submit" disabled={running}>{running ? 'Running...' : 'Preview'}</button><button className="btn btn-ghost" type="button" disabled={exporting} onClick={() => exportReport('xlsx')}>Export Excel</button><button className="btn btn-ghost" type="button" disabled={exporting} onClick={() => exportReport('csv')}>Export CSV</button><button className="btn btn-ghost" type="button" onClick={() => saveReport(false)}>Save as new</button>{selected?.can_edit && <><button className="btn btn-ghost" type="button" onClick={() => setSchedule(selected)}>Delivery schedule</button><button className="btn btn-ghost" type="button" onClick={() => saveReport(true)}>Update saved report</button><button className="btn btn-danger" type="button" onClick={deleteReport}>Delete definition</button></>}</div>
    </form>
    {preview?.signature===signature && <section className="card table-wrap mt-20"><p>{preview.rows.length} preview rows{preview.truncated ? ' · More matching rows exist; preview is truncated.' : ''}</p><table><thead><tr>{preview.columns.map(column => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{preview.rows.map((row,index) => <tr key={index}>{preview.columns.map(column => <td key={column.key}>{row[column.key] ?? '—'}</td>)}</tr>)}</tbody></table>{!preview.rows.length && <p>No matching records.</p>}</section>}
    {schedule && <ReportScheduleDialog report={schedule} onClose={() => setSchedule(null)} />}
    {save && <SaveDialog selected={save.selected} definition={save.definition} references={references} onClose={() => setSave(null)} onSaved={row => { setSelected({ ...row,owner_id: user.id }); toast.success('Report definition saved'); load(); }} />}
  </section>;
}
