import { useEffect,useState } from 'react';
import { Download,FileText,RotateCcw,Save,Trash2,Upload } from 'lucide-react';
import { api } from '../../api';
import './ReportTableColumns.css';

/* Settings → Customer report template: the company's one template for the
   customer report (Customer 360 → Reports) — wording, colour, default sections
   and an optional Word layout. Every customer's report uses it.
   Server: customerValueReport.js (WORDING_DEFAULTS, checkWording, companyTemplate). */

const SECTION_LABELS={ changes:'Changes and upgrades',tickets:'Tickets resolved',tasks:'Tasks completed',work_log:'Work log (every activity)',recommendations:'Our recommendations',upcoming:'Coming next',assets:'Devices we look after' };
const HEADING_LABELS={ summary:'Summary',work:'Work delivered (hours by type of work)',changes:'Changes and upgrades',tickets:'Tickets resolved',tasks:'Tasks completed',work_log:'Work log',recommendations:'Recommendations',assets:'Devices',upcoming:'Coming next' };
const FIGURE_LABELS={ hours:'Hours of work',activities:'Activities',changes:'Changes and upgrades',tickets:'Tickets resolved',tasks:'Tasks completed' };
const EMPTY_LABELS={ work:'Work delivered',changes:'Changes and upgrades',tickets:'Tickets resolved',tasks:'Tasks completed',work_log:'Work log',recommendations:'Recommendations',assets:'Devices' };
// Fields the old report builder used; kept as they are so saving does not change them.
const LEGACY={ sections:['executive_summary','service_overview','ticket_summary','service_activities','tasks','recommendations','upcoming_work'],default_narratives:{},tables:{} };
const empty={ name:'Customer report',description:'',active:true,version:0,wording:{},...LEGACY };
const saveBlob=(blob,name) => { const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(() => URL.revokeObjectURL(url),1000); };
const EDITABLE=['name','description','sections','default_narratives','tables','active','version','wording'];

// The text shown in the form: what is saved, or the built-in wording.
function effective(saved,defaults) {
  if (!defaults) return {};
  const group=key => Object.fromEntries(Object.keys(defaults[key]).map(name => [name,saved?.[key]?.[name] || defaults[key][name]]));
  const text=key => (typeof saved?.[key]==='string' ? saved[key] : defaults[key]);
  return { title:text('title'),intro:text('intro'),closing:text('closing'),footer:text('footer'),default_summary:text('default_summary'),default_coming_next:text('default_coming_next'),
    show_overview:typeof saved?.show_overview==='boolean' ? saved.show_overview : true,color:saved?.color || defaults.color,
    sections:Array.isArray(saved?.sections) ? saved.sections : defaults.sections,headings:group('headings'),figures:group('figures'),empty:group('empty') };
}

/* The template's own Word layout. Uploads are checked by the server; a template
   with unknown or broken placeholders is refused with the list. */
