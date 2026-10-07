import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { api } from '../api';
import { Field, Surface } from '../components/EnterpriseUI';
import { Modal, fmtDateTime } from '../components/Shared';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';

/* Software versions → Products and feeds (managers). Where each product's
   versions come from, versions entered by hand, and vendor RSS feeds. */

const SOURCES = [
  ['fortinet', 'Fortinet documentation', 'The latest patch per version line, from docs.fortinet.com.'],
  ['checkpoint', 'Check Point Jumbo Hotfix', 'The latest and recommended Jumbo take per version, from Check Point\'s Jumbo documentation.'],
  ['endoflife', 'endoflife.date', 'Version lines with support and end-of-life dates (and often the latest patch) for hundreds of products: PAN-OS, Cisco IOS XE, ESXi, Windows Server, Veeam…'],
  ['manual', 'Entered by hand', 'You type the latest versions; for products no source covers.'],
];
const FORTINET = {
  FortiOS: { product: 'fortigate', document: 'fortios-release-notes', eol_slug: 'fortios' },
  FortiManager: { product: 'fortimanager', document: 'release-notes', branches: '7.4, 7.6' },
  FortiAnalyzer: { product: 'fortianalyzer', document: 'release-notes', branches: '7.4, 7.6' },
  FortiSwitchOS: { product: 'fortiswitch', document: 'fortiswitchos-release-notes', branches: '7.4, 7.6' },
  FortiAP: { product: 'fortiap', document: 'fortiap-release-notes', branches: '7.4, 7.6' },
};
const list = value => String(value || '').split(',').map(item => item.trim()).filter(Boolean);

function toForm(product) {
  const c = product?.config || {};
  return { name: product?.name || '', vendor: product?.vendor || '', source: product?.source || 'fortinet', enabled: product ? product.enabled : true,
    asset_vendor: product?.asset_vendor || '', asset_model: product?.asset_model || '', slug: c.slug || '', include_old: !!c.include_old,
    product: c.product || 'fortigate', document: c.document || 'fortios-release-notes', branches: (c.branches || []).join(', '), eol_slug: c.eol_slug ?? (product ? '' : 'fortios'),
    versions: (c.versions || ['R81.20', 'R82']).join(', ') };
}
function payload(form) {
  const config = form.source === 'endoflife' ? { slug: form.slug.trim(), include_old: form.include_old }
    : form.source === 'fortinet' ? { product: form.product.trim(), document: form.document.trim(), branches: list(form.branches), ...(form.eol_slug.trim() ? { eol_slug: form.eol_slug.trim() } : {}) }
      : form.source === 'checkpoint' ? { versions: list(form.versions).map(v => v.toUpperCase()) } : {};
  return { name: form.name, vendor: form.vendor || null, source: form.source, config, asset_vendor: form.asset_vendor || null, asset_model: form.asset_model || null, enabled: form.enabled };
}

