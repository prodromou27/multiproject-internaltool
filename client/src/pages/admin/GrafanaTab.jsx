import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { LoadError } from '../../components/LoadError';
import { fmtDateTime } from '../../components/Shared';
import { useToast } from '../../components/Toast';

/* Settings → Grafana devices: the Check Point devices our Grafana (Prometheus)
   dashboards show, matched to customer assets. Sync, review what differs, then apply;
   nothing changes an asset until it is applied (or "apply automatically" is on). */
const STATUS = { differs: 'Differs', matches: 'Up to date', unmatched: 'No asset found', ambiguous: 'Several assets match', ignored: 'Ignored' };
const linesToMap = (text, valueOf) => Object.fromEntries(text.split('\n').map(line => line.split('=').map(part => part.trim())).filter(([key, value]) => key && value).map(([key, value]) => [key, valueOf(value)]));

function Connection({ settings, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ base_url: settings.base_url, token: '', datasource_uid: settings.datasource_uid, version_query: settings.version_query, model_query: settings.model_query,
    version_map: Object.entries(settings.version_map).map(([k, v]) => `${k} = ${v}`).join('\n'), auto_apply: settings.auto_apply });
  const [saving, setSaving] = useState(false);
  const set = key => event => setForm(f => ({ ...f, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));
  async function save(event) {
    event.preventDefault(); setSaving(true);
    try {
      onSaved(await api.saveGrafanaSettings({ ...form, token: form.token || undefined, version_map: linesToMap(form.version_map, value => value) }));
      setForm(f => ({ ...f, token: '' })); toast.success('Grafana settings saved');
    } catch (failure) { toast.error(failure.message); } finally { setSaving(false); }
  }
  return <form className="card" style={{ padding: 14, marginBottom: 14 }} onSubmit={save}>
    <h3 className="section-title">Connection</h3>
    <div className="form-row">
      <div className="form-group"><label htmlFor="grafana-url">Grafana address</label><input id="grafana-url" placeholder="https://grafana.internal:3000" value={form.base_url} onChange={set('base_url')} /></div>
      <div className="form-group"><label htmlFor="grafana-uid">Prometheus data source UID</label><input id="grafana-uid" placeholder="fe8guxq67er5sf" value={form.datasource_uid} onChange={set('datasource_uid')} /></div>
    </div>
    <div className="form-group"><label htmlFor="grafana-token">Service-account token (Viewer)</label><input id="grafana-token" type="password" autoComplete="off" placeholder={settings.token_set ? 'Saved — type a new one to replace it' : 'glsa_…'} value={form.token} onChange={set('token')} /></div>
    <details><summary className="text-sm">Queries and version names</summary>
      <div className="form-group"><label htmlFor="grafana-version-query">Version query (value = hotfix build, label <code>name</code> = version line)</label><input id="grafana-version-query" value={form.version_query} onChange={set('version_query')} /></div>
      <div className="form-group"><label htmlFor="grafana-model-query">Model query (label <code>model</code>)</label><input id="grafana-model-query" value={form.model_query} onChange={set('model_query')} /></div>
      <div className="form-group"><label htmlFor="grafana-version-map">Version names not read automatically, one per line (e.g. <code>jess_main = R82.10</code>)</label><textarea id="grafana-version-map" rows={3} value={form.version_map} onChange={set('version_map')} /></div>
    </details>
    <label className="text-sm" style={{ display: 'flex', gap: 6, margin: '8px 0' }}><input type="checkbox" checked={form.auto_apply} onChange={set('auto_apply')} />Apply differences automatically on each sync (off: they wait for review below)</label>
    <button className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Save connection'}</button>
    {/^http:/i.test(form.base_url) && <p className="text-sm text-muted">The token travels unencrypted over http; prefer https if Grafana offers it.</p>}
  </form>;
}

