import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ExternalLink, RefreshCw, ShieldAlert, Trash2, Eye, EyeOff, Plus } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../App';
import { PageHeader } from '../components/PageLayout';
import { ListSearch } from '../components/ListWorkspace';
import { MetricStrip, Pagination, Surface, Tabs, ToneBadge } from '../components/EnterpriseUI';
import { fmtDate, fmtDateTime, Modal } from '../components/Shared';
import { useToast } from '../components/Toast';
import { useLiveVersion } from '../live';
import './Vulnerabilities.css';

/* CVEs for the vendors and products we support (NVD), flagged when CISA lists
   them as exploited, with the customer devices that run an affected version. */

const SEVERITY_TONE = { critical: 'danger', high: 'warning', medium: 'info', low: 'neutral' };
const label = value => (value ? value[0].toUpperCase() + value.slice(1) : 'Not rated');
const productName = item => item.replace(/_/g, ' ').replace(':', ' · ');

function Severity({ severity, score }) {
  return <ToneBadge tone={SEVERITY_TONE[severity] || 'neutral'}>{label(severity)}{score != null ? ` ${Number(score).toFixed(1)}` : ''}</ToneBadge>;
}

function SyncNote({ sync }) {
  if (!sync) return null;
  if (sync.running) return <p className="vuln-sync">Downloading the latest CVEs…</p>;
  if (!sync.at) return <p className="vuln-sync">No CVEs downloaded yet. The first download runs shortly after the server starts.</p>;
  return <p className="vuln-sync">Updated {fmtDateTime(sync.at)} from NVD and CISA{sync.result?.errors ? `, with ${sync.result.errors} problem${sync.result.errors === 1 ? '' : 's'} (see Watched products)` : ''}.</p>;
}

/* What a CVE entry says about versions, in words. */
function versionRange(entry) {
  const parts = [];
  if (entry.si) parts.push(`from ${entry.si}`);
  if (entry.se) parts.push(`after ${entry.se}`);
  if (entry.ei) parts.push(`up to ${entry.ei}`);
  if (entry.ee) parts.push(`before ${entry.ee}`);
  if (parts.length) return parts.join(' ');
  return entry.version && !['*', '-'].includes(entry.version) ? entry.version : 'all versions';
}

