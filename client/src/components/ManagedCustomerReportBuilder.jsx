import { useEffect,useState } from 'react';
import { Download,FileText,RefreshCw } from 'lucide-react';
import { api } from '../api';

const SECTIONS=[['executive_summary','Executive summary'],['service_overview','Service overview'],['ticket_summary','Ticket summary'],['open_tickets','Open tickets'],['period_tickets','Period tickets'],['service_activities','Service activities'],['tasks','Tasks'],['projects','Projects'],['maintenance_visits','Maintenance Visits'],['recommendations','Recommendations'],['risks','Risks and concerns'],['upcoming_work','Upcoming work'],['management_notes','Management notes']];
const NARRATIVES=[['executive_summary','Executive summary'],['key_highlights','Key highlights'],['risks_concerns','Risks / concerns'],['major_changes','Major changes'],['upcoming_activities','Upcoming activities'],['management_notes','Management notes']];
const Metric=({ label,value }) => <div className="card" style={{ padding:14 }}><div className="text-muted text-sm">{label}</div><strong style={{ display:'block',fontSize:22,marginTop:3 }}>{value ?? 0}</strong></div>;

export default function ManagedCustomerReportBuilder({ customerId,range }) {
  const [sections,setSections]=useState(SECTIONS.map(([key]) => key)),[narratives,setNarratives]=useState({}),[preview,setPreview]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(() => { setPreview(null);setError(''); },[customerId,range]);
  const toggle=key => setSections(current => current.includes(key) ? current.filter(value => value!==key) : [...current,key]);
  const request=() => ({ ...range,sections,narratives });
  async function prepare() {
    if (!range.from || !range.to) return setError('Select both custom dates before preparing a report.');
    setBusy(true);setError('');
    try { setPreview(await api.managedCustomerReportPreview(customerId,request())); }
    catch(failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  async function downloadWord() {
    setBusy(true);setError('');
    try { const blob=await api.managedCustomerWordReport(customerId,request()),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`managed_services_report_${range.from}_${range.to}.docx`;link.click();setTimeout(() => URL.revokeObjectURL(url),1000); }
    catch(failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <div style={{ display:'grid',gap:18 }}>
    <section className="card"><div style={{ display:'flex',justifyContent:'space-between',gap:12,alignItems:'start',marginBottom:16 }}><div><h2 style={{ fontSize:16 }}>Managed Services report</h2><p className="text-muted text-sm mt-4">Choose customer-facing content for {range.from || 'the start date'} to {range.to || 'the end date'}, then review the calculated report data.</p></div><FileText size={20} color="var(--primary)" /></div>
      {error && <div className="error-msg" role="alert" style={{ marginBottom:14 }}>{error}</div>}
      <fieldset style={{ border:0,padding:0,margin:'0 0 18px' }}><legend style={{ fontWeight:700,fontSize:14,marginBottom:10 }}>Included sections</legend><div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:8 }}>{SECTIONS.map(([key,label]) => <label key={key} style={{ display:'flex',gap:8,alignItems:'center',fontSize:13 }}><input type="checkbox" checked={sections.includes(key)} onChange={() => toggle(key)} />{label}</label>)}</div></fieldset>
      <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:12 }}>{NARRATIVES.map(([key,label]) => <div className="form-group" key={key}><label htmlFor={`report-${key}`}>{label}</label><textarea id={`report-${key}`} rows={4} maxLength={10000} value={narratives[key] || ''} onChange={event => setNarratives(current => ({ ...current,[key]:event.target.value }))} placeholder={`Add ${label.toLowerCase()} for this report...`} /></div>)}</div>
      <div className="flex gap-8" style={{ flexWrap:'wrap' }}><button type="button" className="btn btn-primary" disabled={busy || !sections.length} onClick={prepare}>{busy ? 'Working...' : preview ? <><RefreshCw size={14} /> Refresh Preview</> : <><FileText size={14} /> Prepare Preview</>}</button>{preview && <button type="button" className="btn btn-ghost" disabled={busy} onClick={downloadWord}><Download size={14} /> Generate Word</button>}</div>
    </section>
    {preview && <section><div style={{ display:'flex',justifyContent:'space-between',gap:12,alignItems:'end',marginBottom:10 }}><div><h2 style={{ fontSize:16 }}>Report preview</h2><p className="text-muted text-sm mt-4">{preview.customer.name} · {preview.period.from} to {preview.period.to}</p></div><span className="badge badge-done">Ready</span></div>
      <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10,marginBottom:16 }}><Metric label="Open tickets now" value={preview.overview.tickets?.open_now ?? 'Excluded'} /><Metric label="Tickets created" value={preview.overview.tickets?.created_period ?? 'Excluded'} /><Metric label="Service activities" value={preview.overview.activities.activities} /><Metric label="Service hours" value={preview.overview.activities.hours} /><Metric label="Open tasks" value={preview.overview.tasks.open_now} /><Metric label="Active projects" value={preview.overview.projects.active_now} /><Metric label="Maintenance Visits" value={preview.overview.visits.visits_period} /><Metric label="Open recommendations" value={preview.overview.recommendations.open_now} /></div>
      <div className="card table-wrap"><table><thead><tr><th>Detail section</th><th>Available records</th><th>Included in preview</th><th>Coverage</th></tr></thead><tbody>{[['Open tickets',preview.tickets.open,preview.truncation.open_tickets],['Period tickets',preview.tickets.period,preview.truncation.period_tickets],['Service activities',preview.activities,preview.truncation.activities],['Tasks',preview.tasks,preview.truncation.tasks],['Projects',preview.projects,preview.truncation.projects],['Recommendations',preview.recommendations,preview.truncation.recommendations]].map(([label,data,truncated]) => <tr key={label}><td>{label}</td><td>{data.total ?? data.summary?.total ?? 0}</td><td>{data.rows?.length || 0}</td><td>{truncated ? 'First 100 shown' : 'Complete'}</td></tr>)}</tbody></table></div>
    </section>}
  </div>;
}
