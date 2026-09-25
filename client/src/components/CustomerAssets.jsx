import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { fmtDate, Modal } from './Shared';
import { useConfirm } from './Confirm';
import { useLatestRequest } from '../hooks/useLatestRequest';
import { useToast } from './Toast';
import ImportModal from './ImportModal';

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
    <label className="btn btn-primary u-3a8b923" style={{ cursor:uploading ? 'wait' : 'pointer' }}>
      {uploading ? 'Uploading...' : 'Upload files'}
      <input ref={inputRef} type="file" multiple hidden disabled={uploading} onChange={event => uploadFiles([...event.target.files])} />
    </label>
    <span className="text-muted text-sm u-78fa54e">Maximum 20 MB per file</span>
    {loading ? <p role="status">Loading files...</p> : !files.length ? <p className="text-muted">No files attached to this asset.</p> : <div className="table-wrap"><table><thead><tr><th>File</th><th>Size</th><th>Uploaded by</th><th>Date</th><th>Actions</th></tr></thead><tbody>{files.map(file => <tr key={file.id}><td>{file.original_name}</td><td>{fileSize(file.size)}</td><td>{file.uploaded_by_name}</td><td>{fmtDate(file.created_at)}</td><td><div className="flex gap-8"><button className="btn btn-ghost btn-sm" disabled={downloading===file.id} onClick={() => download(file)}>{downloading===file.id ? 'Preparing...' : 'Download'}</button><button className="btn btn-danger btn-sm" onClick={() => remove(file)}>Remove</button></div></td></tr>)}</tbody></table></div>}
    <div className="modal-footer"><button className="btn btn-ghost" disabled={uploading} onClick={onClose}>Close</button></div>
  </Modal>;
}

/* `restricted`: an engineer on a managed-services team — may list and add
   assets, but not edit, delete, import, export or manage files (the server
   enforces the same). */