function WordLayout({ template,onChanged }) {
  const [busy,setBusy]=useState(''),[problem,setProblem]=useState(null),[note,setNote]=useState(''),[reference,setReference]=useState(null);
  const run=async (label,action) => { setBusy(label);setProblem(null);setNote('');try { await action(); } catch(failure) { setProblem({ message:failure.message,details:failure.details || [] }); } finally { setBusy(''); } };
  const upload=file => run('upload',async () => { const saved=await api.uploadManagedReportWordTemplate(template.id,file);onChanged(saved);setNote(`${saved.word_template_name} is now used for this template's Word reports.`); });
  const showReference=() => run('reference',async () => setReference((await api.managedReportPlaceholders()).rows));
  return <section className="word-layout" aria-labelledby="word-layout-title">
    <h3 id="word-layout-title" className="u-999b629">Word layout (optional)</h3>
    <p className="text-muted text-sm">{template.has_word_template
      ? <><FileText size={13} aria-hidden="true" /> Word and PDF reports use <strong>{template.word_template_name}</strong>{template.word_template_uploaded_at ? `, uploaded ${template.word_template_uploaded_at.slice(0,10)}` : ''}; the PDF is the same document saved as PDF.</>
      : 'Word and PDF reports use the wording above in the built-in layout. Upload your own .docx to use your own design for both.'}</p>
    {problem && <div className="error-msg word-layout-error" role="alert">{problem.message}{problem.details.length > 0 && <ul className="word-layout-problems">{problem.details.map(item => <li key={item}>{item}</li>)}</ul>}</div>}
    {note && <div className="alert alert-success">{note}</div>}
    <div className="flex gap-8 flex-wrap">
      <label className={`btn btn-ghost btn-sm${busy ? ' disabled' : ''}`}><Upload size={13} aria-hidden="true" /> {busy==='upload' ? 'Checking…' : template.has_word_template ? 'Replace Word template' : 'Upload Word template'}
        <input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden disabled={!!busy}
          onChange={event => { const file=event.target.files?.[0];event.target.value='';if (file) upload(file); }} /></label>
      {template.has_word_template && <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => run('download',async () => saveBlob(await api.downloadManagedReportWordTemplate(template.id),template.word_template_name || 'template.docx'))}><Download size={13} aria-hidden="true" /> Download current</button>}
      {template.has_word_template && <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => run('remove',async () => { onChanged(await api.removeManagedReportWordTemplate(template.id));setNote('Reports use the built-in layout again.'); })}><Trash2 size={13} aria-hidden="true" /> Use built-in layout</button>}
      <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => run('starter',async () => saveBlob(await api.managedReportStarterTemplate(),'customer-report-template.docx'))}><Download size={13} aria-hidden="true" /> Starter template</button>
    </div>
    <details className="word-layout-reference" onToggle={event => { if (event.target.open && !reference) showReference(); }}>
      <summary>Placeholders you can use in a Word template</summary>
      <p className="text-muted text-sm">Type a placeholder in curly braces, e.g. <code>{'{customer_name}'}</code>. To repeat a table row for each item, put <code>{'{#changes}'}</code> in its first cell and <code>{'{/changes}'}</code> in its last.</p>
      {reference && <table className="word-layout-table"><thead><tr><th>Placeholder</th><th>What it contains</th></tr></thead><tbody>{reference.map(row => <tr key={row.tag}>
        <td><code>{row.kind === 'list' ? `{#${row.tag}}…{/${row.tag}}` : `{${row.tag}}`}</code></td>
        <td>{row.description}{row.fields && <div className="text-muted text-sm">Inside: {row.fields.map(field => <code key={field.field} title={field.description}>{`{${field.field}}`}</code>).reduce((all,item) => [...all,' ',item],[])}</div>}</td>
      </tr>)}</tbody></table>}
    </details>
  </section>;
}

function Field({ label,hint,children }) {
  return <div className="form-group"><label>{label}{children}</label>{hint && <p className="text-muted text-sm rtw-hint">{hint}</p>}</div>;
}

function LabelGrid({ names,values,defaults,onChange,long=false }) {
  return <div className="rtw-grid">{Object.entries(names).map(([key,label]) => <Field key={key} label={label}>
    {long ? <textarea rows={2} maxLength={300} value={values[key] || ''} placeholder={defaults[key]} onChange={event => onChange(key,event.target.value)} />
      : <input maxLength={80} value={values[key] || ''} placeholder={defaults[key]} onChange={event => onChange(key,event.target.value)} />}
  </Field>)}</div>;
}

