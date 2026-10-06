import { useEffect,useState } from 'react';
import { ChevronDown,ChevronUp,Download,FileText,Plus,Save,Trash2,Upload,X } from 'lucide-react';
import { api } from '../../api';
import { Toggle } from './shared';
import { ReportTableColumns } from './ReportTableColumns';
import './ReportTableColumns.css';

const LABELS={ executive_summary:'Executive summary',service_overview:'Service overview',ticket_summary:'Ticket summary',open_tickets:'Open tickets',period_tickets:'Period tickets',service_activities:'Service activities',tasks:'Tasks',projects:'Projects',maintenance_visits:'Maintenance Visits',recommendations:'Recommendations',risks:'Risks',upcoming_work:'Upcoming work',management_notes:'Management notes',changes:'Changes and upgrades',resolved_tickets:'Resolved tickets',assets:'Assets and support status' };
const empty={ name:'',description:'',sections:Object.keys(LABELS),default_narratives:{},tables:{},active:true,version:0 };
const saveBlob=(blob,name) => { const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(() => URL.revokeObjectURL(url),1000); };
const EDITABLE=['name','description','sections','default_narratives','tables','active','version'];

/* Odyssey's own Word layout for this report template. Uploads are checked by the
   server; a template with unknown or broken placeholders is refused with the list. */
function WordLayout({ template,onChanged }) {
  const [busy,setBusy]=useState(''),[problem,setProblem]=useState(null),[note,setNote]=useState(''),[reference,setReference]=useState(null);
  const run=async (label,action) => { setBusy(label);setProblem(null);setNote('');try { await action(); } catch(failure) { setProblem({ message:failure.message,details:failure.details || [] }); } finally { setBusy(''); } };
  const upload=file => run('upload',async () => { const saved=await api.uploadManagedReportWordTemplate(template.id,file);onChanged(saved);setNote(`${saved.word_template_name} is now used for this template's Word reports.`); });
  const showReference=() => run('reference',async () => setReference((await api.managedReportPlaceholders()).rows));
  return <section className="word-layout" aria-labelledby="word-layout-title">
    <h3 id="word-layout-title" className="u-999b629">Word layout</h3>
    <p className="text-muted text-sm">{template.has_word_template
      ? <><FileText size={13} aria-hidden="true" /> Word reports use <strong>{template.word_template_name}</strong>{template.word_template_uploaded_at ? `, uploaded ${template.word_template_uploaded_at.slice(0,10)}` : ''}.</>
      : "Word reports use the built-in layout. Upload your own .docx to use Odyssey's design."}</p>
    {problem && <div className="error-msg word-layout-error" role="alert">{problem.message}{problem.details.length > 0 && <ul className="word-layout-problems">{problem.details.map(item => <li key={item}>{item}</li>)}</ul>}</div>}
    {note && <div className="alert alert-success">{note}</div>}
    <div className="flex gap-8 flex-wrap">
      <label className={`btn btn-primary btn-sm${busy ? ' disabled' : ''}`}><Upload size={13} aria-hidden="true" /> {busy==='upload' ? 'Checking…' : template.has_word_template ? 'Replace Word template' : 'Upload Word template'}
        <input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden disabled={!!busy}
          onChange={event => { const file=event.target.files?.[0];event.target.value='';if (file) upload(file); }} /></label>
      {template.has_word_template && <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => run('download',async () => saveBlob(await api.downloadManagedReportWordTemplate(template.id),template.word_template_name || 'template.docx'))}><Download size={13} aria-hidden="true" /> Download current</button>}
      {template.has_word_template && <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => run('remove',async () => { onChanged(await api.removeManagedReportWordTemplate(template.id));setNote('Word reports use the built-in layout again.'); })}><Trash2 size={13} aria-hidden="true" /> Use built-in layout</button>}
      <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => run('starter',async () => saveBlob(await api.managedReportStarterTemplate(),'customer-report-template.docx'))}><Download size={13} aria-hidden="true" /> Starter template</button>
    </div>
    <details className="word-layout-reference" onToggle={event => { if (event.target.open && !reference) showReference(); }}>
      <summary>Placeholders you can use</summary>
      <p className="text-muted text-sm">Type a placeholder in curly braces, e.g. <code>{'{customer_name}'}</code>. To repeat a table row for each item, put <code>{'{#changes}'}</code> in its first cell and <code>{'{/changes}'}</code> in its last. Wrap a section in <code>{'{#include_assets}'}</code> … <code>{'{/include_assets}'}</code> to show it only when this template includes it, and use <code>{'{^has_changes}'}No changes.{'{/has_changes}'}</code> for an empty list.</p>
      {reference && <table className="word-layout-table"><thead><tr><th>Placeholder</th><th>What it contains</th></tr></thead><tbody>{reference.map(row => <tr key={row.tag}>
        <td><code>{row.kind === 'list' ? `{#${row.tag}}…{/${row.tag}}` : `{${row.tag}}`}</code></td>
        <td>{row.description}{row.fields && <div className="text-muted text-sm">Inside: {row.fields.map(field => <code key={field.field} title={field.description}>{`{${field.field}}`}</code>).reduce((all,item) => [...all,' ',item],[])}</div>}</td>
      </tr>)}</tbody></table>}
    </details>
  </section>;
}