function ProductDialog({ product, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(() => toForm(product)), [busy, setBusy] = useState(false), [error, setError] = useState(''), [catalogue, setCatalogue] = useState(null);
  const set = key => event => setForm(current => ({ ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));
  useEffect(() => {
    if (form.source === 'endoflife' && !catalogue) api.softwareCatalogue().then(result => setCatalogue(result.rows)).catch(failure => setError(failure.message));
  }, [form.source, catalogue]);
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = product ? await api.updateSoftwareProduct(product.id, payload(form)) : await api.createSoftwareProduct(payload(form));
      if (result.check_error) toast.error(`Saved, but the first check failed: ${result.check_error}`); else toast.success(product ? 'Product saved' : 'Product added and checked');
      onSaved();
    } catch (failure) { setError(failure.message); setBusy(false); }
  }
  return <Modal title={product ? `Edit ${product.name}` : 'Follow a product'} onClose={busy ? () => {} : onClose} width={720}
    footer={<><button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" form="sv-product-form" className="btn btn-primary" disabled={busy}>{busy ? 'Saving and checking…' : 'Save'}</button></>}>
    <form id="sv-product-form" className="sv-form" onSubmit={save}>
      {error && <div className="error-msg is-wide" role="alert">{error}</div>}
      <Field label="Where its versions come from" required className="is-wide"><select value={form.source} onChange={set('source')}>{SOURCES.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></Field>
      <p className="text-muted text-sm is-wide">{SOURCES.find(([key]) => key === form.source)?.[2]}</p>
      {form.source === 'fortinet' && <Field label="Fortinet product" className="is-wide"><select value="" onChange={event => {
        const preset = FORTINET[event.target.value]; if (!preset) return;
        setForm(current => ({ ...current, name: current.name || event.target.value, vendor: current.vendor || 'Fortinet', asset_vendor: current.asset_vendor || 'Fortinet', product: preset.product, document: preset.document, branches: preset.branches || '', eol_slug: preset.eol_slug || '' }));
      }}><option value="">Choose to fill in…</option>{Object.keys(FORTINET).map(name => <option key={name}>{name}</option>)}</select></Field>}
      <Field label="Name" required><input value={form.name} onChange={set('name')} maxLength={120} required placeholder="FortiOS" /></Field>
      <Field label="Vendor"><input value={form.vendor} onChange={set('vendor')} maxLength={80} placeholder="Fortinet" /></Field>
      {form.source === 'fortinet' && <>
        <Field label="docs.fortinet.com product" required><input value={form.product} onChange={set('product')} placeholder="fortigate" /></Field>
        <Field label="Release-notes document" required><input value={form.document} onChange={set('document')} placeholder="fortios-release-notes" /></Field>
        <Field label="Version lines" help="Comma separated, e.g. 7.2, 7.4, 7.6. Leave empty to follow every supported one from endoflife.date."><input value={form.branches} onChange={set('branches')} placeholder="7.4, 7.6" /></Field>
        <Field label="endoflife.date product, for support dates" help="fortios for FortiOS; empty if none."><input value={form.eol_slug} onChange={set('eol_slug')} placeholder="fortios" /></Field>
      </>}
      {form.source === 'checkpoint' && <Field label="Versions" required className="is-wide" help="Comma separated, e.g. R81.10, R81.20, R82, R82.10"><input value={form.versions} onChange={set('versions')} required /></Field>}
      {form.source === 'endoflife' && <>
        <Field label="endoflife.date product" required className="is-wide" help={catalogue ? `${catalogue.length} products; type to search.` : 'Loading the list…'}>
          <input list="sv-catalogue" value={form.slug} onChange={event => { const value = event.target.value; const found = catalogue?.find(item => item.slug === value); setForm(current => ({ ...current, slug: value, name: current.name || found?.label || '' })); }} required placeholder="panos" />
          <datalist id="sv-catalogue">{(catalogue || []).map(item => <option key={item.slug} value={item.slug}>{item.label}</option>)}</datalist></Field>
        <label className="sv-check is-wide"><input type="checkbox" checked={form.include_old} onChange={set('include_old')} /> Also show version lines that reached end of life more than a year ago</label>
      </>}
      <Field label="Asset vendor" help="How customer assets name it, for matching later."><input value={form.asset_vendor} onChange={set('asset_vendor')} maxLength={120} /></Field>
      <Field label="Asset model (optional)"><input value={form.asset_model} onChange={set('asset_model')} maxLength={120} placeholder="FortiGate" /></Field>
      <label className="sv-check is-wide"><input type="checkbox" checked={form.enabled} onChange={set('enabled')} /> Shown on the page and checked every morning</label>
    </form>
  </Modal>;
}

function ManualVersions({ product, onChanged }) {
  const toast = useToast();
  const empty = { branch: '', latest_version: '', latest_date: '', recommended_version: '', support_end: '', eol: '', link: '', note: '' };
  const [form, setForm] = useState(empty), [busy, setBusy] = useState(false);
  const set = key => event => setForm(current => ({ ...current, [key]: event.target.value }));
  async function save(event) {
    event.preventDefault(); setBusy(true);
    try { await api.saveSoftwareRelease(product.id, form); toast.success(`${product.name} ${form.branch} saved`); setForm(empty); onChanged(); }
    catch (failure) { toast.error(failure.message); } finally { setBusy(false); }
  }
  return <div className="sv-manual">
    {product.releases.length > 0 && <ul>{product.releases.map(release => <li key={release.branch}>
      <strong>{release.branch}</strong>: {release.latest_version}{release.recommended_version ? ` (recommended ${release.recommended_version})` : ''}
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm({ ...empty, ...Object.fromEntries(Object.entries(release).filter(([key]) => key in empty).map(([key, value]) => [key, value || ''])) })}><Pencil size={12} /> Edit</button>
      <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove ${release.branch}`} onClick={async () => { await api.deleteSoftwareRelease(product.id, release.branch); onChanged(); }}><Trash2 size={12} /></button>
    </li>)}</ul>}
    <form className="sv-manual-form" onSubmit={save}>
      <input aria-label="Version line" placeholder="Version line (e.g. 21.0)" value={form.branch} onChange={set('branch')} required maxLength={40} />
      <input aria-label="Latest version" placeholder="Latest version" value={form.latest_version} onChange={set('latest_version')} required maxLength={80} />
      <label><span>Released</span><input type="date" value={form.latest_date} onChange={set('latest_date')} /></label>
      <input aria-label="Recommended version" placeholder="Recommended (optional)" value={form.recommended_version} onChange={set('recommended_version')} maxLength={80} />
      <label><span>Support ends</span><input type="date" value={form.support_end} onChange={set('support_end')} /></label>
      <label><span>End of life</span><input type="date" value={form.eol} onChange={set('eol')} /></label>
      <input aria-label="Link" placeholder="https://… release notes (optional)" value={form.link} onChange={set('link')} maxLength={1000} />
      <input aria-label="Note" placeholder="Note (optional)" value={form.note} onChange={set('note')} maxLength={300} />
      <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>Save version</button>
    </form>
  </div>;
}

function FeedDialog({ feed, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: feed?.name || '', url: feed?.url || '', keywords: feed?.keywords || '', enabled: feed ? feed.enabled : true }), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const set = key => event => setForm(current => ({ ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = feed ? await api.updateSoftwareFeed(feed.id, form) : await api.createSoftwareFeed(form);
      if (result.error) toast.error(`Saved, but reading it failed: ${result.error}`); else toast.success(`Saved: ${result.items ?? 0} matching item${result.items === 1 ? '' : 's'}`);
      onSaved();
    } catch (failure) { setError(failure.message); setBusy(false); }
  }
  return <Modal title={feed ? `Edit ${feed.name}` : 'Add a news feed'} onClose={busy ? () => {} : onClose} width={620}
    footer={<><button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" form="sv-feed-form" className="btn btn-primary" disabled={busy}>{busy ? 'Reading…' : 'Save'}</button></>}>
    <form id="sv-feed-form" className="sv-form" onSubmit={save}>
      {error && <div className="error-msg is-wide" role="alert">{error}</div>}
      <Field label="Name" required><input value={form.name} onChange={set('name')} required maxLength={120} placeholder="Fortinet PSIRT" /></Field>
      <Field label="RSS or Atom address" required><input value={form.url} onChange={set('url')} required maxLength={1000} placeholder="https://…" /></Field>
      <Field label="Only items mentioning" className="is-wide" help="Comma separated; an item is kept if its title or summary has any of them. Empty keeps everything."><input value={form.keywords} onChange={set('keywords')} maxLength={500} placeholder="FortiOS, Jumbo, R81.20" /></Field>
      <label className="sv-check is-wide"><input type="checkbox" checked={form.enabled} onChange={set('enabled')} /> Read every morning</label>
    </form>
  </Modal>;
}

export default function SoftwareAdmin({ onChanged }) {
  const toast = useToast(), confirm = useConfirm();
  const [data, setData] = useState(null), [error, setError] = useState(''), [editing, setEditing] = useState(undefined), [feedEditing, setFeedEditing] = useState(undefined), [busy, setBusy] = useState('');
  const load = useCallback(async () => { try { setData(await api.softwareAdmin()); setError(''); } catch (failure) { setError(failure.message); } }, []);
  useEffect(() => { load(); }, [load]);
  const changed = () => { load(); onChanged(); };
  async function check(product) {
    setBusy(`check-${product.id}`);
    try { const result = await api.checkSoftwareProduct(product.id); toast.success(`${product.name}: ${result.releases} version line${result.releases === 1 ? '' : 's'} read${result.new_versions ? `, ${result.new_versions} new` : ''}`); changed(); }
    catch (failure) { toast.error(failure.message); changed(); } finally { setBusy(''); }
  }
  async function remove(kind, item) {
    if (!await confirm(`Stop following ${item.name}?`, { title: kind === 'feed' ? 'Remove feed' : 'Remove product' })) return;
    try { if (kind === 'feed') await api.deleteSoftwareFeed(item.id); else await api.deleteSoftwareProduct(item.id); changed(); } catch (failure) { toast.error(failure.message); }
  }
  if (error) return <div className="error-msg" role="alert">{error}</div>;
  if (!data) return <p className="text-muted">Loading settings…</p>;
  return <div className="sv-admin">
    <Surface title="Products" description="What the page follows, and where each one's versions come from." actions={<button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing(null)}><Plus size={13} /> Follow a product</button>}>
      <div className="table-wrap"><table className="sv-table">
        <thead><tr><th scope="col">Product</th><th scope="col">Source</th><th scope="col">Last check</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{data.products.map(product => <tr key={product.id}>
          <td><strong>{product.name}</strong>{!product.enabled && <small className="sv-sub">Hidden</small>}
            {product.source === 'manual' && <ManualVersions product={product} onChanged={changed} />}</td>
          <td className="text-sm">{SOURCES.find(([key]) => key === product.source)?.[1]}<small className="sv-sub">{product.source === 'checkpoint' ? product.config.versions?.join(', ') : product.source === 'fortinet' ? (product.config.branches?.join(', ') || `supported lines (${product.config.eol_slug})`) : product.config.slug || ''}</small></td>
          <td className="text-sm">{product.last_checked_at ? fmtDateTime(product.last_checked_at) : '—'}{product.last_error && <small className="sv-sub text-danger">{product.last_error}</small>}</td>
          <td><div className="sv-actions">
            {product.source !== 'manual' && <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => check(product)}><RefreshCw size={12} /> {busy === `check-${product.id}` ? 'Checking…' : 'Check'}</button>}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(product)}><Pencil size={12} /> Edit</button>
            <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove ${product.name}`} onClick={() => remove('product', product)}><Trash2 size={12} /></button>
          </div></td>
        </tr>)}</tbody>
      </table></div>
    </Surface>
    <Surface title="News feeds" description="RSS or Atom feeds from vendors; only items with your keywords are shown." actions={<button type="button" className="btn btn-primary btn-sm" onClick={() => setFeedEditing(null)}><Plus size={13} /> Add a feed</button>}>
      {!data.feeds.length ? <p className="text-muted text-sm">No feeds yet.</p> : <div className="table-wrap"><table className="sv-table">
        <thead><tr><th scope="col">Feed</th><th scope="col">Keywords</th><th scope="col">Last read</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{data.feeds.map(feed => <tr key={feed.id}>
          <td><strong>{feed.name}</strong><small className="sv-sub">{feed.url}</small></td>
          <td className="text-sm">{feed.keywords || <span className="text-muted">Everything</span>}</td>
          <td className="text-sm">{feed.last_checked_at ? fmtDateTime(feed.last_checked_at) : '—'}{feed.last_error && <small className="sv-sub text-danger">{feed.last_error}</small>}</td>
          <td><div className="sv-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFeedEditing(feed)}><Pencil size={12} /> Edit</button>
            <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove ${feed.name}`} onClick={() => remove('feed', feed)}><Trash2 size={12} /></button>
          </div></td>
        </tr>)}</tbody>
      </table></div>}
    </Surface>
    {editing !== undefined && <ProductDialog product={editing} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); changed(); }} />}
    {feedEditing !== undefined && <FeedDialog feed={feedEditing} onClose={() => setFeedEditing(undefined)} onSaved={() => { setFeedEditing(undefined); changed(); }} />}
  </div>;
}
