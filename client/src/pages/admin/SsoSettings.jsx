import { useEffect, useState } from 'react';
import { Copy, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../../components/Toast';
import { fmtDateTime } from '../../components/Shared';
import { Toggle } from './shared';

/* Settings → Sign-in & passwords → Microsoft 365 sign-in (Entra ID, SAML).
   Passwords keep working alongside it. */

function CopyField({ label, value }) {
  const toast = useToast();
  return <div className="sso-copy"><span>{label}</span><code>{value}</code>
    <button type="button" className="btn btn-ghost btn-sm" aria-label={`Copy ${label}`} onClick={() => navigator.clipboard?.writeText(value).then(() => toast.success('Copied'), () => {})}><Copy size={13} /></button></div>;
}

export function SsoSettings() {
  const toast = useToast();
  const [data, setData] = useState(null), [error, setError] = useState(''), [saving, setSaving] = useState(false), [manual, setManual] = useState(false);
  const [form, setForm] = useState({ metadata_url: '', entry_point: '', idp_issuer: '', certificate: '', sp_entity_id: '', button_label: '' });
  const load = view => { setData(view); setForm({ metadata_url: view.metadata_url, entry_point: view.entry_point, idp_issuer: view.idp_issuer, certificate: '', sp_entity_id: view.sp_entity_id, button_label: view.button_label }); setManual(!view.metadata_url && !!view.entry_point); };
  useEffect(() => { api.ssoSettings().then(load).catch(failure => setError(failure.message)); }, []);
  const set = key => event => setForm(current => ({ ...current, [key]: event.target.value }));
  async function save(extra = {}) {
    setSaving(true);
    try {
      const body = { sp_entity_id: form.sp_entity_id, button_label: form.button_label, ...(manual ? { entry_point: form.entry_point, idp_issuer: form.idp_issuer, metadata_url: '', ...(form.certificate.trim() ? { certificate: form.certificate } : {}) } : { metadata_url: form.metadata_url }), ...extra };
      load(await api.saveSsoSettings(body));
      toast.success(extra.enabled === true ? 'Microsoft sign-in is on' : extra.enabled === false ? 'Microsoft sign-in is off' : 'Saved');
    } catch (failure) { toast.error(failure.message); } finally { setSaving(false); }
  }
  async function refresh() {
    try { load(await api.refreshSsoMetadata()); toast.success('Entra metadata read again'); } catch (failure) { toast.error(failure.message); }
  }
  if (error) return <div className="error-msg" role="alert">{error}</div>;
  if (!data) return <p className="text-muted">Loading…</p>;
  return <section className="card sso-settings" aria-labelledby="sso-title">
    <header><h3 id="sso-title"><ShieldCheck size={16} /> Microsoft 365 sign-in</h3>
      <Toggle checked={data.enabled} disabled={saving} onChange={value => save({ enabled: value })} label={data.enabled ? 'On' : 'Off'} /></header>
    <p className="text-sm text-muted">People sign in with their work account through Microsoft Entra ID (SAML), including Microsoft's MFA. Their email in Entra must match their account here. Passwords keep working, so you can still sign in if Entra is unavailable.</p>
    {!data.app_url_set && <div className="alert alert-danger">APP_URL is not set on the server. Entra sends sign-ins back to that address, so set it first.</div>}

    <h4>1. In Entra</h4>
    <p className="text-sm">Entra admin centre → Enterprise applications → New application → Create your own application (non-gallery) → Single sign-on → SAML. Under <em>Basic SAML Configuration</em> enter:</p>
    <CopyField label="Identifier (Entity ID)" value={form.sp_entity_id || data.sp_entity_id} />
    <CopyField label="Reply URL (Assertion Consumer Service URL)" value={data.acs_url} />
    <p className="text-sm text-muted">Keep the default claims (the email address is sent as the user's name). Then under <em>Users and groups</em>, assign the people who may sign in. <a href={data.metadata_url_sp} target="_blank" rel="noreferrer">This app's metadata</a> can be uploaded instead of typing the two values.</p>
    <label className="sso-field"><span>Identifier, if you entered a different one in Entra</span><input value={form.sp_entity_id} onChange={set('sp_entity_id')} placeholder={data.sp_entity_id} /></label>

    <h4>2. Back here</h4>
    {!manual ? <>
      <label className="sso-field"><span>App Federation Metadata Url (from Entra's <em>SAML Certificates</em> section)</span>
        <input value={form.metadata_url} onChange={set('metadata_url')} placeholder="https://login.microsoftonline.com/…/federationmetadata/2007-06/federationmetadata.xml?appid=…" /></label>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setManual(true)}>Enter the details by hand instead</button>
    </> : <>
      <label className="sso-field"><span>Login URL</span><input value={form.entry_point} onChange={set('entry_point')} placeholder="https://login.microsoftonline.com/…/saml2" /></label>
      <label className="sso-field"><span>Microsoft Entra Identifier</span><input value={form.idp_issuer} onChange={set('idp_issuer')} placeholder="https://sts.windows.net/…/" /></label>
      <label className="sso-field"><span>Certificate (Base64){data.certificates.length ? ', only to replace the current one' : ''}</span><textarea rows={4} value={form.certificate} onChange={set('certificate')} placeholder="-----BEGIN CERTIFICATE-----" /></label>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setManual(false)}>Use the metadata URL instead</button>
    </>}
    <label className="sso-field"><span>Button text on the sign-in page</span><input value={form.button_label} onChange={set('button_label')} maxLength={60} /></label>
    <div className="sso-actions"><button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={() => save()}>{saving ? 'Saving…' : 'Save'}</button>
      {data.metadata_url && <button type="button" className="btn btn-ghost btn-sm" onClick={refresh}><RefreshCw size={13} /> Read metadata again</button>}</div>

    {data.certificates.length > 0 && <div className="sso-status">
      <p className="text-sm"><strong>Signing from:</strong> {data.entry_point}</p>
      {data.certificates.map(cert => <p className="text-sm" key={cert.fingerprint}>Certificate {cert.fingerprint.slice(0, 23)}…, valid until {cert.expires ? fmtDateTime(cert.expires) : 'unknown'}</p>)}
      {data.metadata_fetched_at && <p className="text-sm text-muted">Metadata read {fmtDateTime(data.metadata_fetched_at)}; it is read again daily, so a renewed Entra certificate is picked up.</p>}
      {data.ready ? <p className="text-sm">{data.enabled ? 'Sign in with Microsoft is shown on the sign-in page.' : 'Ready. Turn it on above to show it on the sign-in page.'}</p> : null}
    </div>}
  </section>;
}