export function ManagedReportTemplatesTab() {
  const [catalogue,setCatalogue]=useState([]),[rows,setRows]=useState([]),[form,setForm]=useState(empty),[selected,setSelected]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const load=async () => { const result=await api.managedReportTemplates();setRows(result.rows || []);setCatalogue(result.tables || []);return result.rows || []; };
  useEffect(() => { load().catch(failure => setError(failure.message)); },[]);
  const edit=row => { setSelected(row.id);setForm({ ...row,default_narratives:{ ...row.default_narratives },tables:{ ...(row.tables || {}) } });setError('');setMessage(''); };
  const reset=() => { setSelected(null);setForm({ ...empty,sections:[...empty.sections],default_narratives:{},tables:{} }); };
  const toggle=key => setForm(current => ({ ...current,sections:current.sections.includes(key)?current.sections.filter(value => value!==key):[...current.sections,key] }));
  const move=(index,direction) => setForm(current => { const sections=[...current.sections],target=index+direction;if (target<0 || target>=sections.length) return current;[sections[index],sections[target]]=[sections[target],sections[index]];return { ...current,sections }; });
  async function save() { setBusy(true);setError('');setMessage('');try { const payload=Object.fromEntries(EDITABLE.filter(key => key in form).map(key => [key,form[key]]));const saved=selected?await api.updateManagedReportTemplate(selected,payload):await api.createManagedReportTemplate(payload);await load();edit(saved);setMessage('Report template saved.'); } catch(failure) { setError(failure.message); } finally { setBusy(false); } }
  async function remove() { setBusy(true);setError('');try { await api.deleteManagedReportTemplate(selected);await load();reset();setMessage('Report template deleted.'); } catch(failure) { setError(failure.message); } finally { setBusy(false); } }
  return <div className="u-cf23e32"><aside className="card u-cc781ba"><button className="btn btn-primary btn-sm u-31b5119" onClick={reset}><Plus size={13} /> New template</button>{rows.map(row => <button key={row.id} className={`settings-nav-item report-template-item${selected===row.id?' active':''}`} onClick={() => edit(row)}><span>{row.name}</span>{!row.active && <small>Inactive</small>}</button>)}</aside><section className="card">
    {error && <div className="error-msg" role="alert">{error}</div>}{message && <div className="alert alert-success">{message}</div>}
    <div className="form-group"><label>Template name</label><input maxLength={120} value={form.name} onChange={event => setForm(current => ({ ...current,name:event.target.value }))} /></div><div className="form-group"><label>Description</label><textarea rows={2} maxLength={1000} value={form.description} onChange={event => setForm(current => ({ ...current,description:event.target.value }))} /></div><Toggle checked={form.active} onChange={active => setForm(current => ({ ...current,active }))} label="Active template" />
    <h3 className="u-999b629">Sections and order</h3><div className="u-5646293">{form.sections.map((key,index) => <div key={key} className="u-a4f885d"><span className="u-7829123">{index+1}. {LABELS[key]}</span><button className="btn btn-ghost btn-sm" aria-label={`Move ${LABELS[key]} up`} disabled={!index} onClick={() => move(index,-1)}><ChevronUp size={13} /></button><button className="btn btn-ghost btn-sm" aria-label={`Move ${LABELS[key]} down`} disabled={index===form.sections.length-1} onClick={() => move(index,1)}><ChevronDown size={13} /></button><button className="btn btn-ghost btn-sm" aria-label={`Remove ${LABELS[key]}`} onClick={() => toggle(key)}><X size={13} /></button></div>)}</div><div className="flex gap-8 u-a8b6fba">{Object.entries(LABELS).filter(([key]) => !form.sections.includes(key)).map(([key,label]) => <button key={key} className="btn btn-ghost btn-sm" onClick={() => toggle(key)}><Plus size={12} /> {label}</button>)}</div>
    <ReportTableColumns catalogue={catalogue} sections={form.sections} tables={form.tables || {}} onChange={tables => setForm(current => ({ ...current,tables }))} />
    <h3 className="u-999b629">Default narrative</h3><textarea rows={5} maxLength={10000} value={form.default_narratives.executive_summary || ''} onChange={event => setForm(current => ({ ...current,default_narratives:{ ...current.default_narratives,executive_summary:event.target.value } }))} placeholder="Default executive summary text" />
    <div className="flex gap-8 u-1b0f499"><button className="btn btn-primary" disabled={busy || !form.name.trim() || !form.sections.length} onClick={save}><Save size={14} /> Save template</button>{selected && <button className="btn btn-danger" disabled={busy} onClick={remove}><Trash2 size={14} /> Delete</button>}</div>
    {selected ? <WordLayout template={form} onChanged={saved => { setRows(current => current.map(row => row.id===saved.id ? saved : row));setForm(current => ({ ...current,has_word_template:saved.has_word_template,word_template_name:saved.word_template_name,word_template_uploaded_at:saved.word_template_uploaded_at })); }} />
      : <p className="text-muted text-sm">Save the template first, then you can attach a Word layout to it.</p>}
  </section></div>;
}
