import { useState, useRef, useEffect } from 'react';
import { Camera, KeyRound, User, Save, Trash2, CheckCircle, AlertCircle, ShieldCheck, ShieldOff, Loader2, Bell } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../App';
import { useConfirm } from '../components/Confirm';
import { Toggle } from './admin/shared';

/* ── Inline alert helper ─────────────────────────────────── */
function Alert({ type, msg }) {
  if (!msg) return null;
  const ok = type === 'success';
  return (
    <div className="u-2b95d35" style={{ background: ok ? '#f0fdf4' : '#fef2f2', border: `1px solid ${ok ? '#bbf7d0' : '#fecaca'}`, color: ok ? '#166534' : '#991b1b' }}>
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
      // Refresh the current user after the server renews the session cookie.
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
    <div className="card mb-20">
      <div className="u-a32a8d3">
        <Camera size={15} color="var(--primary)" /> Profile Picture
      </div>
      <Alert type={msg.type} msg={msg.text} />
      <div className="u-277c3be">
        {/* Avatar preview */}
        <div
          onClick={() => fileRef.current?.click()}
          className="u-d6a4d8c" style={{ background: user.avatar_url ? 'transparent' : 'linear-gradient(135deg,#3b82f6,#6366f1)' }}
          title="Click to change photo"
        >
          {user.avatar_url
            ? <img src={user.avatar_url} alt="avatar" className="u-618aa59" />
            : initials}
          <div className="u-884fc59"
            onMouseEnter={e => e.currentTarget.style.opacity = 1}
            onMouseLeave={e => e.currentTarget.style.opacity = 0}
          >
            <Camera size={22} color="#fff" />
          </div>
        </div>

        <div className="u-eb62184">
          <p className="text-sm text-muted u-761d3ad">
            JPG, PNG or WebP · Max 2 MB · Click the photo to upload
          </p>
          <div className="flex gap-8 flex-wrap">
            <button
              className="btn btn-primary btn-sm inline-flex items-center gap-5"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
             
            >
              <Camera size={13} /> {uploading ? 'Uploading…' : 'Upload Photo'}
            </button>
            {user.avatar_url && (
              <button
                className="btn btn-ghost btn-sm u-26822bb"
                onClick={handleRemove}
                disabled={removing}
              >
                <Trash2 size={13} /> {removing ? 'Removing…' : 'Remove'}
              </button>
            )}
          </div>
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="u-6b99de8" />
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
    <div className="card mb-20">
      <div className="u-a32a8d3">
        <User size={15} color="var(--primary)" /> Personal Info
      </div>
      <Alert type={msg.type} msg={msg.text} />

      {isEngineer ? (
        /* Read-only view for engineers */
        <div>
          <div className="form-row">
            <div className="form-group">
              <label>Full Name</label>
              <input value={user.name || ''} disabled className="u-a38c980" />
            </div>
            <div className="form-group">
              <label>Email Address</label>
              <input value={user.email || ''} disabled className="u-a38c980" />
            </div>
          </div>
          <p className="u-5627473">
            <AlertCircle size={12} />
            Name and email can only be changed by an administrator.
          </p>
          <div className="u-4ac3eb4">
            Role: <strong className="u-6fedee3">{user.role}</strong>
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
          <div className="flex-center gap-12">
            <button
              type="submit"
              className="btn btn-primary btn-sm inline-flex items-center gap-5"
              disabled={saving}
             
            >
              <Save size={13} /> {saving ? 'Saving…' : 'Save Changes'}
            </button>
            <span className="u-5be3ef4">
              Role: <strong className="u-6fedee3">{user.role}</strong>
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
      <div className="u-a32a8d3">
        <KeyRound size={15} color="var(--primary)" /> Change Password
      </div>
      <Alert type={msg.type} msg={msg.text} />
      <form onSubmit={submit} className="u-cb05851">
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
            <p className="u-5433fdf">Passwords don't match</p>
          )}
        </div>
        <button
          type="submit"
          className="btn btn-primary btn-sm inline-flex items-center gap-5"
          disabled={saving || !form.current_password || !form.new_password || form.new_password !== form.confirm}
         
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
    <div className="card mb-20">
      <div className="u-a32a8d3">
        <ShieldCheck size={15} color="var(--primary)" /> Two-Factor Authentication
      </div>
      <Alert type={msg.type} msg={msg.text} />

      {/* Status indicator */}
      <div className="u-b21814f">
        <div className="u-bf58c8b" style={{ background: enabled ? '#f0fdf4' : '#fef9c3', border: `1px solid ${enabled ? '#86efac' : '#fde68a'}`, color: enabled ? '#166534' : '#92400e' }}>
          {enabled ? <ShieldCheck size={14} /> : <ShieldOff size={14} />}
          {enabled ? '2FA is enabled' : '2FA is not enabled'}
        </div>
        {enabled ? (
          <button
            className="btn btn-ghost btn-sm u-26822bb"
            onClick={disable}
            disabled={working}
          >
            <ShieldOff size={13} /> {working ? 'Disabling…' : 'Disable 2FA'}
          </button>
        ) : (
          step === 'idle' && (
            <button
              className="btn btn-primary btn-sm inline-flex items-center gap-5"
              onClick={startSetup}
              disabled={working}
             
            >
              {working ? <><Loader2 size={13} style={{ animation: 'spin .9s linear infinite' }} /> Loading…</> : <><ShieldCheck size={13} /> Enable 2FA</>}
            </button>
          )
        )}
      </div>

      {/* Setup: show QR code */}
      {!enabled && step === 'setup' && (
        <div className="u-0fd8744">
          <div className="u-2c403dd">
            <strong>Step 1:</strong> Scan this QR code with your authenticator app (e.g. Google Authenticator, Authy).
          </div>
          {qrUrl && (
            <div className="flex justify-center mb-12">
              <img src={qrUrl} alt="2FA QR Code" className="u-fa1c1a9" />
            </div>
          )}
          {secret && (
            <div className="u-c210a3e">
              <div className="u-c1f9602">Manual entry key</div>
              {secret}
            </div>
          )}
          <div className="u-6c1c8de">
            <strong>Step 2:</strong> Enter the 6-digit code from your app to confirm setup.
          </div>
          <form onSubmit={verifyEnable} className="u-9da20e4">
            <div className="form-group u-3b7e73f">
              <input
                type="text"
                inputMode="numeric"
                value={code}
                onChange={e => setCode(e.target.value.replace(/[^0-9 ]/g, '').slice(0, 7))}
                placeholder="000 000"
                className="u-e6afffc"
                maxLength={7}
                autoFocus
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary btn-sm inline-flex items-center gap-5"
              disabled={working || code.replace(/\s/g,'').length < 6}
            >
              {working ? <><Loader2 size={13} style={{ animation: 'spin .9s linear infinite' }} /> Verifying…</> : <><ShieldCheck size={13} /> Activate</>}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setStep('idle'); setCode(''); }}>Cancel</button>
          </form>
        </div>
      )}

      {!enabled && step === 'idle' && (
        <p className="u-bf50fe4">
          Two-factor authentication adds an extra layer of security to your account by requiring a one-time code when logging in.
        </p>
      )}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function NotificationPreferencesSection({ user, onRefresh }) {
  const [saving, setSaving] = useState('');
  const [msg, setMsg] = useState({ type: '', text: '' });
  // The saved webhook URL is a secret and never comes back from the server —
  // this only ever holds what the user is typing right now.
  const [webhookDraft, setWebhookDraft] = useState('');

  const webexOn = user.notify_external_enabled !== false; // treat unset (older sessions) as the default: on
  const teamsOn = !!user.notify_teams_enabled;
  const emailOn = !!user.notify_email_enabled;

  async function sendTest(channel) {
    setSaving(`test-${channel}`); setMsg({ type: '', text: '' });
    try {
      const result = await api.testNotificationChannel(channel);
      setMsg({ type: 'success', text: result.message });
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    } finally { setSaving(''); }
  }

  async function save(channel, changes, successText) {
    setSaving(channel); setMsg({ type: '', text: '' });
    try {
      const result = await api.updateNotificationPreferences(changes);
      onRefresh(result);
      setMsg({ type: 'success', text: successText });
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    } finally { setSaving(''); }
  }

  return (
    <div className="card mb-20">
      <div className="u-3c461cc">
        <Bell size={15} color="var(--primary)" /> Notifications
      </div>
      <p className="u-265c667">
        Choose where you personally hear about things assigned to you, on top of the notifications you already see in this app (the bell icon).
      </p>
      <Alert type={msg.type} msg={msg.text} />

      <div className="u-eecfdda">
        <div>
          <Toggle checked={webexOn} disabled={!!saving}
            onChange={value => save('webex', { notify_external_enabled: value }, value ? 'Webex direct messages turned on.' : 'Webex direct messages turned off.')}
            label="Webex direct messages" />
          <p className="u-ab00b55">
            Only available if your organization has Webex configured. Uses the org bot — there's no separate account to connect.
          </p>
        </div>

        <div>
          <Toggle checked={teamsOn} disabled={!!saving || !user.notify_teams_webhook_set}
            onChange={value => save('teams', { notify_teams_enabled: value }, value ? 'Personal Teams notifications turned on.' : 'Personal Teams notifications turned off.')}
            label="Personal Teams channel" />
          <div className="u-ca3eca1">
            <input type="password" autoComplete="new-password" value={webhookDraft} onChange={e => setWebhookDraft(e.target.value)}
              placeholder={user.notify_teams_webhook_set ? 'Webhook saved — paste a new URL to replace it' : 'Your Teams incoming webhook URL'} className="u-7b1dd1f" />
            <button type="button" className="btn btn-ghost btn-sm" disabled={saving === 'teams-url' || !webhookDraft.trim()}
              onClick={async () => { await save('teams-url', { notify_teams_webhook_url: webhookDraft.trim() }, 'Teams webhook saved.'); setWebhookDraft(''); }}>
              {saving === 'teams-url' ? 'Saving…' : 'Save'}
            </button>
            {user.notify_teams_webhook_set && <>
              <button type="button" className="btn btn-ghost btn-sm" disabled={!!saving} onClick={() => sendTest('teams')}>{saving === 'test-teams' ? 'Sending…' : 'Send test'}</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={!!saving} onClick={() => save('teams-url', { notify_teams_webhook_url: '' }, 'Teams webhook removed.')}>Remove</button>
            </>}
          </div>
          <p className="u-ab00b55">
            Teams has no per-person inbox the way Webex does — paste a webhook URL for a channel only you (or your team) can see, from that channel's ··· menu → Workflows.
          </p>
        </div>

        <div>
          <Toggle checked={emailOn} disabled={!!saving}
            onChange={value => save('email', { notify_email_enabled: value }, value ? 'Email alerts turned on.' : 'Email alerts turned off.')}
            label={`Email alerts${user.email ? ` (${user.email})` : ''}`} />
          <p className="u-ab00b55">
            Sent to your account email above.
          </p>
          {!user.email_delivery_available && (
            <p className="u-e8acc98">
              Email delivery isn't set up for this organization yet, so alerts can't be sent. Ask an administrator to configure SMTP.
            </p>
          )}
          {emailOn && user.email_delivery_available && (
            <div className="u-304c842">
              <button type="button" className="btn btn-ghost btn-sm" disabled={!!saving} onClick={() => sendTest('email')}>{saving === 'test-email' ? 'Sending…' : 'Send test email'}</button>
            </div>
          )}
        </div>
      </div>
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
      // Sync refreshed profile data into the auth context.
      if (fresh.avatar_url !== ctxUser.avatar_url) {
        login({ ...ctxUser, ...fresh });
      }
    }).catch(() => {});
   
  }, []);

  function refresh(updated) {
    setUser(u => ({ ...u, ...updated }));
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title flex-center gap-8">
            <User size={20} /> My Profile
          </h1>
          <div className="page-subtitle">Manage your account details and password</div>
        </div>
      </div>

      <div className="u-48a0d2f">
        <AvatarSection       user={user} onRefresh={refresh} />
        <PersonalInfoSection user={user} onRefresh={refresh} />
        <ChangePasswordSection />
        <TwoFactorSection    user={user} onRefresh={refresh} />
        <NotificationPreferencesSection user={user} onRefresh={refresh} />
      </div>
    </div>
  );
}