function CveDetail({ id, onClose }) {
  const [data, setData] = useState(null), [error, setError] = useState('');
  useEffect(() => { const controller = new AbortController(); api.vulnerability(id, { signal: controller.signal }).then(setData).catch(failure => { if (!controller.signal.aborted) setError(failure.message); }); return () => controller.abort(); }, [id]);
  const byProduct = new Map();
  for (const entry of data?.entries || []) { const key = `${entry.vendor}:${entry.product}`; if (!byProduct.has(key)) byProduct.set(key, []); byProduct.get(key).push(versionRange(entry)); }
  return <Modal title={id} onClose={onClose} wide>
    {error ? <div className="error-msg" role="alert">{error}</div> : !data ? <div className="skeleton-table"><span /><span /></div> : <div className="vuln-detail">
      <div className="vuln-detail-head"><Severity severity={data.severity} score={data.cvss_score} />{data.kev && <ToneBadge tone="danger">Known exploited</ToneBadge>}<span className="text-muted text-sm">Published {fmtDate(data.published)}{data.last_modified ? `, updated ${fmtDate(data.last_modified)}` : ''}</span></div>
      <p>{data.description}</p>
      {data.kev && <section className="vuln-kev"><h3>Being exploited (CISA)</h3><p>{data.kev.name}</p><p><strong>What to do:</strong> {data.kev.required_action}</p><p className="text-sm">Listed {fmtDate(data.kev.date_added)}; US federal deadline {fmtDate(data.kev.due_date)}{data.kev.ransomware === 'Known' ? '. Used in ransomware campaigns.' : '.'}</p></section>}
      <section><h3>Our customers' devices</h3>
        {!data.affected.length ? <p className="text-muted text-sm">None of the devices you can see run an affected version, or their product has not been set under Products &amp; versions.</p> :
          <table className="vuln-table"><thead><tr><th>Customer</th><th>Device</th><th>Version</th><th>Result</th></tr></thead><tbody>{data.affected.map(item => <tr key={item.asset_id}>
            <td><Link to={`/customers/${item.customer_id}/service-profile?section=assets`}>{item.customer_name}</Link></td><td>{item.asset_name}<div className="text-muted text-sm">{item.vendor} {item.model}</div></td><td>{item.version || 'Not recorded'}</td>
            <td>{item.verdict === 'yes' ? <ToneBadge tone="danger">Affected</ToneBadge> : <ToneBadge tone="warning">Check</ToneBadge>}</td></tr>)}</tbody></table>}
        {data.affected.some(item => item.verdict !== 'yes') && <p className="text-muted text-sm">"Check" means NVD does not say which versions are affected, or the device has no version recorded.</p>}
      </section>
      {byProduct.size > 0 && <section><h3>Affected versions</h3><ul className="vuln-ranges">{[...byProduct].map(([product, ranges]) => <li key={product}><strong>{productName(product)}</strong>: {[...new Set(ranges)].join('; ')}</li>)}</ul></section>}
      {data.cvss_vector && <p className="text-muted text-sm">CVSS {data.cvss_version}: <code>{data.cvss_vector}</code></p>}
      <section><h3>References</h3><ul className="vuln-refs"><li><a href={data.nvd_url} target="_blank" rel="noreferrer">NVD entry <ExternalLink size={12} /></a></li>{data.references.map(ref => <li key={ref.url}><a href={ref.url} target="_blank" rel="noreferrer noopener">{ref.url.replace(/^https?:\/\//, '').slice(0, 90)} <ExternalLink size={12} /></a>{ref.tags?.length ? <span className="text-muted text-sm"> {ref.tags.join(', ')}</span> : null}</li>)}</ul></section>
    </div>}
  </Modal>;
}

function CveList({ initialProduct, onOpen }) {
  const [filters, setFilters] = useState({ q: '', severity: '', kev: false, affected: '', product: initialProduct || '' });
  const [page, setPage] = useState(1), [data, setData] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const live = useLiveVersion();
  useEffect(() => setPage(1), [filters]);
  useEffect(() => setFilters(current => ({ ...current, product: initialProduct || '' })), [initialProduct]);
  useEffect(() => {
    const controller = new AbortController(), timer = setTimeout(() => {
      setLoading(true); setError('');
      const params = { page, page_size: 25, ...(filters.q.trim() ? { q: filters.q.trim() } : {}), ...(filters.severity ? { severity: filters.severity } : {}), ...(filters.kev ? { kev: '1' } : {}), ...(filters.affected ? { affected: filters.affected } : {}), ...(filters.product ? { product: filters.product } : {}) };
      api.vulnerabilities(params, { signal: controller.signal }).then(setData).catch(failure => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [filters, page, live]);
  const set = (key, value) => setFilters(current => ({ ...current, [key]: value }));
  const counts = data?.counts || {};
  return <>
    <MetricStrip items={[
      { label: 'CVEs for our products', value: counts.all ?? '—' },
      { label: 'Critical', value: counts.critical ?? '—', tone: counts.critical ? 'danger' : 'success' },
      { label: 'Known exploited', value: counts.kev ?? '—', tone: counts.kev ? 'danger' : 'success' },
      { label: 'Affect our customers', value: counts.affected ?? '—', tone: counts.affected ? 'danger' : 'success' },
    ]} />
    <SyncNote sync={data?.sync} />
    <Surface label="CVE filters">
      <ListSearch value={filters.q} onChange={value => set('q', value)} label="Search CVEs" placeholder="Search CVE ID, product or description…" />
      <div className="vuln-filters">
        <div className="filter-bar" role="group" aria-label="Severity">{[['', 'All severities'], ['critical', 'Critical'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']].map(([value, text]) => <button key={value || 'all'} type="button" className={`filter-pill${filters.severity === value ? ' active' : ''}`} onClick={() => set('severity', value)}>{text}</button>)}</div>
        <label className="vuln-check"><input type="checkbox" checked={filters.kev} onChange={event => set('kev', event.target.checked)} /> Known exploited only</label>
        <label className="vuln-check"><span>Our customers</span><select value={filters.affected} onChange={event => set('affected', event.target.value)}><option value="">Any</option><option value="1">Affected</option><option value="check">Affected or to check</option></select></label>
        {filters.product && <span className="filter-pill active">{productName(filters.product)} <button type="button" className="btn btn-ghost btn-sm" aria-label="Show every product" onClick={() => set('product', '')}>×</button></span>}
      </div>
    </Surface>
    {error ? <div className="error-msg" role="alert">{error}</div> : loading && !data ? <div className="skeleton-table"><span /><span /><span /></div> : !data.rows.length ? <div className="card empty"><p>{data.counts.all ? 'No CVEs match these filters.' : 'No CVEs yet. They appear after the first download from NVD.'}</p></div> :
      <div className="card table-wrap"><table className="vuln-table"><thead><tr><th>CVE</th><th>Severity</th><th>Products</th><th>Our customers</th><th>Summary</th></tr></thead><tbody>
        {data.rows.map(row => <tr key={row.id} className={row.affected_assets ? 'is-affected' : ''}>
          <td><button type="button" className="vuln-id" onClick={() => onOpen(row.id)}>{row.id}</button><div className="text-muted text-sm">{fmtDate(row.published)}</div>{row.kev && <ToneBadge tone="danger">Exploited</ToneBadge>}</td>
          <td><Severity severity={row.severity} score={row.cvss_score} /></td>
          <td className="text-sm">{row.products.slice(0, 3).map(productName).join(', ')}{row.products.length > 3 ? ` +${row.products.length - 3}` : ''}</td>
          <td>{row.affected_assets ? <strong className="vuln-hit">{row.affected_assets} device{row.affected_assets === 1 ? '' : 's'}, {row.affected_customers} customer{row.affected_customers === 1 ? '' : 's'}</strong> : row.check_assets ? <span className="text-muted">{row.check_assets} to check</span> : <span className="text-muted">None</span>}</td>
          <td className="text-sm vuln-summary">{row.description}</td>
        </tr>)}
      </tbody></table></div>}
    {data && <Pagination page={page} total={data.total} pageSize={25} loading={loading} onPageChange={setPage} label="CVE pages" />}
  </>;
}

function ProductMapping({ group, onSaved }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false), [vendor, setVendor] = useState(group.product?.vendor || group.suggested_vendor), [product, setProduct] = useState(group.product?.product || ''), [scope, setScope] = useState(group.product_scope || 'model');
  async function save(clear = false) {
    try {
      await api.setVulnerabilityAssetProduct({ asset_vendor: group.vendor, asset_model: scope === 'vendor' ? '' : group.model, cpe_vendor: vendor, cpe_product: clear ? null : product });
      toast.success(clear ? 'Product cleared' : 'Product set. Its CVEs download with the next sync.'); setEditing(false); onSaved();
    } catch (failure) { toast.error(failure.message); }
  }
  if (!editing) return <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>{group.product ? 'Change product' : 'Set product'}</button>;
  return <div className="vuln-mapping">
    <label><span>NVD vendor</span><input value={vendor} onChange={event => setVendor(event.target.value.toLowerCase())} /></label>
    <label><span>NVD product</span><input list={`products-${group.vendor}-${group.model}`} value={product} onChange={event => setProduct(event.target.value.toLowerCase())} placeholder="for example fortios" />
      <datalist id={`products-${group.vendor}-${group.model}`}>{group.known_products.map(name => <option key={name} value={name} />)}</datalist></label>
    <label><span>Applies to</span><select value={scope} onChange={event => setScope(event.target.value)}><option value="model">{group.model || 'Devices with no model'}</option><option value="vendor">Every {group.vendor} device</option></select></label>
    <div className="vuln-mapping-actions"><button type="button" className="btn btn-primary btn-sm" disabled={!product.trim()} onClick={() => save()}>Save</button>{group.product && <button type="button" className="btn btn-ghost btn-sm" onClick={() => save(true)}>Clear</button>}<button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button></div>
    <p className="text-muted text-sm">The product's name in NVD (cpe:2.3:…:<em>vendor</em>:<em>product</em>). Names seen for this vendor are suggested.</p>
  </div>;
}

function ProductsVersions({ canManage, onShowProduct }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [version, setVersion] = useState(0), [open, setOpen] = useState(null);
  const live = useLiveVersion();
  useEffect(() => { const controller = new AbortController(); setError(''); api.vulnerabilityProducts({ signal: controller.signal }).then(setData).catch(failure => { if (!controller.signal.aborted) setError(failure.message); }); return () => controller.abort(); }, [version, live]);
  if (error) return <div className="error-msg" role="alert">{error}</div>;
  if (!data) return <div className="skeleton-table"><span /><span /><span /></div>;
  if (!data.groups.length) return <div className="card empty"><p>No customer devices with a vendor recorded{canManage ? '. Add the vendor, model and software version to customers\' assets to see them here.' : ' for the customers you can see.'}</p></div>;
  return <div className="vuln-products">
    {data.groups.map(group => <section className="card vuln-product" key={`${group.vendor}|${group.model}`}>
      <header>
        <div><h3>{group.vendor} {group.model || <span className="text-muted">(no model)</span>}</h3><p className="text-muted text-sm">{group.asset_count} device{group.asset_count === 1 ? '' : 's'}{group.technology ? `, ${group.technology}` : ''}{group.product ? <>. Checked as <button type="button" className="vuln-link" onClick={() => onShowProduct(`${group.product.vendor}:${group.product.product}`)}>{productName(`${group.product.vendor}:${group.product.product}`)}</button>{group.product_scope === 'vendor' ? ` (all ${group.vendor} devices)` : ''}</> : '. Versions are not checked until its NVD product is set.'}</p></div>
        {canManage && <ProductMapping group={group} onSaved={() => setVersion(value => value + 1)} />}
      </header>
      <table className="vuln-table"><thead><tr><th>Version</th><th>Devices</th><th>CVEs affecting it</th></tr></thead><tbody>{group.versions.map(entry => {
        const key = `${group.vendor}|${group.model}|${entry.version}`;
        return <tr key={key}>
          <td>{entry.version || <span className="text-muted">Not recorded</span>}</td>
          <td><button type="button" className="vuln-link" aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)}>{entry.assets.length} device{entry.assets.length === 1 ? '' : 's'}</button>
            {open === key && <ul className="vuln-assets">{entry.assets.map(asset => <li key={asset.id}><Link to={`/customers/${asset.customer_id}/service-profile?section=assets`}>{asset.customer_name}</Link>: {asset.name}</li>)}</ul>}</td>
          <td>{!group.product ? <span className="text-muted">Not checked</span> : entry.cves.total ? <span className="vuln-counts">{entry.cves.critical > 0 && <ToneBadge tone="danger">{entry.cves.critical} critical</ToneBadge>}{entry.cves.high > 0 && <ToneBadge tone="warning">{entry.cves.high} high</ToneBadge>}{entry.cves.kev > 0 && <ToneBadge tone="danger">{entry.cves.kev} exploited</ToneBadge>}<span className="text-sm">{entry.cves.total} in total</span></span> : <span className="text-muted">None known{entry.cves.check ? `, ${entry.cves.check} to check` : ''}</span>}</td>
        </tr>;
      })}</tbody></table>
    </section>)}
  </div>;
}

function Watched() {
  const toast = useToast();
  const [data, setData] = useState(null), [error, setError] = useState(''), [version, setVersion] = useState(0), [key, setKey] = useState(''), [add, setAdd] = useState({ cpe_vendor: '', cpe_product: '' });
  const live = useLiveVersion();
  useEffect(() => { const controller = new AbortController(); api.vulnerabilityAdmin({ signal: controller.signal }).then(setData).catch(failure => { if (!controller.signal.aborted) setError(failure.message); }); return () => controller.abort(); }, [version, live]);
  const reload = () => setVersion(value => value + 1);
  const act = async (work, message) => { try { await work(); if (message) toast.success(message); reload(); } catch (failure) { toast.error(failure.message); } };
  if (error) return <div className="error-msg" role="alert">{error}</div>;
  if (!data) return <div className="skeleton-table"><span /><span /></div>;
  return <div className="vuln-admin">
    <Surface title="Download" actions={<button type="button" className="btn btn-primary btn-sm" disabled={data.sync.running} onClick={() => act(() => api.syncVulnerabilities(), 'Download started. It can take a few minutes; the page updates when it finishes.')}><RefreshCw size={13} /> {data.sync.running ? 'Downloading…' : 'Sync now'}</button>}>
      <SyncNote sync={data.sync} />
      <p className="text-sm">CVEs come from NIST's National Vulnerability Database; the Known Exploited list from CISA. Both are downloaded each morning.</p>
      <form className="vuln-key" onSubmit={event => { event.preventDefault(); act(() => api.saveVulnerabilitySettings({ nvd_api_key: key }), 'API key saved'); setKey(''); }}>
        <label><span>NVD API key (optional, makes downloads about ten times faster)</span><input type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} placeholder={data.nvd_api_key_set ? 'A key is saved. Enter a new one to replace it.' : 'Request one free at nvd.nist.gov/developers'} /></label>
        <button type="submit" className="btn btn-ghost btn-sm" disabled={!key.trim()}>Save key</button>
        {data.nvd_api_key_set && <button type="button" className="btn btn-ghost btn-sm" onClick={() => act(() => api.saveVulnerabilitySettings({ clear_nvd_api_key: true }), 'API key removed')}>Remove key</button>}
      </form>
    </Surface>
    <Surface title="Watched vendors and products" description="Vendors on customers' assets are added automatically. Add anything else you support; hide what is not relevant.">
      <form className="vuln-add" onSubmit={event => { event.preventDefault(); act(() => api.addVulnerabilityWatch(add), 'Added. Its CVEs download with the next sync.'); setAdd({ cpe_vendor: '', cpe_product: '' }); }}>
        <label><span>NVD vendor</span><input value={add.cpe_vendor} onChange={event => setAdd(current => ({ ...current, cpe_vendor: event.target.value.toLowerCase() }))} placeholder="for example veeam" required /></label>
        <label><span>NVD product (optional)</span><input value={add.cpe_product} onChange={event => setAdd(current => ({ ...current, cpe_product: event.target.value.toLowerCase() }))} placeholder="for example veeam_backup_&_replication" /></label>
        <button type="submit" className="btn btn-ghost btn-sm"><Plus size={13} /> Watch</button>
      </form>
      <table className="vuln-table"><thead><tr><th>Vendor</th><th>Product</th><th>From</th><th>CVEs</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
        {data.watch.map(row => <tr key={row.id} className={row.hidden ? 'is-hidden' : ''}>
          <td>{row.cpe_vendor}{row.asset_vendor && row.asset_vendor.toLowerCase() !== row.cpe_vendor ? <div className="text-muted text-sm">assets say "{row.asset_vendor}"</div> : null}</td>
          <td>{row.cpe_product || <span className="text-muted">All products</span>}</td>
          <td>{row.source === 'asset' ? 'Assets' : 'Added'}</td>
          <td>{row.total ?? '—'}</td>
          <td className="text-sm">{row.hidden ? 'Hidden' : row.last_status === 'ok' ? `Up to date${row.last_sync_at ? `, ${fmtDateTime(row.last_sync_at)}` : ''}` : row.last_status === 'too_broad' || row.last_status === 'error' ? <span className="vuln-error">{row.last_error}</span> : 'Waiting for the next sync'}</td>
          <td className="table-actions">
            {row.source === 'asset' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { const name = window.prompt(`NVD's name for the vendor your assets call "${row.asset_vendor}":`, row.cpe_vendor); if (name) act(() => api.updateVulnerabilityWatch(row.id, { cpe_vendor: name }), 'Vendor name updated'); }}>Rename</button>}
            <button type="button" className="btn btn-ghost btn-sm" aria-label={row.hidden ? `Show ${row.cpe_vendor}` : `Hide ${row.cpe_vendor}`} onClick={() => act(() => api.updateVulnerabilityWatch(row.id, { hidden: !row.hidden }))}>{row.hidden ? <Eye size={13} /> : <EyeOff size={13} />}</button>
            {row.source === 'manual' && <button type="button" className="btn btn-ghost btn-sm" aria-label={`Stop watching ${row.cpe_vendor} ${row.cpe_product}`} onClick={() => act(() => api.removeVulnerabilityWatch(row.id), 'Removed')}><Trash2 size={13} /></button>}
          </td>
        </tr>)}
        {!data.watch.length && <tr><td colSpan={6} className="text-muted">Nothing watched yet. Vendors from customers' assets appear after the first sync.</td></tr>}
      </tbody></table>
    </Surface>
  </div>;
}

export default function Vulnerabilities() {
  const { user } = useAuth(), location = useLocation(), navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const canManage = user.role === 'manager';
  const tabs = [{ key: 'cves', label: 'CVEs' }, { key: 'products', label: 'Products & versions' }, ...(canManage ? [{ key: 'watched', label: 'Watched products' }] : [])];
  const tab = tabs.some(item => item.key === params.get('tab')) ? params.get('tab') : 'cves';
  const go = (next, extra = {}) => { const search = new URLSearchParams({ ...(next !== 'cves' ? { tab: next } : {}), ...extra }); navigate({ search: search.toString() ? `?${search}` : '' }); };
  const cve = params.get('cve');
  return <div className="page vuln-page">
    <PageHeader title={<span className="flex-center gap-8"><ShieldAlert size={20} /> Vulnerabilities</span>} />
    <Tabs label="Vulnerability sections" items={tabs} value={tab} onChange={next => go(next)} />
    {tab === 'cves' && <CveList initialProduct={params.get('product') || ''} onOpen={id => go('cves', { ...(params.get('product') ? { product: params.get('product') } : {}), cve: id })} />}
    {tab === 'products' && <ProductsVersions canManage={canManage} onShowProduct={product => go('cves', { product })} />}
    {tab === 'watched' && canManage && <Watched />}
    {cve && <CveDetail id={cve} onClose={() => go(tab, params.get('product') ? { product: params.get('product') } : {})} />}
  </div>;
}