export default function CustomerAssets({ customerId,restricted=false }) {
  const toast=useToast(),confirm=useConfirm();
  const [page,setPage]=useState(1),[coverage,setCoverage]=useState(''),[status,setStatus]=useState('');
  const [searchInput,setSearchInput]=useState(''),[search,setSearch]=useState(''),[expiry,setExpiry]=useState('');
  const [data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[editing,setEditing]=useState(null),[filesFor,setFilesFor]=useState(null),[importing,setImporting]=useState(false),[exporting,setExporting]=useState(false);
  const scope=`${customerId}:${page}:${coverage}:${status}:${search}:${expiry}`;
  const { begin,isCurrent }=useLatestRequest(scope);
  const load=useCallback(() => {
    const request=begin(); if (request.signal.aborted) return;
    setLoading(true); setError('');
    api.customerAssets(customerId,{ page,...(coverage ? { coverage } : {}),...(status ? { status } : {}),...(search ? { search } : {}),...(expiry ? { expiry } : {}) },{ signal:request.signal }).then(result => {
      if (!isCurrent(request)) return; setData(result);
      const last=Math.max(1,Math.ceil(result.total/result.page_size)); if (page>last) setPage(last);
    }).catch(failure => { if (isCurrent(request)) setError(failure.message); }).finally(() => { if (isCurrent(request)) setLoading(false); });
  },[customerId,page,coverage,status,search,expiry,begin,isCurrent]);
  useEffect(() => { load(); },[load]);
  async function remove(row) {
    if (!await confirm(`Delete ${row.name}? Its audit event will be retained.`,{ title:'Delete customer asset?' })) return;
    try { await api.deleteCustomerAsset(customerId,row.id,row.version); toast.success('Asset deleted'); load(); } catch (failure) { setError(failure.message); }
  }
  async function exportAssets() {
    setExporting(true);setError('');
    try { const blob=await api.exportCustomerAssets(customerId,{ ...(coverage ? { coverage } : {}),...(status ? { status } : {}),...(search ? { search } : {}),...(expiry ? { expiry } : {}) });const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`customer-${customerId}-assets.xlsx`;document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url); }
    catch(failure) { setError(failure.message); }
    finally { setExporting(false); }
  }
  return <section>
    <form onSubmit={event => { event.preventDefault();setSearch(searchInput.trim());setPage(1); }} className="flex gap-8 mb-12 flex-wrap"><label htmlFor="asset-search">Search assets</label><input id="asset-search" value={searchInput} minLength={2} maxLength={100} onChange={event => setSearchInput(event.target.value)} placeholder="Name, tag, hostname, IP, serial..." className="u-3521b3d" /><button className="btn btn-ghost" disabled={!!searchInput.trim() && searchInput.trim().length<2}>Search</button>{search && <button type="button" className="btn btn-ghost" onClick={() => { setSearchInput('');setSearch('');setPage(1); }}>Clear</button>}</form>
    <div className="flex gap-8 mb-16 flex-wrap"><label htmlFor="asset-list-coverage">Coverage</label><select id="asset-list-coverage" value={coverage} onChange={event => { setCoverage(event.target.value);setPage(1); }} className="u-30e741d"><option value="">All coverage</option>{COVERAGE.map(value => <option key={value} value={value}>{value==='support' ? 'Under support' : label(value)}</option>)}</select><label htmlFor="asset-list-status">Status</label><select id="asset-list-status" value={status} onChange={event => { setStatus(event.target.value);setPage(1); }} className="u-30e741d"><option value="">All statuses</option>{STATUSES.map(value => <option key={value} value={value}>{label(value)}</option>)}</select><label htmlFor="asset-list-expiry">Expiry</label><select id="asset-list-expiry" value={expiry} onChange={event => { setExpiry(event.target.value);setPage(1); }} className="u-30e741d"><option value="">All dates</option><option value="expired">Expired</option><option value="30">Due within 30 days</option><option value="60">Due within 60 days</option><option value="90">Due within 90 days</option></select><button className="btn btn-primary" disabled={loading || !!error} onClick={() => setEditing({ initial:null })}>Add asset</button>{!restricted && <><button className="btn btn-ghost" onClick={() => setImporting(true)}>Import</button><button className="btn btn-ghost" disabled={exporting || loading} onClick={exportAssets}>{exporting ? 'Exporting...' : 'Export Excel'}</button></>}<button className="btn btn-ghost" disabled={loading} onClick={load}>Refresh</button></div>
    {error ? <div className="error-msg" role="alert">{error} <button className="btn btn-ghost" onClick={load}>Retry</button></div> : loading || !data ? <p role="status">Loading customer assets...</p> : <>
      {(data.expiry_summary?.expired>0 || data.expiry_summary?.due_30>0) && <div className="alert alert-warning mb-16" role="status">{data.expiry_summary.expired} active assets have expired support or warranty; {data.expiry_summary.due_30} expire within 30 days. Use the Expiry filter to review them.</div>}
      {!data.rows.length && <p className="text-muted">No customer assets in this view.</p>}
      <div className="u-3324e14">
        {data.rows.map(row => <article className="card u-115422e" key={row.id}><h2 className="u-2b99ca6">{row.name}</h2><p><strong>{row.asset_type}</strong> / {row.coverage_type==='support' ? 'Under support' : label(row.coverage_type)} / {label(row.lifecycle_status)}</p><p className="text-muted">{[row.vendor,row.model,row.software_version].filter(Boolean).join(' / ') || 'Vendor, model and version not recorded'}</p><p>{row.hostname || 'No hostname'}{row.ip_address ? ` / ${row.ip_address}` : ''}</p><p className="text-muted text-sm">Tag: {row.asset_tag || 'none'} / Serial: {row.serial_number || 'none'} / {label(row.environment)} / {label(row.criticality)} criticality</p>{Number(row.activity_count)>0 && <p><strong>{row.activity_count}</strong> linked service {Number(row.activity_count)===1 ? 'activity' : 'activities'}</p>}{row.support_end_date && <p>Support ends {fmtDate(row.support_end_date)}</p>}{row.warranty_expiry_date && <p>Warranty expires {fmtDate(row.warranty_expiry_date)}</p>}{row.notes && <p className="u-a548ea7">{row.notes}</p>}{!restricted && <div className="flex gap-8 u-62da067"><button className="btn btn-ghost" onClick={() => setFilesFor(row)}>Files ({Number(row.attachment_count || 0)})</button><button className="btn btn-ghost" onClick={() => setEditing({ initial:row })}>Edit</button><button className="btn btn-danger" onClick={() => remove(row)}>Delete</button></div>}</article>)}
      </div>
      <div className="flex gap-8 mt-16"><button className="btn btn-ghost" disabled={page<=1} onClick={() => setPage(value => value-1)}>Previous</button><span>Page {page} / {data.total} assets</span><button className="btn btn-ghost" disabled={page*data.page_size>=data.total} onClick={() => setPage(value => value+1)}>Next</button></div>
    </>}
    {editing && data && <AssetForm customerId={customerId} initial={editing.initial} technologies={data.technologies} onClose={() => setEditing(null)} onSaved={() => { toast.success('Asset saved');load(); }} />}
    {filesFor && <AssetFiles customerId={customerId} asset={filesFor} onClose={() => setFilesFor(null)} onChanged={load} />}
    {importing && <ImportModal title="Import customer assets" templateUrl={api.customerAssetTemplateUrl(customerId)} importFn={file => api.importCustomerAssets(customerId,file)} columns={['name*','asset_type*','asset_tag','technology','hostname','ip_address','software_version','coverage_type','support_end_date']} onClose={() => setImporting(false)} onDone={() => { toast.success('Assets imported');load(); }} />}
  </section>;
}
