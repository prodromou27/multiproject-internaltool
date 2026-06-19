import React, { useState, useRef, useEffect } from 'react';
import { Camera, KeyRound, User, Save, Trash2, CheckCircle, AlertCircle, Lock, ShieldCheck, ShieldOff, QrCode, Loader2 } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../App';
import { useConfirm } from '../components/Confirm';

/* ── Inline alert helper ─────────────────────────────────── */
function Alert({ type, msg }) {
  if (!msg) return null;
  const ok = type === 'success';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '9px 13px', borderRadius: 8, marginBottom: 14, fontSize: 13,
      background: ok ? '#f0fdf4' : '#fef2f2',
      border: `1px solid ${ok ? '#bbf7d0' : '#fecaca'}`,
      color: ok ? '#166534' : '#991b1b',
    }}>
      {ok ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
      {msg}
    </div>
  );
}

/* ── Avatar section ──────────────────────────────────────── */
function AvatarSection({ user, onRefresh }) {
  const { login } = useAuth();
  const confirm   = useConfirm();
  const fileRef  = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [removing,  setRemoving]  = useState(false);
  const [msg, setMsg] = useState({ type: '', text: '' });

  const initials = user.name?.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setMsg({ type: 'error', text: 'Image must be under 2 MB' }); return; }
    setUploading(true); setMsg({ type: '', text: '' });
    try {
      const data = await api.uploadAvatar(file);
      if (data.error) throw new Error(data.error);
      // Update auth context + localStorage with new user + token
      login({ ...user, avatar_url: data.avatar_url }, data.token);
      setMsg({ type: 'success', text: 'Profile picture updated!' });
      onRefresh(data.user);
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleRemove() {
    const ok = await confirm('Remove your profile picture?', { title: 'Remove Picture', label: 'Remove' });
    if (!ok) return;
    setRemoving(true); setMsg({ type: '', text: '' });
    try {
      const data = await api.removeAvatar();
      login({ ...user, avatar_url: null }, data.token);
      setMsg({ type: 'success', text: 'Profile picture removed.' });
      onRefresh(data.user);
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    } finally { setRemoving(false); }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Camera size={15} color="var(--primary)" /> Profile Picture
      </div>
      <Alert type={msg.type} msg={msg.text} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
        {/* Avatar preview */}
        <div
          onClick={() => fileRef.current?.click()}
          style={{
            width: 80, height: 80, borderRadius: '50%', flexShrink: 0,
            background: user.avatar_url ? 'transparent' : 'linear-gradient(135deg,#3b82f6,#6366f1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 26, fontWeight: 800, color: '#fff',
            cursor: 'pointer', overflow: 'hidden',
            border: '3px solid var(--gray-100)',
            position: 'relative',
          }}
          title="Click to change photo"
        >
          {user.avatar_url
            ? <img src={user.avatar_url} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : initials}
          <div style={{
            position: 'absolute', inset: 0, background: 'rgba(0,0,0,.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            opacity: 0, transition: 'opacity .15s',
          }}
            onMouseEnter={e => e.currentTarget.style.opacity = 1}
            onMouseLeave={e => e.currentTarget.style.opacity = 0}
          >
            <Camera size={22} color="#fff" />
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 160 }}>
          <p className="text-sm text-muted" style={{ marginBottom: 10 }}>
            JPG, PNG or WebP · Max 2 MB · Click the photo to upload
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
            >
              <Camera size={13} /> {uploading ? 'Uploading…' : 'Upload Photo'}
            </button>
            {user.avatar_url && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleRemove}
                disabled={removing}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--danger)' }}
              >
                <Trash2 size={13} /> {removing ? 'Removing…' : 'Remove'}
              </button>
            )}
          </div>
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
    </div>
  );
}

