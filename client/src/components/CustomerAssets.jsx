import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { fmtDate, Modal } from './Shared';
import { useConfirm } from './Confirm';
import { useLatestRequest } from '../hooks/useLatestRequest';
import { useToast } from './Toast';

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
      <fieldset disabled={saving} style={{ border:0,padding:0,margin:0 }}>
        <div className="form-row"><div className="form-group"><label htmlFor="asset-name">Asset name</label><input id="asset-name" autoFocus required maxLength={300} value={form.name} onChange={set('name')} placeholder="Primary Check Point gateway" /></div><div className="form-group"><label htmlFor="asset-tag">Asset tag</label><input id="asset-tag" maxLength={500} value={form.asset_tag || ''} onChange={set('asset_tag')} /></div></div>
        <div className="form-row"><div className="form-group"><label htmlFor="asset-type">Asset type</label><input id="asset-type" required maxLength={100} value={form.asset_type} onChange={set('asset_type')} placeholder="Security gateway, server, switch..." /></div><div className="form-group"><label htmlFor="asset-technology">Technology</label><select id="asset-technology" value={form.technology_id || ''} onChange={set('technology_id')}><option value="">Not linked</option>{initial?.technology_id && !technologies.some(row => row.id===Number(initial.technology_id)) && <option value={initial.technology_id}>{initial.technology_name || 'Previous technology'} (inactive)</option>}{technologies.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></div></div>
        <div className="form-row"><div className="form-group"><label htmlFor="asset-coverage">Service coverage</label><select id="asset-coverage" value={form.coverage_type} onChange={set('coverage_type')}>{COVERAGE.map(value => <option key={value} value={value}>{value==='support' ? 'Under support' : label(value)}</option>)}</select></div><div className="form-group"><label htmlFor="asset-status">Lifecycle status</label><select id="asset-status" value={form.lifecycle_status} onChange={set('lifecycle_status')}>{STATUSES.map(value => <option key={value} value={value}>{label(value)}</option>)}</select></div></div>
        <div className="form-row"><div className="form-group"><label htmlFor="asset-vendor">Vendor</label><input id="asset-vendor" maxLength={500} value={form.vendor || ''} onChange={set('vendor')} placeholder="Check Point" /></div><div className="form-group"><label htmlFor="asset-model">Model</label><input id="asset-model" maxLength={500} value={form.model || ''} onChange={set('model')} /></div></div>
        <div className="form-row"><div className="form-group"><label htmlFor="asset-hostname">Hostname</label><input id="asset-hostname" maxLength={253} value={form.hostname || ''} onChange={set('hostname')} /></div><div className="form-group"><label htmlFor="asset-ip">IP address</label><input id="asset-ip" maxLength={500} value={form.ip_address || ''} onChange={set('ip_address')} placeholder="IPv4 or IPv6" /></div></div>
        <div className="form-row"><div className="form-group"><label htmlFor="asset-mac">MAC address</label><input id="asset-mac" maxLength={17} value={form.mac_address || ''} onChange={set('mac_address')} placeholder="00:11:22:33:44:55" /></div><div className="form-group"><label htmlFor="asset-serial">Serial number</label><input id="asset-serial" maxLength={500} value={form.serial_number || ''} onChange={set('serial_number')} /></div></div>
        <div className="form-row"><div className="form-group"><label htmlFor="asset-version">Software / firmware version</label><input id="asset-version" maxLength={500} value={form.software_version || ''} onChange={set('software_version')} /></div><div className="form-group"><label htmlFor="asset-location">Location</label><input id="asset-location" maxLength={500} value={form.location || ''} onChange={set('location')} /></div></div>
        <div className="form-row"><div className="form-group"><label htmlFor="asset-environment">Environment</label><select id="asset-environment" value={form.environment} onChange={set('environment')}>{ENVIRONMENTS.map(value => <option key={value} value={value}>{label(value)}</option>)}</select></div><div className="form-group"><label htmlFor="asset-criticality">Criticality</label><select id="asset-criticality" value={form.criticality} onChange={set('criticality')}>{CRITICALITY.map(value => <option key={value} value={value}>{label(value)}</option>)}</select></div></div>
        <h3 style={{ fontSize:15,marginTop:16 }}>Support and warranty</h3>
        <div className="form-row"><div className="form-group"><label htmlFor="asset-provider">Support provider</label><input id="asset-provider" maxLength={500} value={form.support_provider || ''} onChange={set('support_provider')} /></div><div className="form-group"><label htmlFor="asset-reference">Support reference</label><input id="asset-reference" maxLength={500} value={form.support_reference || ''} onChange={set('support_reference')} /></div></div>
        <div className="form-row"><div className="form-group"><label htmlFor="asset-support-start">Support start</label><input id="asset-support-start" type="date" min="1900-01-01" max="9998-12-31" value={form.support_start_date || ''} onChange={set('support_start_date')} /></div><div className="form-group"><label htmlFor="asset-support-end">Support end</label><input id="asset-support-end" type="date" min="1900-01-01" max="9998-12-31" value={form.support_end_date || ''} onChange={set('support_end_date')} /></div><div className="form-group"><label htmlFor="asset-warranty">Warranty expiry</label><input id="asset-warranty" type="date" min="1900-01-01" max="9998-12-31" value={form.warranty_expiry_date || ''} onChange={set('warranty_expiry_date')} /></div></div>
        <div className="form-group"><label htmlFor="asset-url">Management URL</label><input id="asset-url" type="url" maxLength={500} value={form.management_url || ''} onChange={set('management_url')} placeholder="https://gateway.example.local" /></div>
        <div className="form-group"><label htmlFor="asset-notes">Notes (do not store passwords or secrets)</label><textarea id="asset-notes" maxLength={10000} rows={3} value={form.notes || ''} onChange={set('notes')} /></div>
        <div className="modal-footer"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit">{saving ? 'Saving...' : 'Save asset'}</button></div>
      </fieldset>
    </form>
  </Modal>;
}

