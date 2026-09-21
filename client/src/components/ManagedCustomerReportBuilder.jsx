import { useEffect,useState } from 'react';
import { Download,FileText,RefreshCw } from 'lucide-react';
import { api } from '../api';

const SECTIONS=[['executive_summary','Executive summary'],['service_overview','Service overview'],['ticket_summary','Ticket summary'],['open_tickets','Open tickets'],['period_tickets','Period tickets'],['service_activities','Service activities'],['tasks','Tasks'],['projects','Projects'],['maintenance_visits','Maintenance Visits'],['recommendations','Recommendations'],['risks','Risks and concerns'],['upcoming_work','Upcoming work'],['management_notes','Management notes']];
const NARRATIVES=[['executive_summary','Executive summary'],['key_highlights','Key highlights'],['risks_concerns','Risks / concerns'],['major_changes','Major changes'],['upcoming_activities','Upcoming activities'],['management_notes','Management notes']];
const Metric=({ label,value }) => <div className="card" style={{ padding:14 }}><div className="text-muted text-sm">{label}</div><strong style={{ display:'block',fontSize:22,marginTop:3 }}>{value ?? 0}</strong></div>;

export default function ManagedCustomerReportBuilder({ customerId,range }) {
  const [sections,setSections]=useState(SECTIONS.map(([key]) => key));
  const [narratives,setNarratives]=useState({});
  const [templates,setTemplates]=useState([]);
  const [templateId,setTemplateId]=useState('');
  const [status,setStatus]=useState('draft');
  const [history,setHistory]=useState([]);
  const [preview,setPreview]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  useEffect(() => {
    const controller=new AbortController();
    Promise.all([api.managedReportTemplates({ signal:controller.signal }),api.managedCustomerConfiguration(customerId,{ signal:controller.signal })]).then(([result,configuration]) => {
      if (controller.signal.aborted) return;
      const active=(result.rows || []).filter(template => template.active);setTemplates(active);
      const selected=active.find(template => template.id===configuration.default_report_template_id);
      if (selected) { setTemplateId(String(selected.id));setSections(selected.sections);setNarratives(selected.default_narratives || {}); }
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  },[customerId]);
  useEffect(() => {
    const controller=new AbortController();
    api.managedCustomerReportHistory(customerId,{ signal:controller.signal }).then(result => { if (!controller.signal.aborted) setHistory(result.rows || []); }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  },[customerId]);
  useEffect(() => { setPreview(null);setError(''); },[customerId,range]);

  const toggle=key => setSections(current => current.includes(key) ? current.filter(value => value!==key) : [...current,key]);
  const chooseTemplate=value => { setTemplateId(value);const template=templates.find(item => String(item.id)===value);if (template) { setSections(template.sections);setNarratives(template.default_narratives || {});setPreview(null); } };
  const request=() => ({ ...range,sections,narratives,status,template_id:templateId ? Number(templateId) : null });
  function saveBlob(blob,filename) { const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(() => URL.revokeObjectURL(url),1000); }
  async function prepare() {
    if (!range.from || !range.to) return setError('Select both custom dates before preparing a report.');
    setBusy(true);setError('');
    try { setPreview(await api.managedCustomerReportPreview(customerId,request())); } catch(failure) { setError(failure.message); } finally { setBusy(false); }
  }
  async function downloadReport(format) {
    setBusy(true);setError('');
    try {
      const exporters={ docx:api.managedCustomerWordReport,xlsx:api.managedCustomerExcelReport,pdf:api.managedCustomerPdfReport };
      const blob=await exporters[format](customerId,request());
      saveBlob(blob,`managed_services_report_${range.from}_${range.to}.${format}`);
      const result=await api.managedCustomerReportHistory(customerId);setHistory(result.rows || []);
    } catch(failure) { setError(failure.message); } finally { setBusy(false); }
  }
  async function downloadArchived(report) {
    setBusy(true);setError('');
    try { saveBlob(await api.managedCustomerArchivedReport(customerId,report.id),report.original_name); } catch(failure) { setError(failure.message); } finally { setBusy(false); }
  }

  return <div style={{ display:'grid',gap:18 }}>
    <section className="card"><div style={{ display:'flex',justifyContent:'space-between',gap:12,alignItems:'start',marginBottom:16 }}><div><h2 style={{ fontSize:16 }}>Managed Services report</h2><p className="text-muted text-sm mt-4">Choose customer-facing content for {range.from || 'the start date'} to {range.to || 'the end date'}, then review the calculated report data.</p></div><FileText size={20} color="var(--primary)" /></div>
      {error && <div className="error-msg" role="alert" style={{ marginBottom:14 }}>{error}</div>}
      <div className="form-group" style={{ maxWidth:420 }}><label htmlFor="managed-report-template">Report template</label><select id="managed-report-template" value={templateId} onChange={event => chooseTemplate(event.target.value)}><option value="">Custom selection</option>{templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></div>
      <div className="form-group" style={{ maxWidth:240 }}><label htmlFor="managed-report-status">Report status</label><select id="managed-report-status" value={status} onChange={event => setStatus(event.target.value)}><option value="draft">Draft</option><option value="final">Final</option></select><small className="text-muted">Saved with every generated file for audit and retrieval.</small></div>
      <fieldset style={{ border:0,padding:0,margin:'0 0 18px' }}><legend style={{ fontWeight:700,fontSize:14,marginBottom:10 }}>Included sections</legend><div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:8 }}>{SECTIONS.map(([key,label]) => <label key={key} style={{ display:'flex',gap:8,alignItems:'center',fontSize:13 }}><input type="checkbox" checked={sections.includes(key)} onChange={() => toggle(key)} />{label}</label>)}</div></fieldset>
      <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:12 }}>{NARRATIVES.map(([key,label]) => <div className="form-group" key={key}><label htmlFor={`report-${key}`}>{label}</label><textarea id={`report-${key}`} rows={4} maxLength={10000} value={narratives[key] || ''} onChange={event => setNarratives(current => ({ ...current,[key]:event.target.value }))} placeholder={`Add ${label.toLowerCase()} for this report...`} /></div>)}</div>
      <div className="flex gap-8" style={{ flexWrap:'wrap' }}><button type="button" className="btn btn-primary" disabled={busy || !sections.length} onClick={prepare}>{busy ? 'Working...' : preview ? <><RefreshCw size={14} /> Refresh Preview</> : <><FileText size={14} /> Prepare Preview</>}</button>{preview && <><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => downloadReport('docx')}><Download size={14} /> Generate Word</button><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => downloadReport('xlsx')}><Download size={14} /> Export Excel</button><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => downloadReport('pdf')}><Download size={14} /> Generate PDF</button></>}</div>
    </section>
    {preview && <section><div style={{ display:'flex',justifyContent:'space-between',gap:12,alignItems:'end',marginBottom:10 }}><div><h2 style={{ fontSize:16 }}>Report preview</h2><p className="text-muted text-sm mt-4">{preview.customer.name} {' · '} {preview.period.from} to {preview.period.to}</p></div><span className="badge badge-done">Ready</span></div>
      <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10,marginBottom:16 }}><Metric label="Open tickets now" value={preview.overview.tickets?.open_now ?? 'Excluded'} /><Metric label="Tickets created" value={preview.overview.tickets?.created_period ?? 'Excluded'} /><Metric label="Service activities" value={preview.overview.activities.activities} /><Metric label="Service hours" value={preview.overview.activities.hours} /><Metric label="Open tasks" value={preview.overview.tasks.open_now} /><Metric label="Active projects" value={preview.overview.projects.active_now} /><Metric label="Maintenance Visits" value={preview.overview.visits.visits_period} /><Metric label="Open recommendations" value={preview.overview.recommendations.open_now} /></div>
      <div className="card table-wrap"><table><thead><tr><th>Detail section</th><th>Available records</th><th>Included in preview</th><th>Coverage</th></tr></thead><tbody>{[['Open tickets',preview.tickets.open,preview.truncation.open_tickets],['Period tickets',preview.tickets.period,preview.truncation.period_tickets],['Service activities',preview.activities,preview.truncation.activities],['Tasks',preview.tasks,preview.truncation.tasks],['Projects',preview.projects,preview.truncation.projects],['Recommendations',preview.recommendations,preview.truncation.recommendations]].map(([label,data,truncated]) => <tr key={label}><td>{label}</td><td>{data.total ?? data.summary?.total ?? 0}</td><td>{data.rows?.length || 0}</td><td>{truncated ? 'First 100 shown' : 'Complete'}</td></tr>)}</tbody></table></div>
    </section>}
    <section><div style={{ marginBottom:10 }}><h2 style={{ fontSize:16 }}>Report history</h2><p className="text-muted text-sm mt-4">The latest 100 generated files are retained as immutable versions.</p></div>
      <div className="card table-wrap"><table><thead><tr><th>Generated</th><th>Period</th><th>Format</th><th>Version</th><th>Status</th><th>Template</th><th>Generated by</th><th></th></tr></thead><tbody>{history.length ? history.map(report => <tr key={report.id}><td>{report.generated_at}</td><td>{report.period_start} to {report.period_end}</td><td>{report.output_format.toUpperCase()}</td><td>v{report.report_version}</td><td><span className={`badge ${report.status==='final'?'badge-done':'badge-progress'}`}>{report.status}</span></td><td>{report.template_name || 'Custom'}</td><td>{report.generated_by_name || 'Former user'}</td><td><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => downloadArchived(report)}><Download size={13} /> Download</button></td></tr>) : <tr><td colSpan="8" className="text-muted">No reports have been generated yet.</td></tr>}</tbody></table></div>
    </section>
  </div>;
}