/* ── Personal info section ───────────────────────────────── */
function PersonalInfoSection({ user, onRefresh }) {
  const { login } = useAuth();
  const isEngineer = user.role === 'engineer';
  const [form, setForm]   = useState({ name: user.name || '', email: user.email || '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg]       = useState({ type: '', text: '' });

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim()) { setMsg({ type: 'error', text: 'Name cannot be empty' }); return; }
    setSaving(true); setMsg({ type: '', text: '' });
    try {
      const data = await api.updateProfile({ name: form.name.trim(), email: form.email.trim() });
      login({ ...user, name: data.user.name, email: data.user.email, avatar_url: data.user.avatar_url }, data.token);
      setMsg({ type: 'success', text: 'Profile updated successfully!' });
      onRefresh(data.user);
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    } finally { setSaving(false); }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <User size={15} color="var(--primary)" /> Personal Info
      </div>
      <Alert type={msg.type} msg={msg.text} />

      {isEngineer ? (
        /* Read-only view for engineers */
        <div>
          <div className="form-row">
            <div className="form-group">
              <label>Full Name</label>
              <input value={user.name || ''} disabled style={{ background: 'var(--gray-50)', cursor: 'not-allowed' }} />
            </div>
            <div className="form-group">
              <label>Email Address</label>
              <input value={user.email || ''} disabled style={{ background: 'var(--gray-50)', cursor: 'not-allowed' }} />
            </div>
          </div>
          <p style={{ fontSize: 12, color: 'var(--gray-400)', margin: '4px 0 0 0', display: 'flex', alignItems: 'center', gap: 5 }}>
            <AlertCircle size={12} />
            Name and email can only be changed by an administrator.
          </p>
          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--gray-400)' }}>
            Role: <strong style={{ textTransform: 'capitalize' }}>{user.role}</strong>
            {user.created_at && ` · Joined ${new Date(user.created_at).toLocaleDateString([], { month: 'short', year: 'numeric' })}`}
          </div>
        </div>
      ) : (
        /* Editable form for managers / admins */
        <form onSubmit={submit}>
          <div className="form-row">
            <div className="form-group">
              <label>Full Name *</label>
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Your full name"
                required
              />
            </div>
            <div className="form-group">
              <label>Email Address</label>
              <input
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="your@email.com"
              />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={saving}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
            >
              <Save size={13} /> {saving ? 'Saving…' : 'Save Changes'}
            </button>
            <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>
              Role: <strong style={{ textTransform: 'capitalize' }}>{user.role}</strong>
              {user.created_at && ` · Joined ${new Date(user.created_at).toLocaleDateString([], { month: 'short', year: 'numeric' })}`}
            </span>
          </div>
        </form>
      )}
    </div>
  );
}

/* ── Change password section ─────────────────────────────── */
function ChangePasswordSection() {
  const { user, login } = useAuth();
  const [form, setForm]   = useState({ current_password: '', new_password: '', confirm: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg]       = useState({ type: '', text: '' });
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (form.new_password.length < 12) { setMsg({ type: 'error', text: 'New password must be at least 12 characters' }); return; }
    if (form.new_password !== form.confirm) { setMsg({ type: 'error', text: 'New passwords do not match' }); return; }
    setSaving(true); setMsg({ type: '', text: '' });
    try {
      const data = await api.changePassword({ current_password: form.current_password, new_password: form.new_password });
      if (data?.token) login(user, data.token);
      setMsg({ type: 'success', text: 'Password changed successfully!' });
      setForm({ current_password: '', new_password: '', confirm: '' });
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    } finally { setSaving(false); }
  }

  return (
    <div className="card">
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <KeyRound size={15} color="var(--primary)" /> Change Password
      </div>
      <Alert type={msg.type} msg={msg.text} />
      <form onSubmit={submit} style={{ maxWidth: 400 }}>
        <div className="form-group">
          <label>Current Password *</label>
          <input
            type="password"
            value={form.current_password}
            onChange={set('current_password')}
            placeholder="Enter your current password"
            required
            autoComplete="current-password"
          />
        </div>
        <div className="form-group">
          <label>New Password *</label>
          <input
            type="password"
            value={form.new_password}
            onChange={set('new_password')}
            placeholder="At least 12 characters"
            required
            autoComplete="new-password"
          />
        </div>
        <div className="form-group">
          <label>Confirm New Password *</label>
          <input
            type="password"
            value={form.confirm}
            onChange={set('confirm')}
            placeholder="Repeat new password"
            required
            autoComplete="new-password"
          />
          {form.confirm && form.new_password && form.confirm !== form.new_password && (
            <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>Passwords don't match</p>
          )}
        </div>
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={saving || !form.current_password || !form.new_password || form.new_password !== form.confirm}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
        >
          <KeyRound size={13} /> {saving ? 'Saving…' : 'Update Password'}
        </button>
      </form>
    </div>
  );
}

