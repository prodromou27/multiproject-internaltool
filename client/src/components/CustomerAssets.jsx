import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardCheck, Paperclip, Pencil, Trash2 } from 'lucide-react';
import { api } from '../api';
import { fmtDate, Modal } from './Shared';
import { useConfirm } from './Confirm';
import { useLatestRequest } from '../hooks/useLatestRequest';
import { useToast } from './Toast';
import SoftwareStatusBadge from './SoftwareStatusBadge';
import ImportModal from './ImportModal';
import { useLiveRefresh } from '../live';
import { DataTable, Pagination, ToneBadge } from './EnterpriseUI';
import CustomerTaskForm from './CustomerTaskForm';
import './CustomerAssets.css';

const COVERAGE=['managed','support','neither'];
const STATUSES=['active','spare','retired','decommissioned'];
const ENVIRONMENTS=['production','test','development','dr','other'];
const CRITICALITY=['low','medium','high','critical'];
const label=value => value.replaceAll('_',' ').replace(/^./,letter => letter.toUpperCase());
const empty={ name:'',asset_tag:'',asset_type:'',technology_id:'',vendor:'',model:'',serial_number:'',hostname:'',ip_address:'',mac_address:'',software_version:'',location:'',environment:'production',criticality:'medium',lifecycle_status:'active',coverage_type:'neither',support_provider:'',support_reference:'',support_start_date:'',support_end_date:'',warranty_expiry_date:'',management_url:'',notes:'' };