export default function CustomerAssets({ customerId }) {
  const toast=useToast(),confirm=useConfirm();
  const [page,setPage]=useState(1),[coverage,setCoverage]=useState(''),[status,setStatus]=useState('');
  const [data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[editing,setEditing]=useState(null);
  const scope=`${customerId}:${page}:${coverage}:${status}`;
  const { begin,isCurrent }=useLatestRequest(scope);
  const load=useCallback(() => {
    const request=begin(); if (request.signal.aborted) return;
    setLoading(true); setError('');
    api.customerAssets(customerId,{ page,...(coverage ? { coverage } : {}),...(status ? { status } : {}) },{ signal:request.signal }).then(result => {
      if (!isCurrent(request)) return; setData(result);
      const last=Math.max(1,Math.ceil(result.total/result.page_size)); if (page>last) setPage(last);
    }).catch(failure => { if (isCurrent(request)) setError(failure.message); }).finally(() => { if (isCurrent(request)) setLoading(false); });
  },[customerId,page,coverage,status,begin,isCurrent]);
  useEffect(() => { load(); },[load]);
  async function remove(row) {
    if (!await confirm(`Delete ${row.name}? Its audit event will be retained.`,{ title:'Delete customer asset?' })) return;
    try { await api.deleteCustomerAsset(customerId,row.id,row.version); toast.success('Asset deleted'); load(); } catch (failure) { setError(failure.message); }
  }
  return <section>
    <div className="flex gap-8" style={{ marginBottom:16,flexWrap:'wrap' }}><label htmlFor="asset-list-coverage">Coverage</label><select id="asset-list-coverage" value={coverage} onChange={event => { setCoverage(event.target.value);setPage(1); }} style={{ width:'auto' }}><option value="">All coverage</option>{COVERAGE.map(value => <option key={value} value={value}>{value==='support' ? 'Under support' : label(value)}</option>)}</select><label htmlFor="asset-list-status">Status</label><select id="asset-list-status" value={status} onChange={event => { setStatus(event.target.value);setPage(1); }} style={{ width:'auto' }}><option value="">All statuses</option>{STATUSES.map(value => <option key={value} value={value}>{label(value)}</option>)}</select><button className="btn btn-primary" disabled={loading || !!error} onClick={() => setEditing({ initial:null })}>Add asset</button><button className="btn btn-ghost" disabled={loading} onClick={load}>Refresh</button></div>
    {error ? <div className="error-msg" role="alert">{error} <button className="btn btn-ghost" onClick={load}>Retry</button></div> : loading || !data ? <p role="status">Loading customer assets...</p> : <>
      {!data.rows.length && <p className="text-muted">No customer assets in this view.</p>}
      <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,320px),1fr))',gap:16 }}>
        {data.rows.map(row => <article className="card" key={row.id} style={{ overflowWrap:'anywhere' }}><h2 style={{ fontSize:17 }}>{row.name}</h2><p><strong>{row.asset_type}</strong> / {row.coverage_type==='support' ? 'Under support' : label(row.coverage_type)} / {label(row.lifecycle_status)}</p><p className="text-muted">{[row.vendor,row.model,row.software_version].filter(Boolean).join(' / ') || 'Vendor, model and version not recorded'}</p><p>{row.hostname || 'No hostname'}{row.ip_address ? ` / ${row.ip_address}` : ''}</p><p className="text-muted text-sm">Tag: {row.asset_tag || 'none'} / Serial: {row.serial_number || 'none'} / {label(row.environment)} / {label(row.criticality)} criticality</p>{row.support_end_date && <p>Support ends {fmtDate(row.support_end_date)}</p>}{row.warranty_expiry_date && <p>Warranty expires {fmtDate(row.warranty_expiry_date)}</p>}{row.notes && <p style={{ whiteSpace:'pre-wrap' }}>{row.notes}</p>}<div className="flex gap-8"><button className="btn btn-ghost" onClick={() => setEditing({ initial:row })}>Edit</button><button className="btn btn-danger" onClick={() => remove(row)}>Delete</button></div></article>)}
      </div>
      <div className="flex gap-8" style={{ marginTop:16 }}><button className="btn btn-ghost" disabled={page<=1} onClick={() => setPage(value => value-1)}>Previous</button><span>Page {page} / {data.total} assets</span><button className="btn btn-ghost" disabled={page*data.page_size>=data.total} onClick={() => setPage(value => value+1)}>Next</button></div>
    </>}
    {editing && data && <AssetForm customerId={customerId} initial={editing.initial} technologies={data.technologies} onClose={() => setEditing(null)} onSaved={() => { toast.success('Asset saved');load(); }} />}
  </section>;
}