/* ── Two-Factor Authentication section ──────────────────── */
function TwoFactorSection({ user, onRefresh }) {
  // step: 'idle' | 'setup' | 'verify'
  const [step,     setStep]     = useState('idle');
  const [qrUrl,    setQrUrl]    = useState('');
  const [secret,   setSecret]   = useState('');
  const [code,     setCode]     = useState('');
  const [working,  setWorking]  = useState(false);
  const [msg,      setMsg]      = useState({ type: '', text: '' });

  const enabled = !!user.totp_enabled;

  async function startSetup() {
    setWorking(true); setMsg({ type: '', text: '' });
    try {
      const data = await api.setup2fa();
      setQrUrl(data.qr_data_url);
      setSecret(data.secret);
      setStep('setup');
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    } finally { setWorking(false); }
  }

  async function verifyEnable(e) {
    e.preventDefault();
    if (!code.trim()) return;
    setWorking(true); setMsg({ type: '', text: '' });
    try {
      await api.enable2fa(code.replace(/\s/g, ''));
      setMsg({ type: 'success', text: '2FA enabled successfully! Your account is now more secure.' });
      setStep('idle');
      setCode('');
      onRefresh({ totp_enabled: 1 });
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    } finally { setWorking(false); }
  }

  async function disable() {
    const pw = window.prompt('Enter your current password to confirm disabling 2FA:');
    if (pw === null) return; // cancelled
    if (!pw.trim()) { setMsg({ type: 'error', text: 'Password is required to disable 2FA' }); return; }
    setWorking(true); setMsg({ type: '', text: '' });
    try {
      await api.disable2fa(pw);
      setMsg({ type: 'success', text: '2FA disabled.' });
      onRefresh({ totp_enabled: 0 });
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    } finally { setWorking(false); }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <ShieldCheck size={15} color="var(--primary)" /> Two-Factor Authentication
      </div>
      <Alert type={msg.type} msg={msg.text} />

      {/* Status indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 12px', borderRadius: 8,
          background: enabled ? '#f0fdf4' : '#fef9c3',
          border: `1px solid ${enabled ? '#86efac' : '#fde68a'}`,
          fontSize: 13, fontWeight: 600,
          color: enabled ? '#166534' : '#92400e',
        }}>
          {enabled ? <ShieldCheck size={14} /> : <ShieldOff size={14} />}
          {enabled ? '2FA is enabled' : '2FA is not enabled'}
        </div>
        {enabled ? (
          <button
            className="btn btn-ghost btn-sm"
            onClick={disable}
            disabled={working}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--danger)' }}
          >
            <ShieldOff size={13} /> {working ? 'Disabling…' : 'Disable 2FA'}
          </button>
        ) : (
          step === 'idle' && (
            <button
              className="btn btn-primary btn-sm"
              onClick={startSetup}
              disabled={working}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
            >
              {working ? <><Loader2 size={13} style={{ animation: 'spin .9s linear infinite' }} /> Loading…</> : <><ShieldCheck size={13} /> Enable 2FA</>}
            </button>
          )
        )}
      </div>

      {/* Setup: show QR code */}
      {!enabled && step === 'setup' && (
        <div style={{ maxWidth: 420 }}>
          <div style={{ fontSize: 13, color: '#374151', marginBottom: 12 }}>
            <strong>Step 1:</strong> Scan this QR code with your authenticator app (e.g. Google Authenticator, Authy).
          </div>
          {qrUrl && (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
              <img src={qrUrl} alt="2FA QR Code" style={{ width: 180, height: 180, border: '3px solid var(--gray-100)', borderRadius: 8 }} />
            </div>
          )}
          {secret && (
            <div style={{ background: 'var(--gray-50)', borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontFamily: 'monospace', fontSize: 13, letterSpacing: '.08em', wordBreak: 'break-all', textAlign: 'center', color: '#374151' }}>
              <div style={{ fontSize: 10, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 2 }}>Manual entry key</div>
              {secret}
            </div>
          )}
          <div style={{ fontSize: 13, color: '#374151', marginBottom: 10 }}>
            <strong>Step 2:</strong> Enter the 6-digit code from your app to confirm setup.
          </div>
          <form onSubmit={verifyEnable} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ flex: 1, minWidth: 140, margin: 0 }}>
              <input
                type="text"
                inputMode="numeric"
                value={code}
                onChange={e => setCode(e.target.value.replace(/[^0-9 ]/g, '').slice(0, 7))}
                placeholder="000 000"
                style={{ textAlign: 'center', fontSize: 20, letterSpacing: '0.2em', fontWeight: 700 }}
                maxLength={7}
                autoFocus
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={working || code.replace(/\s/g,'').length < 6}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
            >
              {working ? <><Loader2 size={13} style={{ animation: 'spin .9s linear infinite' }} /> Verifying…</> : <><ShieldCheck size={13} /> Activate</>}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setStep('idle'); setCode(''); }}>Cancel</button>
          </form>
        </div>
      )}

      {!enabled && step === 'idle' && (
        <p style={{ fontSize: 12, color: 'var(--gray-400)', margin: 0 }}>
          Two-factor authentication adds an extra layer of security to your account by requiring a one-time code when logging in.
        </p>
      )}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/* ── Main page ───────────────────────────────────────────── */
export default function Profile() {
  const { user: ctxUser, login } = useAuth();
  const [user, setUser] = useState(ctxUser);

  // Load fresh profile on mount (picks up avatar_url for existing sessions)
  useEffect(() => {
    api.me().then(fresh => {
      setUser(u => ({ ...u, ...fresh }));
      // Sync avatar_url into localStorage/context without re-issuing token
      if (fresh.avatar_url !== ctxUser.avatar_url) {
        const stored = JSON.parse(localStorage.getItem('user') || '{}');
        stored.avatar_url = fresh.avatar_url;
        localStorage.setItem('user', JSON.stringify(stored));
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function refresh(updated) {
    setUser(u => ({ ...u, ...updated }));
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <User size={20} /> My Profile
          </h1>
          <div className="page-subtitle">Manage your account details and password</div>
        </div>
      </div>

      <div style={{ maxWidth: 680 }}>
        <AvatarSection       user={user} onRefresh={refresh} />
        <PersonalInfoSection user={user} onRefresh={refresh} />
        <ChangePasswordSection />
        <TwoFactorSection    user={user} onRefresh={refresh} />
      </div>
    </div>
  );
}