function Takes({ settings, onSaved }) {
  const toast = useToast();
  const [text, setText] = useState(() => Object.entries(settings.take_map).map(([build, take]) => `${build} = ${take}`).join('\n'));
  const [paste, setPaste] = useState(''), [conflicts, setConflicts] = useState(null), [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { onSaved(await api.saveGrafanaSettings({ take_map: linesToMap(text, value => Number(String(value).replace(/^take\s*/i, ''))) })); toast.success('Take list saved'); }
    catch (failure) { toast.error(failure.message); } finally { setBusy(false); }
  }
  async function importDashboard() {
    setBusy(true);
    try {
      const result = await api.importGrafanaTakes(paste);
      setText(Object.entries(result.take_map).map(([build, take]) => `${build} = ${take}`).join('\n')); setConflicts(result.conflicts); setPaste('');
      toast.success(`${result.added} builds added from the dashboard`); onSaved(await api.grafanaSettings());
    } catch (failure) { toast.error(failure.message); } finally { setBusy(false); }
  }
  return <section className="card" style={{ padding: 14, marginBottom: 14 }} aria-label="Hotfix builds">
    <h3 className="section-title">Hotfix build → take</h3>
    <p className="text-sm text-muted">Grafana reports the Jumbo Hotfix as a build number (e.g. 996000077). Each build here becomes its take (Take 170); builds not listed are shown, not guessed.</p>
    <div className="form-group"><label htmlFor="grafana-takes">One per line: build = take</label><textarea id="grafana-takes" rows={6} value={text} onChange={e => setText(e.target.value)} /></div>
    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={save}>Save take list</button>
    <div className="form-group" style={{ marginTop: 10 }}><label htmlFor="grafana-dashboard">Or paste a dashboard's JSON to take its value mappings</label><textarea id="grafana-dashboard" rows={3} value={paste} onChange={e => setPaste(e.target.value)} placeholder='{"apiVersion": "dashboard.grafana.app/v2", …}' /></div>
    <button type="button" className="btn btn-ghost btn-sm" disabled={busy || !paste.trim()} onClick={importDashboard}>Import from dashboard</button>
    {conflicts && Object.keys(conflicts).length > 0 && <p className="alert alert-warning" role="note">Mapped differently in the dashboard, so not imported; add the right take above: {Object.entries(conflicts).map(([build, takes]) => `${build} (Take ${takes.join(' or ')})`).join(', ')}.</p>}
  </section>;
}

function LinkDevice({ row, onDone }) {
  const toast = useToast();
  const [q, setQ] = useState(''), [options, setOptions] = useState([]);
  useEffect(() => {
    if (q.trim().length < 2) { setOptions([]); return undefined; }
    const timer = setTimeout(() => api.grafanaAssets(q.trim()).then(data => setOptions(data.rows || [])).catch(() => setOptions([])), 250);
    return () => clearTimeout(timer);
  }, [q]);
  async function link(body) {
    try { await api.linkGrafanaDevice({ host_name: row.host_name, ...body }); onDone(); }
    catch (failure) { toast.error(failure.message); }
  }
  return <div className="flex gap-6" style={{ flexWrap: 'wrap' }}>
    <input aria-label={`Find the asset for ${row.host_name}`} placeholder="Find asset…" value={q} onChange={e => setQ(e.target.value)} style={{ width: 160 }} />
    {options.length > 0 && <select aria-label={`Asset for ${row.host_name}`} defaultValue="" onChange={e => e.target.value && link({ asset_id: Number(e.target.value) })}>
      <option value="" disabled>{options.length} found…</option>{options.map(o => <option key={o.id} value={o.id}>{o.customer_name}: {o.name}{o.hostname ? ` (${o.hostname})` : ''}</option>)}
    </select>}
    <button type="button" className="btn btn-ghost btn-sm" onClick={() => link({ ignore: true })}>Ignore</button>
  </div>;
}

