import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, FolderSync, KeyRound, LockKeyhole, PlugZap, Save, ShieldCheck, XCircle } from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../../components/Toast';

/* Settings → Backups → Off-server copies: each backup encrypted (one passphrase
   for every destination) and copied to a network share mounted into the
   container and/or an SFTP server whose key the manager has trusted
   (server/backupOffsite.js). */

const when = iso => (iso ? new Date(iso).toLocaleString() : '');
const blank = { host: '', port: 22, username: '', auth_method: 'password', remote_dir: '/teamhub-backups', sftp_password: '', private_key: '', key_passphrase: '', password: '' };
const size = bytes => (bytes == null ? '' : bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`);

export function BackupOffsite({ onChanged }) {
  const toast = useToast();
  const [view, setView] = useState(null), [form, setForm] = useState(blank), [error, setError] = useState(''), [busy, setBusy] = useState(''), [tested, setTested] = useState(null);
  const fill = useCallback(v => { setView(v); setForm({ ...blank, host: v.host, port: v.port, username: v.username, auth_method: v.auth_method, remote_dir: v.remote_dir }); }, []);
  useEffect(() => { api.backupOffsite().then(fill).catch(failure => setError(failure.message)); }, [fill]);
  const set = key => event => setForm(current => ({ ...current, [key]: event.target.value }));
  const secretsTyped = ['sftp_password', 'private_key', 'key_passphrase'].some(key => form[key]);

  async function act(name, work, message) {
    setBusy(name); setError('');
    try { const result = await work(); if (message) toast.success(typeof message === 'function' ? message(result) : message); return result; }
    catch (failure) { setError(failure.message); return null; } finally { setBusy(''); }
  }
  async function save(extra = {}) {
    const body = { host: form.host, port: Number(form.port), username: form.username, auth_method: form.auth_method, remote_dir: form.remote_dir, ...extra };
    for (const key of ['sftp_password', 'private_key', 'key_passphrase']) if (form[key]) body[key] = form[key];
    if (secretsTyped) body.password = form.password;
    const saved = await act('save', () => api.saveBackupOffsite(body), extra.enabled === true ? 'Off-server copies are on' : extra.enabled === false ? 'Off-server copies are off' : 'Saved');
    if (saved) { fill(saved); setTested(null); onChanged?.(saved); }
  }
  async function test() {
    const result = await act('test', () => api.testBackupOffsite());
    if (result) setTested(result);
  }
  async function trust() {
    const saved = await act('trust', () => api.trustBackupOffsite(tested.fingerprint), 'Server key trusted');
    // Only now does TeamHub sign in, so test again to check the folder can be written.
    if (saved) { fill(saved); await test(); }
  }

  if (!view) return error ? <section className="card"><h3>Off-server copies</h3><p className="error-msg" role="alert">{error}</p></section> : null;
  const last = view.last;
  return <section className="card bk-offsite" aria-labelledby="bk-offsite-title">
    <h3 id="bk-offsite-title">Off-server copies (SFTP)</h3>
    <p className="text-sm text-muted">After each backup, an encrypted copy goes to your SFTP server. Copies past the retention above are removed from it.</p>
    {view.enabled && last && <p className={`text-sm ${last.ok ? 'bk-ok' : 'text-danger'}`} role="status">
      {last.ok ? <><CheckCircle2 size={13} /> Last copy {when(last.completed_at)}: {last.remote}</> : <><XCircle size={13} /> The last copy failed ({when(last.completed_at)}): {last.error}</>}
    </p>}
    {error && <div className="error-msg" role="alert">{error}</div>}
    <form onSubmit={event => { event.preventDefault(); save(); }} className="bk-offsite-form">
      <div className="form-row">
        <div className="form-group"><label htmlFor="off-host">SFTP host</label><input id="off-host" value={form.host} onChange={set('host')} placeholder="nas.example.local" maxLength={255} /></div>
        <div className="form-group bk-port"><label htmlFor="off-port">Port</label><input id="off-port" type="number" min="1" max="65535" value={form.port} onChange={set('port')} /></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label htmlFor="off-user">User</label><input id="off-user" value={form.username} onChange={set('username')} maxLength={100} autoComplete="off" /></div>
        <div className="form-group"><label htmlFor="off-dir">Folder on the server</label><input id="off-dir" value={form.remote_dir} onChange={set('remote_dir')} placeholder="/backups/teamhub" maxLength={500} /></div>
      </div>
      <fieldset className="bk-auth"><legend>Sign in with</legend>
        <label><input type="radio" name="off-auth" value="password" checked={form.auth_method === 'password'} onChange={set('auth_method')} /> Password</label>
        <label><input type="radio" name="off-auth" value="key" checked={form.auth_method === 'key'} onChange={set('auth_method')} /> Private key</label>
        {form.auth_method === 'password'
          ? <input type="password" aria-label="SFTP password" value={form.sftp_password} onChange={set('sftp_password')} placeholder={view.has_password ? 'Saved — type to replace' : 'SFTP password'} autoComplete="new-password" />
          : <><textarea aria-label="Private key" rows={4} value={form.private_key} onChange={set('private_key')} placeholder={view.has_private_key ? 'Saved — paste to replace' : '-----BEGIN OPENSSH PRIVATE KEY-----'} />
            <input type="password" aria-label="Key passphrase" value={form.key_passphrase} onChange={set('key_passphrase')} placeholder="Key passphrase, if it has one" autoComplete="new-password" /></>}
      </fieldset>
      {secretsTyped && <div className="form-group"><label htmlFor="off-confirm">Your TeamHub password</label><input id="off-confirm" type="password" value={form.password} onChange={set('password')} required autoComplete="current-password" /><small className="text-muted">Needed to change the stored secrets.</small></div>}
      <div className="bk-actions">
        <button type="submit" className="btn btn-ghost btn-sm" disabled={!!busy}><Save size={14} /> {busy === 'save' ? 'Saving…' : 'Save'}</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy || !view.host} onClick={test}><PlugZap size={14} /> {busy === 'test' ? 'Connecting…' : 'Test connection'}</button>
        {view.enabled
          ? <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => save({ enabled: false })}>Turn off</button>
          : <button type="button" className="btn btn-primary btn-sm" disabled={!!busy || !view.host_fingerprint || !view.has_passphrase} title={!view.has_passphrase ? 'Set the encryption passphrase first' : view.host_fingerprint ? undefined : 'Test the connection and trust the server key first'} onClick={() => save({ enabled: true })}>Turn on</button>}
      </div>
    </form>
    {tested && <div className={`alert ${tested.trusted ? 'alert-success' : 'alert-warning'} bk-fingerprint`} role="status">
      {tested.trusted
        ? <p><KeyRound size={14} /> Connected, and the folder can be written. The server&apos;s key is the trusted key <code>{tested.fingerprint}</code>.</p>
        : <p><KeyRound size={14} /> {tested.changed ? 'The server’s key has changed:' : 'The server’s key is'} <code>{tested.fingerprint}</code>. TeamHub has not signed in to it.</p>}
      {!tested.trusted && <>
        <p className="text-sm">Check it matches the server (e.g. <code>ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub</code> on it), then trust it. Copies only go to a server with this key.</p>
        <button type="button" className="btn btn-primary btn-sm" disabled={!!busy} onClick={trust}><ShieldCheck size={14} /> Trust this key</button>
      </>}
    </div>}
    {!tested && view.host_fingerprint && <p className="text-sm text-muted">Trusted server key: <code>{view.host_fingerprint}</code></p>}
  </section>;
}

/* The passphrase every off-server copy is encrypted with. */
export function CopyPassphrase({ onChanged }) {
  const toast = useToast();
  const [has, setHas] = useState(null), [value, setValue] = useState(''), [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { api.backupOffsite().then(v => setHas(v.has_passphrase)).catch(failure => setError(failure.message)); }, []);
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { const v = await api.saveBackupOffsite({ encryption_passphrase: value, password }); setHas(v.has_passphrase); setValue(''); setPassword(''); toast.success('Encryption passphrase saved'); onChanged?.(); }
    catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  if (has == null && !error) return null;
  return <section className="card bk-offsite" aria-labelledby="bk-pass-title">
    <h3 id="bk-pass-title"><LockKeyhole size={16} aria-hidden="true" /> Off-server copies: encryption</h3>
    <p className="text-sm text-muted">Copies sent to a network share or an SFTP server are encrypted with this passphrase. {has ? 'A passphrase is set.' : 'Set one before turning copies on.'}</p>
    {error && <div className="error-msg" role="alert">{error}</div>}
    <form onSubmit={save} className="bk-offsite-form">
      <div className="form-row">
        <div className="form-group"><label htmlFor="off-passphrase">Encryption passphrase</label><input id="off-passphrase" type="password" value={value} onChange={e => setValue(e.target.value)} placeholder={has ? 'Saved — type to replace' : 'At least 12 characters'} minLength={12} required autoComplete="new-password" /></div>
        <div className="form-group"><label htmlFor="off-pass-confirm">Your TeamHub password</label><input id="off-pass-confirm" type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" /></div>
      </div>
      <small className="text-muted">Keep it in your password manager, outside TeamHub: restoring a copy on a new server needs it (<code>node deploy/decrypt-backup.js</code>). A new passphrase applies to new copies only.</small>
      <div className="bk-actions"><button type="submit" className="btn btn-ghost btn-sm" disabled={busy || value.length < 12 || !password}><Save size={14} /> {busy ? 'Saving…' : has ? 'Change passphrase' : 'Save passphrase'}</button></div>
    </form>
  </section>;
}

/* Copies to a network share (SMB/NFS) mounted into the container. */
export function BackupShare({ onChanged, refreshKey }) {
  const toast = useToast();
  const [view, setView] = useState(null), [folder, setFolder] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(''), [tested, setTested] = useState(null);
  const load = useCallback(() => api.backupShare().then(v => { setView(v); setFolder(v.path); }).catch(failure => setError(failure.message)), []);
  useEffect(() => { load(); }, [load, refreshKey]);
  async function act(name, work, message) {
    setBusy(name); setError('');
    try { const result = await work(); if (message) toast.success(message); return result; }
    catch (failure) { setError(failure.message); return null; } finally { setBusy(''); }
  }
  async function save(extra = {}) {
    const saved = await act('save', () => api.saveBackupShare({ path: folder, ...extra }), extra.enabled === true ? 'Copies to the network share are on' : extra.enabled === false ? 'Copies to the network share are off' : 'Saved');
    if (saved) { setView(saved); setTested(null); onChanged?.(saved); }
  }
  if (!view) return error ? <section className="card"><h3>Network share</h3><p className="error-msg" role="alert">{error}</p></section> : null;
  const last = view.last;
  return <section className="card bk-offsite" aria-labelledby="bk-share-title">
    <h3 id="bk-share-title"><FolderSync size={16} aria-hidden="true" /> Network share</h3>
    <p className="text-sm text-muted">After each backup, an encrypted copy is written to a folder on your NAS or file server. Mount the share (SMB or NFS) into the TeamHub container under <code>{view.root}</code> first; see <code>deploy/README.md</code>. Copies past the retention above are removed from it; other files there are left alone.</p>
    {view.enabled && last && <p className={`text-sm ${last.ok ? 'bk-ok' : 'text-danger'}`} role="status">
      {last.ok ? <><CheckCircle2 size={13} /> Last copy {when(last.completed_at)}: {last.target}</> : <><XCircle size={13} /> The last copy failed ({when(last.completed_at)}): {last.error}</>}
    </p>}
    {error && <div className="error-msg" role="alert">{error}</div>}
    <form onSubmit={event => { event.preventDefault(); save(); }} className="bk-offsite-form">
      <div className="form-group"><label htmlFor="share-path">Folder in the container</label><input id="share-path" value={folder} onChange={e => setFolder(e.target.value)} placeholder={`${view.root}/backup-share`} maxLength={500} /></div>
      <div className="bk-actions">
        <button type="submit" className="btn btn-ghost btn-sm" disabled={!!busy}><Save size={14} /> {busy === 'save' ? 'Saving…' : 'Save'}</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={async () => { const r = await act('test', () => api.testBackupShare()); if (r) setTested(r); }}><PlugZap size={14} /> {busy === 'test' ? 'Checking…' : 'Test folder'}</button>
        {view.enabled
          ? <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => save({ enabled: false })}>Turn off</button>
          : <button type="button" className="btn btn-primary btn-sm" disabled={!!busy || !view.has_passphrase} title={view.has_passphrase ? undefined : 'Set the encryption passphrase first'} onClick={() => save({ enabled: true })}>Turn on</button>}
      </div>
    </form>
    {tested && <div className="alert alert-success bk-fingerprint" role="status">
      <p><CheckCircle2 size={14} /> {tested.path} can be written.{tested.free_bytes != null ? ` ${size(tested.free_bytes)} free.` : ''} {tested.copies ? `${tested.copies} TeamHub cop${tested.copies === 1 ? 'y' : 'ies'} there.` : ''}</p>
    </div>}
  </section>;
}