export function ManagedReportTemplatesTab() {
  const [defaults,setDefaults]=useState(null),[form,setForm]=useState(empty),[selected,setSelected]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const load=async () => { const result=await api.managedReportTemplates();setDefaults(result.wording_defaults || null);return result; };
  // The company template (the first created); none yet means the first save creates it.
  const companyOf=result => (result.rows || []).find(row => row.id === result.company_template_id) || null;
  const edit=(row,wordingDefaults=defaults) => { setSelected(row.id);setForm({ ...row,wording:effective(row.wording,wordingDefaults) });setError('');setMessage(''); };
  useEffect(() => { load().then(result => { const company=companyOf(result);if (company) edit(company,result.wording_defaults); else { setSelected(null);setForm({ ...empty,wording:effective({},result.wording_defaults) }); } }).catch(failure => setError(failure.message)); },[]);
  const w=form.wording || {};
  const setWording=(key,value) => setForm(current => ({ ...current,wording:{ ...current.wording,[key]:value } }));
  const setIn=group => (key,value) => setForm(current => ({ ...current,wording:{ ...current.wording,[group]:{ ...current.wording[group],[key]:value } } }));
  const toggleSection=key => setWording('sections',(w.sections || []).includes(key) ? w.sections.filter(value => value!==key) : [...(w.sections || []),key]);
  async function save() {
    setBusy(true);setError('');setMessage('');
    try {
      const payload=Object.fromEntries(EDITABLE.filter(key => key in form).map(key => [key,form[key]]));
      const saved=selected ? await api.updateManagedReportTemplate(selected,payload) : await api.createManagedReportTemplate(payload);
      await load();edit(saved);setMessage('Saved. New customer reports use this wording.');
    } catch(failure) { setError(failure.message); } finally { setBusy(false); }
  }
  const placeholders='You can use {customer}, {from}, {to} and {team}.';

  return <section className="card rtw" aria-label="Report template">
      {error && <div className="error-msg" role="alert">{error}</div>}{message && <div className="alert alert-success">{message}</div>}

      <div className="rtw-row">
        <div className="rtw-grow"><Field label="Report title" hint="On the cover, e.g. Monthly service report."><input maxLength={120} value={w.title || ''} onChange={event => setWording('title',event.target.value)} /></Field></div>
        <label className="rtw-color">Colour <input type="color" value={w.color || '#1f3a5f'} onChange={event => setWording('color',event.target.value)} aria-label="Report colour" /></label>
      </div>

      <h3 className="u-999b629">Sections ticked by default</h3>
      <div className="rtw-checks">{Object.entries(SECTION_LABELS).map(([key,label]) => <label key={key}><input type="checkbox" checked={(w.sections || []).includes(key)} onChange={() => toggleSection(key)} /> {label}</label>)}</div>

      <h3 className="u-999b629">Opening and closing</h3>
      <Field label="Opening paragraph" hint={`After the figures. ${placeholders}`}><textarea rows={3} maxLength={5000} value={w.intro || ''} onChange={event => setWording('intro',event.target.value)} placeholder="e.g. Dear {customer}, this report summarises the work our team delivered from {from} to {to}." /></Field>
      <label className="rtw-inline"><input type="checkbox" checked={w.show_overview !== false} onChange={event => setWording('show_overview',event.target.checked)} /> Add the automatic overview sentence (“In this period our team carried out …”)</label>
      <Field label="Closing paragraph" hint={`At the end of the report. ${placeholders}`}><textarea rows={3} maxLength={5000} value={w.closing || ''} onChange={event => setWording('closing',event.target.value)} placeholder="e.g. If you have any questions about this report, contact your service manager." /></Field>
      <Field label="Footer" hint={`On every page, before the page number. ${placeholders}`}><input maxLength={200} value={w.footer || ''} onChange={event => setWording('footer',event.target.value)} /></Field>

      <h3 className="u-999b629">Starting text in the report form</h3>
      <div className="rtw-grid">
        <Field label="Summary" hint="Filled in for the person making the report; they can change it."><textarea rows={3} maxLength={5000} value={w.default_summary || ''} onChange={event => setWording('default_summary',event.target.value)} /></Field>
        <Field label="Coming next"><textarea rows={3} maxLength={5000} value={w.default_coming_next || ''} onChange={event => setWording('default_coming_next',event.target.value)} /></Field>
      </div>

      {defaults && <>
        <details className="rtw-more"><summary>Section headings</summary><LabelGrid names={HEADING_LABELS} values={w.headings || {}} defaults={defaults.headings} onChange={setIn('headings')} /></details>
        <details className="rtw-more"><summary>Figure labels</summary><LabelGrid names={FIGURE_LABELS} values={w.figures || {}} defaults={defaults.figures} onChange={setIn('figures')} /></details>
        <details className="rtw-more"><summary>Messages when a section has nothing to show</summary><LabelGrid names={EMPTY_LABELS} values={w.empty || {}} defaults={defaults.empty} onChange={setIn('empty')} long /></details>
      </>}

      <div className="flex gap-8 flex-wrap u-1b0f499">
        <button className="btn btn-primary" disabled={busy} onClick={save}><Save size={14} /> Save template</button>
        <button className="btn btn-ghost" disabled={busy || !defaults} onClick={() => setForm(current => ({ ...current,wording:effective({},defaults) }))}><RotateCcw size={14} /> Built-in wording</button>
      </div>
      {selected ? <WordLayout template={form} onChanged={saved => setForm(current => ({ ...current,has_word_template:saved.has_word_template,word_template_name:saved.word_template_name,word_template_uploaded_at:saved.word_template_uploaded_at }))} />
        : <p className="text-muted text-sm">Save the template first, then you can attach a Word layout to it.</p>}
    </section>;
}