function Review({ onSynced }) {
  const toast = useToast();
  const [rows, setRows] = useState(null), [error, setError] = useState(null), [show, setShow] = useState('review'), [chosen, setChosen] = useState(new Set()), [busy, setBusy] = useState(false);
  const load = useCallback(() => api.grafanaDevices().then(data => { setRows(data.rows || []); setChosen(new Set()); }).catch(setError), []);
  useEffect(() => { load(); }, [load]);
  async function sync() {
    setBusy(true);
    try { const result = await api.syncGrafana(); toast.success(`${result.devices} devices read; ${result.differs} to review`); await load(); onSynced(); }
    catch (failure) { toast.error(failure.message); onSynced(); } finally { setBusy(false); }
  }
  async function apply() {
    setBusy(true);
    try { const result = await api.applyGrafana([...chosen]); toast.success(`${result.applied} assets updated`); await load(); }
    catch (failure) { toast.error(failure.message); } finally { setBusy(false); }
  }
  if (error && !rows) return <LoadError what="Grafana devices" error={error} onRetry={load} />;
  if (!rows) return <p className="text-muted" role="status">Loading…</p>;
  const count = status => rows.filter(r => r.status === status).length;
  const list = rows.filter(r => show === 'all' || (show === 'review' ? r.status === 'differs' : ['unmatched', 'ambiguous'].includes(r.status)));
  const toggle = host => setChosen(c => { const next = new Set(c); next.has(host) ? next.delete(host) : next.add(host); return next; });
  return <section aria-label="Devices from Grafana">
    <div className="flex gap-8" style={{ flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
      <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={sync}>{busy ? 'Working…' : 'Sync now'}</button>
      {[['review', `To review (${count('differs')})`], ['unmatched', `Not matched (${count('unmatched') + count('ambiguous')})`], ['all', `All (${rows.length})`]].map(([key, label]) => (
        <button key={key} type="button" className={'filter-pill' + (show === key ? ' active' : '')} onClick={() => setShow(key)}>{label}</button>))}
      {show === 'review' && list.length > 0 && <>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setChosen(new Set(list.map(r => r.host_name)))}>Select all</button>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || !chosen.size} onClick={apply}>Apply {chosen.size || ''} to assets</button>
      </>}
    </div>
    {!rows.length ? <p className="text-muted">No devices yet. Set up the connection above and press Sync now.</p> : !list.length ? <p className="text-muted">Nothing here.</p> :
      <div className="table-wrap"><table>
        <thead><tr>{show === 'review' && <th scope="col"><span className="sr-only">Choose</span></th>}<th scope="col">Hostname</th><th scope="col">Grafana says</th><th scope="col">Asset</th><th scope="col">Status</th></tr></thead>
        <tbody>{list.map(row => <tr key={row.host_name}>
          {show === 'review' && <td><input type="checkbox" aria-label={`Apply ${row.host_name}`} checked={chosen.has(row.host_name)} onChange={() => toggle(row.host_name)} /></td>}
          <td>{row.host_name}</td>
          <td className="text-sm">{row.model || '—'}<div>{row.proposed_version || row.version_label || '—'}{row.build && !row.take && <span className="text-muted"> · build {row.build} (take not listed)</span>}</div></td>
          <td className="text-sm">{row.asset ? <>{row.asset.customer_name}: {row.asset.name}{row.linked && <span className="text-muted"> (linked)</span>}</> : row.status === 'ignored' ? '—' : <LinkDevice row={row} onDone={load} />}</td>
          <td className="text-sm"><strong>{STATUS[row.status]}</strong>{row.changes?.map(c => <div key={c.field}>{c.field === 'model' ? 'Model' : 'Version'}: {c.from || '—'} → {c.to}</div>)}</td>
        </tr>)}</tbody>
      </table></div>}
  </section>;
}

export function GrafanaTab() {
  const [settings, setSettings] = useState(null), [error, setError] = useState(null);
  const load = useCallback(() => api.grafanaSettings().then(setSettings).catch(setError), []);
  useEffect(() => { load(); }, [load]);
  if (error && !settings) return <LoadError what="Grafana settings" error={error} onRetry={load} />;
  if (!settings) return <p className="text-muted" role="status">Loading…</p>;
  const last = settings.last_result;
  return <div>
    <p className="text-muted text-sm">Check Point devices from Grafana (Prometheus): hostname, model, version and Jumbo Hotfix, matched to customer assets by hostname. Applying a difference updates the asset and counts as a device review.</p>
    {last && <p className={`text-sm ${last.ok ? '' : 'text-danger'}`} role="status">Last sync {fmtDateTime(settings.last_sync_at)}: {last.ok ? `${last.devices} devices, ${last.differs} to review, ${last.unmatched} not matched, ${last.unknown_takes} builds without a take${last.applied ? `, ${last.applied} applied` : ''}.` : last.error}</p>}
    <Connection settings={settings} onSaved={setSettings} />
    <Takes key={JSON.stringify(settings.take_map)} settings={settings} onSaved={setSettings} />
    <Review onSynced={load} />
  </div>;
}
