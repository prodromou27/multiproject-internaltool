import { useEffect,useState } from 'react';
import { CheckCircle2,Loader2,RefreshCw,Save,Ticket } from 'lucide-react';
import { api } from '../../api';
import { Toggle } from './shared';
import TicketMappingConfiguration from './TicketMappingConfiguration';

const EMPTY={ enabled:false,base_url:'',api_token:'',api_token_set:false,sync_interval_minutes:60 };

export default function RequestTrackerIntegration({ sectionStyle,labelStyle }) {
  const [form,setForm]=useState(EMPTY),[loading,setLoading]=useState(true),[busy,setBusy]=useState(''),[message,setMessage]=useState(''),[error,setError]=useState(''),[queues,setQueues]=useState([]);
  const load=async () => { setLoading(true);setError('');try { setForm({ ...EMPTY,...await api.ticketingSettings() }); } catch(failure) { setError(failure.message); } finally { setLoading(false); } };
  useEffect(() => { load(); },[]);
  const set=(key,value) => setForm(current => ({ ...current,[key]:value,...(key==='api_token' ? { clear_api_token:false } : {}) }));
  async function save() {
    setBusy('save');setError('');setMessage('');
    try { const saved=await api.saveTicketingSettings(form);setForm({ ...EMPTY,...saved });setMessage('Request Tracker settings saved.'); }
    catch(failure) { setError(failure.message); } finally { setBusy(''); }
  }
  async function test() {
    setBusy('test');setError('');setMessage('');
    try { const result=await api.testTicketingConnection();setMessage(result.message); }
    catch(failure) { setError(failure.message); } finally { setBusy(''); }
  }
  async function discover() {
    setBusy('queues');setError('');setMessage('');
    try { const result=await api.ticketingQueues();setQueues(result.rows || []);setMessage(`${result.rows?.length || 0} RT queue(s) discovered.`); }
    catch(failure) { setError(failure.message); } finally { setBusy(''); }
  }
  if (loading) return <div style={sectionStyle}><p role="status" className="text-muted">Loading Request Tracker settings...</p></div>;
  return <div style={sectionStyle}>
    <div style={{ display:'flex',alignItems:'center',gap:14,marginBottom:16 }}>
      <div style={{ width:40,height:40,borderRadius:8,background:'var(--primary-light)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--primary)' }}><Ticket size={21} /></div>
      <div style={{ flex:1 }}><div style={{ fontWeight:700,fontSize:15 }}>Request Tracker</div><div className="text-muted text-sm">REST 2.0 ticket and queue integration for Managed Customers</div></div>
      <Toggle checked={form.enabled} onChange={value => set('enabled',value)} label={form.enabled ? 'Enabled' : 'Disabled'} />
    </div>
    {error && <div className="error-msg" role="alert" style={{ marginBottom:12 }}>{error}</div>}
    {message && <div className="alert alert-success" role="status" style={{ marginBottom:12,display:'flex',gap:6,alignItems:'center' }}><CheckCircle2 size={14} />{message}</div>}
    <div className="form-group"><label style={labelStyle} htmlFor="rt-base-url">RT Base URL</label><input id="rt-base-url" type="url" value={form.base_url} onChange={event => set('base_url',event.target.value)} placeholder="https://rt.example.com" /></div>
    <div className="form-group"><label style={labelStyle} htmlFor="rt-api-token">REST 2.0 API Token</label><input id="rt-api-token" type="password" autoComplete="new-password" value={form.api_token} onChange={event => set('api_token',event.target.value)} placeholder={form.api_token_set ? 'Leave blank to retain stored token' : 'Paste an RT authentication token'} />
      {form.api_token_set && <p className="text-muted text-sm">{form.clear_api_token ? 'Stored token will be removed when saved.' : 'A token is configured and will never be displayed.'} <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm(current => ({ ...current,api_token:'',clear_api_token:!current.clear_api_token }))}>{form.clear_api_token ? 'Keep stored token' : 'Remove stored token'}</button></p>}
    </div>
    <div className="form-group"><label style={labelStyle} htmlFor="rt-sync-interval">Sync Interval</label><select id="rt-sync-interval" value={form.sync_interval_minutes} onChange={event => set('sync_interval_minutes',Number(event.target.value))}><option value={30}>Every 30 minutes</option><option value={60}>Every hour</option><option value={120}>Every 2 hours</option><option value={240}>Every 4 hours</option><option value={1440}>Daily</option></select></div>
    <div className="flex gap-8" style={{ flexWrap:'wrap',marginTop:14 }}>
      <button type="button" className="btn btn-primary" disabled={!!busy} onClick={save}>{busy==='save' ? <><Loader2 size={14} style={{ animation:'spin 1s linear infinite' }} /> Saving...</> : <><Save size={14} /> Save RT Settings</>}</button>
      <button type="button" className="btn btn-ghost" disabled={!!busy || !form.api_token_set || !form.base_url} onClick={test}>{busy==='test' ? 'Testing...' : 'Test Connection'}</button>
      <button type="button" className="btn btn-ghost" disabled={!!busy || !form.api_token_set || !form.base_url} onClick={discover}>{busy==='queues' ? 'Loading...' : <><RefreshCw size={14} /> Discover Queues</>}</button>
    </div>
    {!!queues.length && <div className="table-wrap" style={{ marginTop:16,maxHeight:320,overflowY:'auto' }}><table><thead><tr><th>Queue ID</th><th>Name</th><th>Description</th></tr></thead><tbody>{queues.map(queue => <tr key={queue.id}><td>{queue.id}</td><td>{queue.name}</td><td className="text-muted">{queue.description || 'No description'}</td></tr>)}</tbody></table></div>}
    <TicketMappingConfiguration />
    <p className="text-muted text-sm" style={{ marginTop:12 }}>Use a dedicated least-privilege RT token. Private-network RT URLs require the server setting ALLOW_PRIVATE_TICKETING_URLS=true.</p>
  </div>;
}
