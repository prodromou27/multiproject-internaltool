import { useEffect,useState } from 'react';
import { Plus,Save,Trash2 } from 'lucide-react';
import { api } from '../../api';

const STATUSES=['New','Open','In Progress','Pending','Resolved','Closed','Rejected','Excluded'];
const PRIORITIES=['Low','Normal','High','Critical'];

export default function TicketMappingConfiguration() {
  const [config,setConfig]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  useEffect(() => { const controller=new AbortController();api.ticketMappings({ signal:controller.signal }).then(setConfig).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });return () => controller.abort(); },[]);
  const update=(type,index,key,value) => setConfig(current => ({ ...current,[type]:current[type].map((item,itemIndex) => itemIndex===index ? { ...item,[key]:value } : item) }));
  const remove=(type,index) => setConfig(current => ({ ...current,[type]:current[type].filter((_,itemIndex) => itemIndex!==index) }));
  const add=type => setConfig(current => ({ ...current,[type]:[...current[type],type==='statuses' ? { external:'',normalized:'Open',group:'open' } : { external:'',normalized:'Normal' }] }));
  async function save() { setBusy(true);setError('');setMessage('');try { const result=await api.saveTicketMappings(config);setConfig({ statuses:result.statuses,priorities:result.priorities });setMessage(`Mappings saved; ${result.reclassified} stored ticket(s) reclassified.`); } catch(failure) { setError(failure.message); } finally { setBusy(false); } }
  if (!config) return <p className="text-muted text-sm">{error || 'Loading ticket mappings...'}</p>;
  return <div className="u-0519f7a">
    <div className="u-87c136d"><h3 className="u-de00808">Ticket normalization</h3><p className="text-muted text-sm">Map RT lifecycle values to stable dashboard and report categories. Saving immediately reclassifies stored tickets.</p></div>
    {error && <div className="error-msg mb-12" role="alert">{error}</div>}{message && <div className="alert alert-success mb-12" role="status">{message}</div>}
    <div className="table-wrap u-905d8b3"><table><thead><tr><th>RT status</th><th>Normalized status</th><th>Group</th><th /></tr></thead><tbody>{config.statuses.map((item,index) => <tr key={`${item.external}-${index}`}><td><input value={item.external} onChange={event => update('statuses',index,'external',event.target.value)} placeholder="custom status" /></td><td><select value={item.normalized} onChange={event => update('statuses',index,'normalized',event.target.value)}>{STATUSES.map(value => <option key={value}>{value}</option>)}</select></td><td><select value={item.group} onChange={event => update('statuses',index,'group',event.target.value)}><option value="open">Open</option><option value="closed">Closed</option></select></td><td><button type="button" className="btn btn-sm btn-danger" onClick={() => remove('statuses',index)} aria-label={`Remove ${item.external || 'status'} mapping`}><Trash2 size={13} /></button></td></tr>)}</tbody></table></div>
    <button type="button" className="btn btn-ghost btn-sm" onClick={() => add('statuses')}><Plus size={13} /> Add status mapping</button>
    <div className="table-wrap u-bf720c4"><table><thead><tr><th>RT priority</th><th>Normalized priority</th><th /></tr></thead><tbody>{config.priorities.map((item,index) => <tr key={`${item.external}-${index}`}><td><input value={item.external} onChange={event => update('priorities',index,'external',event.target.value)} placeholder="custom priority" /></td><td><select value={item.normalized} onChange={event => update('priorities',index,'normalized',event.target.value)}>{PRIORITIES.map(value => <option key={value}>{value}</option>)}</select></td><td><button type="button" className="btn btn-sm btn-danger" onClick={() => remove('priorities',index)} aria-label={`Remove ${item.external || 'priority'} mapping`}><Trash2 size={13} /></button></td></tr>)}</tbody></table></div>
    <div className="flex gap-8"><button type="button" className="btn btn-ghost btn-sm" onClick={() => add('priorities')}><Plus size={13} /> Add priority mapping</button><button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={save}><Save size={13} /> {busy ? 'Saving...' : 'Save mappings'}</button></div>
  </div>;
}