function AssetForm({ customerId,initial,technologies,onClose,onSaved }) {
  const [form,setForm]=useState(initial || empty);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const inFlight=useRef(false);
  const set=key => event => setForm(value => ({ ...value,[key]:event.target.value }));
  async function submit(event) {
    event.preventDefault(); if (inFlight.current) return;
    inFlight.current=true; setSaving(true); setError('');
    try { initial ? await api.updateCustomerAsset(customerId,initial.id,form) : await api.createCustomerAsset(customerId,form); onSaved(); onClose(); }
    catch (failure) { setError(failure.message); }
    finally { inFlight.current=false; setSaving(false); }
  }
  return <Modal title={initial ? 'Edit customer asset' : 'Add customer asset'} onClose={saving ? () => {} : onClose} wide>
    <form onSubmit={submit}>
      {error && <div className="error-msg" role="alert">{error}</div>}
      <fieldset disabled={saving} className="border-0 p-0 m-0">
        <div className="form-row"><div className="form-group"><label htmlFor="asset-name">Asset name</label><input id="asset-name" autoFocus required maxLength={300} value={form.name} onChange={set('name')} placeholder="Primary Check Point gateway" /></div><div className="form-group"><label htmlFor="asset-tag">Asset tag</label><input id="asset-tag" maxLength={500} value={form.asset_tag || ''} onChange={set('asset_tag')} /></div></div>
        <div className="form-row"><div className="form-group"><label htmlFor="asset-type">Asset type</label><input id="asset-type" required maxLength={100} value={form.asset_type} onChange={set('asset_type')} placeholder="Security gateway, server, switch..." /></div><div className="form-group"><label htmlFor="asset-technology">Technology</label><select id="asset-technology" value={form.technology_id || ''} onChange={set('technology_id')}><option value="">Not linked</option>{initial?.technology_id && !technologies.some(row => row.id===Number(initial.technology_id)) && <option value={initial.technology_id}>{initial.technology_name || 'Previous technology'} (inactive)</option>}{technologies.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></div></div>
        <div className="form-row"><div className="form-group"><label htmlFor="asset-coverage">Service coverage</label><select id="asset-coverage" value={form.coverage_type} onChange={set('coverage_type')}>{COVERAGE.map(value => <option key={value} value={value}>{value==='support' ? 'Under support' : label(value)}</option>)}</select></div><div className="form-group"><label htmlFor="asset-status">Lifecycle status</label><select id="asset-status" value={form.lifecycle_status} onChange={set('lifecycle_status')}>{STATUSES.map(value => <option key={value} value={value}>{label(value)}</option>)}</select></div></div>
        <div className="form-row"><div className="form-group"><label htmlFor="asset-vendor">Vendor</label><input id="asset-vendor" maxLength={500} value={form.vendor || ''} onChange={set('vendor')} placeholder="Check Point" /></div><div className="form-group"><label htmlFor="asset-model">Model</label><input id="asset-model" maxLength={500} value={form.model || ''} onChange={set('model')} /></div></div>
        <div className="form-row"><div className="form-group"><label htmlFor="asset-hostname">Hostname</label><input id="asset-hostname" maxLength={253} value={form.hostname || ''} onChange={set('hostname')} /></div><div className="form-group"><label htmlFor="asset-ip">IP address</label><input id="asset-ip" maxLength={500} value={form.ip_address || ''} onChange={set('ip_address')} placeholder="IPv4 or IPv6" /></div></div>
        <div className="form-row"><div className="form-group"><label htmlFor="asset-mac">MAC address</label><input id="asset-mac" maxLength={17} value={form.mac_address || ''} onChange={set('mac_address')} placeholder="00:11:22:33:44:55" /></div><div className="form-group"><label htmlFor="asset-serial">Serial number</label><input id="asset-serial" maxLength={500} value={form.serial_number || ''} onChange={set('serial_number')} /></div></div>
        <div className="form-row"><div className="form-group"><label htmlFor="asset-version">Software / firmware version</label><input id="asset-version" maxLength={500} value={form.software_version || ''} onChange={set('software_version')} /></div><div className="form-group"><label htmlFor="asset-location">Location</label><input id="asset-location" maxLength={500} value={form.location || ''} onChange={set('location')} /></div></div>
        <div className="form-row"><div className="form-group"><label htmlFor="asset-environment">Environment</label><select id="asset-environment" value={form.environment} onChange={set('environment')}>{ENVIRONMENTS.map(value => <option key={value} value={value}>{label(value)}</option>)}</select></div><div className="form-group"><label htmlFor="asset-criticality">Criticality</label><select id="asset-criticality" value={form.criticality} onChange={set('criticality')}>{CRITICALITY.map(value => <option key={value} value={value}>{label(value)}</option>)}</select></div></div>
        <h3 className="u-062cf76">Support and warranty</h3>
        <div className="form-row"><div className="form-group"><label htmlFor="asset-provider">Support provider</label><input id="asset-provider" maxLength={500} value={form.support_provider || ''} onChange={set('support_provider')} /></div><div className="form-group"><label htmlFor="asset-reference">Support reference</label><input id="asset-reference" maxLength={500} value={form.support_reference || ''} onChange={set('support_reference')} /></div></div>
        <div className="form-row"><div className="form-group"><label htmlFor="asset-support-start">Support start</label><input id="asset-support-start" type="date" min="1900-01-01" max="9998-12-31" value={form.support_start_date || ''} onChange={set('support_start_date')} /></div><div className="form-group"><label htmlFor="asset-support-end">Support end</label><input id="asset-support-end" type="date" min="1900-01-01" max="9998-12-31" value={form.support_end_date || ''} onChange={set('support_end_date')} /></div><div className="form-group"><label htmlFor="asset-warranty">Warranty expiry</label><input id="asset-warranty" type="date" min="1900-01-01" max="9998-12-31" value={form.warranty_expiry_date || ''} onChange={set('warranty_expiry_date')} /></div></div>
        <div className="form-group"><label htmlFor="asset-url">Management URL</label><input id="asset-url" type="url" maxLength={500} value={form.management_url || ''} onChange={set('management_url')} placeholder="https://gateway.example.local" /></div>
        <div className="form-group"><label htmlFor="asset-notes">Notes (do not store passwords or secrets)</label><textarea id="asset-notes" maxLength={10000} rows={3} value={form.notes || ''} onChange={set('notes')} /></div>
        <div className="modal-footer"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit">{saving ? 'Saving...' : 'Save asset'}</button></div>
      </fieldset>
    </form>
  </Modal>;
}

const fileSize=bytes => {
  const size=Number(bytes || 0);if (size<1024) return `${size} B`;if (size<1024*1024) return `${(size/1024).toFixed(1)} KB`;return `${(size/(1024*1024)).toFixed(1)} MB`;
};

function AssetFiles({ customerId,asset,onClose,onChanged }) {
  const toast=useToast(),confirm=useConfirm(),inputRef=useRef(null);
  const [files,setFiles]=useState([]),[loading,setLoading]=useState(true),[uploading,setUploading]=useState(false),[error,setError]=useState(''),[downloading,setDownloading]=useState(null);
  const load=useCallback(async () => {
    setLoading(true);setError('');
    try { setFiles(await api.customerAssetAttachments(customerId,asset.id)); }
    catch(failure) { setError(failure.message); }
    finally { setLoading(false); }
  },[customerId,asset.id]);
  useEffect(() => { load(); },[load]);
  useLiveRefresh(load);
  async function uploadFiles(selected) {
    if (!selected.length) return;setUploading(true);setError('');
    try { for (const file of selected) await api.uploadCustomerAssetAttachment(customerId,asset.id,file);toast.success(selected.length===1 ? 'File uploaded' : `${selected.length} files uploaded`);await load();onChanged(); }
    catch(failure) { setError(failure.message); }
    finally { setUploading(false);if (inputRef.current) inputRef.current.value=''; }
  }
  async function download(file) {
    setDownloading(file.id);setError('');
    try { const blob=await api.downloadCustomerAssetAttachment(customerId,asset.id,file.id),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=file.original_name;document.body.appendChild(link);link.click();link.remove();setTimeout(() => URL.revokeObjectURL(url),1000); }
    catch(failure) { setError(failure.message); }
    finally { setDownloading(null); }
  }
  async function remove(file) {
    if (!await confirm(`Remove ${file.original_name}?`,{ title:'Remove asset file?',label:'Remove' })) return;
    try { await api.deleteCustomerAssetAttachment(customerId,asset.id,file.id);toast.success('File removed');await load();onChanged(); }
    catch(failure) { setError(failure.message); }
  }
  return <Modal title={`Files for ${asset.name}`} onClose={uploading ? () => {} : onClose} wide>
    {error && <div className="error-msg" role="alert">{error}</div>}
    <p className="text-muted text-sm mb-12">Store diagrams, support documents, configuration exports, and warranty records. Do not upload passwords, private keys, or credentials.</p>
    <label className={["btn btn-primary u-3a8b923", (uploading ? 'u-276d10f' : 'u-3b6a3a6')].filter(Boolean).join(' ')}>
      {uploading ? 'Uploading...' : 'Upload files'}
      <input ref={inputRef} type="file" multiple hidden disabled={uploading} onChange={event => uploadFiles([...event.target.files])} />
    </label>
    <span className="text-muted text-sm u-78fa54e">Maximum 20 MB per file</span>
    {loading ? <p role="status">Loading files...</p> : !files.length ? <p className="text-muted">No files attached to this asset.</p> : <div className="table-wrap"><table><thead><tr><th>File</th><th>Size</th><th>Uploaded by</th><th>Date</th><th>Actions</th></tr></thead><tbody>{files.map(file => <tr key={file.id}><td>{file.original_name}</td><td>{fileSize(file.size)}</td><td>{file.uploaded_by_name}</td><td>{fmtDate(file.created_at)}</td><td><div className="flex gap-8"><button className="btn btn-ghost btn-sm" disabled={downloading===file.id} onClick={() => download(file)}>{downloading===file.id ? 'Preparing...' : 'Download'}</button><button className="btn btn-danger btn-sm" onClick={() => remove(file)}>Remove</button></div></td></tr>)}</tbody></table></div>}
    <div className="modal-footer"><button className="btn btn-ghost" disabled={uploading} onClick={onClose}>Close</button></div>
  </Modal>;
}

const today=() => new Date().toISOString().slice(0,10);
const daysUntil=date => Math.round((Date.parse(`${date}T00:00:00Z`)-Date.parse(`${today()}T00:00:00Z`))/86400000);
const reviewDue=(row,days) => row.lifecycle_status==='active' && (!row.reviewed_at || daysUntil(row.reviewed_at.slice(0,10)) < -days);

function SupportCell({ row }) {
  const dates=[['Support',row.support_end_date],['Warranty',row.warranty_expiry_date]].filter(([,date]) => date);
  if (!dates.length) return <span className="text-muted">—</span>;
  return dates.map(([what,date]) => { const left=daysUntil(date);
    return <div key={what} className={`text-sm${left<0 ? ' ca-expired' : left<=30 ? ' ca-expiring' : ''}`}>{what} {left<0 ? 'ended' : 'ends'} {fmtDate(date)}</div>; });
}

/* Review one asset: confirm or update the version it runs (one click to the
   latest for its line), with a note; every review and version change is kept.
   An engineer may also turn what they found into an upgrade task. */
function AssetReview({ customerId,asset,software,canAddTask,onClose,onSaved,onUpgradeTask }) {
  const [version,setVersion]=useState(asset.software_version || ''),[note,setNote]=useState(''),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const [log,setLog]=useState(null);
  useEffect(() => { const controller=new AbortController();
    api.customerAssetVersions(customerId,asset.id,{ signal:controller.signal }).then(setLog).catch(() => { if (!controller.signal.aborted) setLog([]); });
    return () => controller.abort(); },[customerId,asset.id]);
  const changed=version.trim()!==(asset.software_version || '');
  async function submit(event) {
    event.preventDefault();setSaving(true);setError('');
    try { await api.reviewCustomerAsset(customerId,asset.id,{ version:asset.version,software_version:version.trim() || null,note:note.trim() || null });onSaved(changed ? `${asset.name}: version updated to ${version.trim() || 'none'}` : `${asset.name}: review recorded`); }
    catch (failure) { setError(failure.message); } finally { setSaving(false); }
  }
  const outdated=software && ['behind','end_of_life'].includes(software.status);
  return <Modal title={`Review ${asset.name}`} onClose={saving ? () => {} : onClose} wide>
    <form onSubmit={submit} className="ca-review">
      {error && <div className="error-msg" role="alert">{error}</div>}
      <dl className="ca-review-facts">
        <div><dt>Product</dt><dd>{[asset.vendor,asset.model].filter(Boolean).join(' ') || <span className="text-muted">Not recorded</span>}</dd></div>
        <div><dt>Recorded version</dt><dd>{asset.software_version || <span className="text-muted">Not recorded</span>}</dd></div>
        <div><dt>Compared with the latest</dt><dd>{software ? <SoftwareStatusBadge status={software} /> : <span className="text-muted">Not a followed product</span>}</dd></div>
        <div><dt>Last reviewed</dt><dd>{asset.reviewed_at ? `${fmtDate(asset.reviewed_at)}${asset.reviewed_by_name ? ` by ${asset.reviewed_by_name}` : ''}` : <span className="text-muted">Never</span>}</dd></div>
      </dl>
      <div className="form-group"><label htmlFor="ca-version">Version it runs now</label>
        <input id="ca-version" value={version} maxLength={500} onChange={event => setVersion(event.target.value)} placeholder="e.g. 7.4.12" />
        {software?.latest && <div className="ca-version-picks">
          {software.latest!==version.trim() && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVersion(software.latest)}>Use latest {software.latest}</button>}
          {software.recommended && software.recommended!==software.latest && software.recommended!==version.trim() && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVersion(software.recommended)}>Use recommended {software.recommended}</button>}
          <span className="text-muted text-sm">{software.line} line</span>
        </div>}
      </div>
      <div className="form-group"><label htmlFor="ca-note">Note (optional)</label><textarea id="ca-note" rows={2} maxLength={2000} value={note} onChange={event => setNote(event.target.value)} placeholder="e.g. Upgrade planned for the next maintenance window" /></div>
      <div className="modal-footer">
        {canAddTask && outdated && !changed && <button type="button" className="btn btn-ghost mr-auto" onClick={() => onUpgradeTask(asset,software)}>Create upgrade task</button>}
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : changed ? 'Save new version' : 'Confirm review'}</button>
      </div>
    </form>
    <h3 className="ca-history-title">Version history</h3>
    {!log ? <p className="text-muted text-sm" role="status">Loading…</p> : !log.length ? <p className="text-muted text-sm">No reviews or version changes recorded yet.</p> :
      <ol className="ca-history">{log.map(entry => <li key={entry.id}>
        <span className="text-muted text-sm">{fmtDate(entry.created_at)}{entry.user_name ? ` · ${entry.user_name}` : ''}</span>
        <span>{entry.from_version===entry.to_version ? <>Reviewed: <strong>{entry.to_version || 'no version'}</strong> confirmed</>
          : <>{entry.kind==='reviewed' ? 'Reviewed' : 'Edited'}: {entry.from_version || 'no version'} → <strong>{entry.to_version || 'no version'}</strong></>}</span>
        {entry.note && <span className="text-sm">{entry.note}</span>}
      </li>)}</ol>}
  </Modal>;
}

const VIEWS=[['','All'],['attention','Needs update'],['end_of_life','End of life'],['review','Review due'],['expiring','Support ending']];

/* `restricted`: an engineer on a managed-services team — may list, add and
   review assets, but not edit, delete, import, export or manage files (the
   server enforces the same). */
export default function CustomerAssets({ customerId,restricted=false,isManager=false,canAddTask=false,initialView='' }) {
  const toast=useToast(),confirm=useConfirm();
  const [page,setPage]=useState(1),[coverage,setCoverage]=useState(''),[status,setStatus]=useState(''),[view,setView]=useState(VIEWS.some(([key]) => key===initialView) ? initialView : '');
  const [searchInput,setSearchInput]=useState(''),[search,setSearch]=useState('');
  const [data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[editing,setEditing]=useState(null),[filesFor,setFilesFor]=useState(null),[importing,setImporting]=useState(false),[exporting,setExporting]=useState(false);
  const [software,setSoftware]=useState(null),[reviewing,setReviewing]=useState(null),[taskFor,setTaskFor]=useState(null),[engineers,setEngineers]=useState([]);
  const query=useMemo(() => ({ ...(coverage ? { coverage } : {}),...(status ? { status } : {}),...(search ? { search } : {}),
    ...(view==='attention' ? { software:'attention' } : view==='end_of_life' ? { software:'end_of_life' } : view==='review' ? { review:'due' } : view==='expiring' ? { expiry:'30' } : {}) }),[coverage,status,search,view]);
  const scope=`${customerId}:${page}:${JSON.stringify(query)}`;
  const { begin,isCurrent }=useLatestRequest(scope);
  const load=useCallback(() => {
    const request=begin(); if (request.signal.aborted) return;
    setLoading(true); setError('');
    api.customerAssets(customerId,{ page,...query },{ signal:request.signal }).then(result => {
      if (!isCurrent(request)) return; setData(result);
      const last=Math.max(1,Math.ceil(result.total/result.page_size)); if (page>last) setPage(last);
    }).catch(failure => { if (isCurrent(request)) setError(failure.message); }).finally(() => { if (isCurrent(request)) setLoading(false); });
  },[customerId,page,query,begin,isCurrent]);
  useEffect(() => { load(); },[load]);
  useEffect(() => { api.customerAssetSoftwareStatus(customerId).then(result => setSoftware(new Map(result.assets.map(a => [a.id,a])))).catch(() => setSoftware(null)); },[customerId,data]);
  useEffect(() => { if (isManager) api.users().then(users => setEngineers(users.filter(u => u.role==='engineer' && u.active!==0))).catch(() => {}); },[isManager]);
  async function remove(row) {
    if (!await confirm(`Delete ${row.name}? Its audit event will be retained. To keep its history, set it to Retired or Decommissioned instead.`,{ title:'Delete customer asset?' })) return;
    try { await api.deleteCustomerAsset(customerId,row.id,row.version); toast.success('Asset deleted'); load(); } catch (failure) { setError(failure.message); }
  }
  async function exportAssets() {
    setExporting(true);setError('');
    try { const { software:_software,review:_review,...plain }=query;const blob=await api.exportCustomerAssets(customerId,plain);const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`customer-${customerId}-assets.xlsx`;document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url); }
    catch(failure) { setError(failure.message); }
    finally { setExporting(false); }
  }
  const all=software ? [...software.values()] : [],summary=data?.expiry_summary || {};
  const counts={ '':summary.active,attention:all.filter(a => ['behind','end_of_life'].includes(a.status)).length,end_of_life:all.filter(a => a.status==='end_of_life').length,review:summary.review_due,expiring:summary.due_30 };
  const choose=value => { setView(value);setPage(1); };
  const filtered=!!(view || search || coverage || status);
  const columns=[
    { key:'asset',label:'Asset',render:row => <div className="ca-asset"><strong>{row.name}</strong><span>{[row.asset_type,row.hostname || row.ip_address].filter(Boolean).join(' · ')}</span>
      {row.lifecycle_status!=='active' && <ToneBadge>{label(row.lifecycle_status)}</ToneBadge>}</div> },
    { key:'version',label:'Version',render:row => <div className="ca-version"><strong>{row.software_version || <span className="text-muted">Not recorded</span>}</strong><span>{[row.vendor,row.model].filter(Boolean).join(' ')}</span></div> },
    { key:'software',label:'Compared with latest',render:row => software?.get(row.id) ? <SoftwareStatusBadge status={software.get(row.id)} /> : <span className="text-muted text-sm">{row.software_version ? 'Not a followed product' : '—'}</span> },
    { key:'support',label:'Support / warranty',render:row => <SupportCell row={row} /> },
    { key:'reviewed',label:'Last reviewed',render:row => <div className="ca-reviewed">{row.reviewed_at ? <span>{fmtDate(row.reviewed_at)}{row.reviewed_by_name && <small>{row.reviewed_by_name}</small>}</span> : <span className="text-muted">Never</span>}
      {reviewDue(row,summary.review_days || 90) && <ToneBadge tone="warning">Review due</ToneBadge>}</div> },
    { key:'actions',label:'Actions',render:row => <div className="table-actions">
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setReviewing(row)} aria-label={`Review ${row.name}`}><ClipboardCheck size={14} /> Review</button>
      {!restricted && <>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing({ initial:row })} aria-label={`Edit ${row.name}`} title="Edit"><Pencil size={14} /></button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setFilesFor(row)} aria-label={`Files for ${row.name}`} title="Files"><Paperclip size={14} />{Number(row.attachment_count)>0 && <span className="ca-count">{row.attachment_count}</span>}</button>
        <button type="button" className="btn btn-sm btn-ghost btn-icon-danger" onClick={() => remove(row)} aria-label={`Delete ${row.name}`} title="Delete"><Trash2 size={14} /></button>
      </>}
    </div> },
  ];
  return <section className="ca">
    <div className="ca-views" role="group" aria-label="Asset views">{VIEWS.map(([key,text]) => <button key={key || 'all'} type="button" className={`filter-pill${view===key ? ' active' : ''}`} aria-pressed={view===key} onClick={() => choose(key)}>
      {text}{counts[key]!=null && <span className="u-383082b"> ({counts[key]})</span>}</button>)}</div>
    <div className="ca-toolbar">
      <form onSubmit={event => { event.preventDefault();setSearch(searchInput.trim());setPage(1); }} className="ca-search">
        <input id="asset-search" aria-label="Search assets" value={searchInput} minLength={2} maxLength={100} onChange={event => setSearchInput(event.target.value)} placeholder="Search name, tag, hostname, IP, serial, version…" />
        <button className="btn btn-ghost" disabled={!!searchInput.trim() && searchInput.trim().length<2}>Search</button>{search && <button type="button" className="btn btn-ghost" onClick={() => { setSearchInput('');setSearch('');setPage(1); }}>Clear</button>}
      </form>
      <select id="asset-list-coverage" aria-label="Coverage" value={coverage} onChange={event => { setCoverage(event.target.value);setPage(1); }}><option value="">All coverage</option>{COVERAGE.map(value => <option key={value} value={value}>{value==='support' ? 'Under support' : label(value)}</option>)}</select>
      <select id="asset-list-status" aria-label="Status" value={status} onChange={event => { setStatus(event.target.value);setPage(1); }}><option value="">All statuses</option>{STATUSES.map(value => <option key={value} value={value}>{label(value)}</option>)}</select>
      <div className="ca-toolbar-actions">
        {!restricted && <><button className="btn btn-ghost" onClick={() => setImporting(true)}>Import</button><button className="btn btn-ghost" disabled={exporting || loading} onClick={exportAssets}>{exporting ? 'Exporting...' : 'Export Excel'}</button></>}
        <button className="btn btn-primary" disabled={loading || !!error} onClick={() => setEditing({ initial:null })}>Add asset</button>
      </div>
    </div>
    {summary.expired>0 && view!=='expiring' && <div className="alert alert-warning mb-12" role="status">{summary.expired} active asset{summary.expired===1 ? ' has' : 's have'} expired support or warranty.</div>}
    <DataTable columns={columns} rows={data?.rows || []} loading={loading} error={error} onRetry={load} caption="Customer assets"
      empty={filtered ? 'No assets in this view' : 'No assets recorded for this customer yet'}
      emptyAction={filtered && <button className="btn btn-ghost btn-sm" onClick={() => { setView('');setSearch('');setSearchInput('');setCoverage('');setStatus('');setPage(1); }}>Show all assets</button>} />
    {data && data.total>data.page_size && <Pagination page={page} total={data.total} pageSize={data.page_size} loading={loading} onPageChange={setPage} label="Asset pages" />}
    {editing && data && <AssetForm customerId={customerId} initial={editing.initial} technologies={data.technologies} onClose={() => setEditing(null)} onSaved={() => { toast.success('Asset saved');load(); }} />}
    {filesFor && <AssetFiles customerId={customerId} asset={filesFor} onClose={() => setFilesFor(null)} onChanged={load} />}
    {reviewing && <AssetReview customerId={customerId} asset={reviewing} software={software?.get(reviewing.id)} canAddTask={canAddTask} onClose={() => setReviewing(null)}
      onSaved={message => { setReviewing(null);toast.success(message);load(); }}
      onUpgradeTask={(asset,found) => { setReviewing(null);setTaskFor({ asset,found }); }} />}
    {taskFor && <CustomerTaskForm customerId={customerId} isManager={isManager} engineers={engineers}
      initial={{ title:`Upgrade ${taskFor.asset.name} to ${taskFor.found.recommended || taskFor.found.latest}`, description:`${taskFor.asset.name} runs ${taskFor.asset.software_version}; the latest on the ${taskFor.found.line} line is ${taskFor.found.latest}.`, priority:taskFor.found.status==='end_of_life' ? 'high' : 'medium', asset_id:taskFor.asset.id, asset_name:taskFor.asset.name }}
      onClose={() => setTaskFor(null)} onSaved={() => { setTaskFor(null);toast.success('Upgrade task added'); }} />}
    {importing && <ImportModal title="Import customer assets" templateUrl={api.customerAssetTemplateUrl(customerId)} importFn={file => api.importCustomerAssets(customerId,file)} columns={['name*','asset_type*','asset_tag','technology','hostname','ip_address','software_version','coverage_type','support_end_date']} onClose={() => setImporting(false)} onDone={() => { toast.success('Assets imported');load(); }} />}
  </section>;
}
