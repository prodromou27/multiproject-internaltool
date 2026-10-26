import { useEffect, useState } from 'react';
import { UserX, CheckCircle2, Pencil, KeyRound, UserCheck, Trash2, ShieldAlert, LogOut, UserPlus, FolderKanban, ListChecks, Wrench } from 'lucide-react';
import { api } from '../../api';
import { fmtDate, Modal, sentenceCase } from '../../components/Shared';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/Confirm';
import { timeSince } from './shared';
import { useLiveRefresh } from '../../live';
import { Surface, DataTable, ToneBadge } from '../../components/EnterpriseUI';
import { ListSearch, FilterGroup } from '../../components/ListWorkspace';
import { HeaderMenu } from '../../components/PageLayout';

/* ── User Form ───────────────────────────────────────────── */
export function UserForm({ initial, onSave, onClose }) {
  const [form, setForm] = useState(() => {
    const start = initial || { name: '', email: '', password: '', role: 'engineer' };
    // The role picker holds a built-in role, or "custom:<id>" for a custom role.
    return { ...start, role_choice: start.custom_role_id ? `custom:${start.custom_role_id}` : start.role };
  });
  const [customRoles, setCustomRoles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  useEffect(() => { api.permissionMatrix().then(result => setCustomRoles(result.custom_roles || [])).catch(() => setCustomRoles([])); }, []);

  async function submit(e) {
    e.preventDefault(); setErr(''); setSaving(true);
    const { role_choice: choice, ...rest } = form;
    const role = choice.startsWith('custom:') ? { custom_role_id: Number(choice.slice(7)) } : { role: choice, custom_role_id: null };
    try { await onSave({ ...rest, role: undefined, ...role }); onClose(); }
    catch (ex) { setErr(ex.message); }
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={submit}>
      {err && <div className="error-msg">{err}</div>}
      <div className="form-group"><label>Full Name *</label><input aria-label="Full Name" value={form.name} onChange={set('name')} required /></div>
      <div className="form-group">
        <label>Email Address <span className="u-596026b">(optional)</span></label>
        <input aria-label="Email Address" type="email" value={form.email || ''} onChange={set('email')} placeholder="user@example.com" />
      </div>
      {!initial && (
        <div className="form-group">
          <label>Password * <span className="text-muted text-sm">(min 12 chars)</span></label>
          <input aria-label="Password" type="password" value={form.password} onChange={set('password')} required minLength={12} />
        </div>
      )}
      <div className="form-group">
        <label>Role *</label>
        <select aria-label="Role" value={form.role_choice} onChange={set('role_choice')}>
          <option value="engineer">Engineer</option>
          <option value="planner">Planner</option>
          <option value="pm">PM (Project Monitor)</option>
          <option value="manager">Manager</option>
          {customRoles.length > 0 && <optgroup label="Custom roles">
            {customRoles.map(role => <option key={role.id} value={`custom:${role.id}`}>{role.name} (on {role.base_role === 'pm' ? 'PM' : sentenceCase(role.base_role)})</option>)}
          </optgroup>}
        </select>
        {customRoles.length === 0 && <small className="text-muted">Make your own roles in Settings → Access & sign-in.</small>}
      </div>
      <div className="modal-footer u-cc45258">
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : initial ? 'Save Changes' : 'Create User'}</button>
      </div>
    </form>
  );
}

/* ── Reset Password Form ─────────────────────────────────── */
export function ResetPasswordForm({ user, onClose }) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  async function submit(e) {
    e.preventDefault(); setErr('');
    if (pw !== confirm) { setErr('Passwords do not match'); return; }
    if (pw.length < 12) { setErr('Password must be at least 12 characters'); return; }
    setSaving(true);
    try { await api.adminResetPassword(user.id, pw); setDone(true); }
    catch (ex) { setErr(ex.message); }
    finally { setSaving(false); }
  }

  if (done) return (
    <div className="u-57ea022">
      <div className="flex justify-center mb-12">
        <CheckCircle2 size={48} color="var(--success)" strokeWidth={1.5} />
      </div>
      <p className="font-semibold">Password reset successfully for <strong>{user.name}</strong></p>
      <button className="btn btn-primary mt-16" onClick={onClose}>Done</button>
    </div>
  );

  return (
    <form onSubmit={submit}>
      {err && <div className="error-msg">{err}</div>}
      <p className="text-sm text-muted mb-12">
        Set a new password for <strong>{user.name}</strong> ({user.email})
      </p>
      <div className="form-group"><label>New Password <span className="text-muted text-sm">(min 12 chars)</span></label><input aria-label="New Password" type="password" value={pw} onChange={e => setPw(e.target.value)} required minLength={12} autoFocus /></div>
      <div className="form-group"><label>Confirm Password</label><input aria-label="Confirm Password" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required /></div>
      <div className="modal-footer u-cc45258">
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Resetting…' : 'Reset Password'}</button>
      </div>
    </form>
  );
}

/* ══════════════════════════════════════════════════════════ */
/* ── USERS TAB ───────────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */
export function UsersTab({ currentUser }) {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [loading, setLoading] = useState(true);
  const toast   = useToast();
  const confirm = useConfirm();

  const load = () => api.adminUsers().then(d => { setUsers(d ?? []); setLoading(false); });
  useEffect(() => { load(); }, []);
  useLiveRefresh(() => load());

  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    const matchSearch = !q || u.name.toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q);
    const matchRole = roleFilter === 'all' || u.role === roleFilter;
    return matchSearch && matchRole;
  });

  async function toggleActive(u) {
    const ok = await confirm(`${u.active ? 'Deactivate' : 'Activate'} ${u.name}?`, { title: u.active ? 'Deactivate User' : 'Activate User', label: u.active ? 'Deactivate' : 'Activate' });
    if (!ok) return;
    try { await api.adminToggleActive(u.id); load(); } catch(e) { toast.error(e.message); }
  }

  async function toggle2faExempt(u) {
    const action = u.totp_exempt ? 'Remove 2FA exemption from' : 'Grant 2FA exemption to';
    const ok = await confirm(`${action} ${u.name}?`, { title: '2FA Exemption', label: 'Confirm', danger: false });
    if (!ok) return;
    try { await api.adminToggle2faExempt(u.id); load(); } catch(e) { toast.error(e.message); }
  }

  async function revokeSessions(u) {
    const ok = await confirm(`Sign ${u.name} out of every active session? They'll need to log in again, but their account stays enabled and their password is unchanged.`, { title: 'Revoke Active Sessions', label: 'Revoke Sessions' });
    if (!ok) return;
    try { await api.adminRevokeSessions(u.id); toast.success(`${u.name}'s sessions were revoked`); } catch(e) { toast.error(e.message); }
  }

  async function deleteUser(u) {
    const ok = await confirm(`Permanently delete ${u.name}? This cannot be undone.`, { title: 'Delete User' });
    if (!ok) return;
    try { await api.adminDeleteUser(u.id); toast.success(`${u.name} deleted`); load(); } catch(e) { toast.error(e.message); }
  }

  const columns = [
    { key: 'user', label: 'User', render: u => (
      <div>
        <div className="font-semibold">{u.name}</div>
        <div className="u-5be3ef4">{u.email || '—'}</div>
        <div className="user-status-row">
          <ToneBadge tone={u.active ? 'success' : 'danger'}>{u.active ? 'Active' : 'Inactive'}</ToneBadge>
          {u.must_change_password && <span title="Must set password on first login" className="u-17e3b54">⚠ Awaiting setup</span>}
        </div>
      </div>
    ) },
    { key: 'role', label: 'Role', render: u => (
      <span className={`badge badge-${u.role}`} title={u.custom_role_name ? `Built on ${sentenceCase(u.role)}` : undefined}>{u.custom_role_name || sentenceCase(u.role)}</span>
    ) },
    { key: 'activity', label: 'Activity', render: u => (
      <div className="user-stats">
        <span title="Projects"><FolderKanban size={12} aria-hidden="true" />{u.project_count}</span>
        <span title="Open tasks"><ListChecks size={12} aria-hidden="true" />{u.open_tasks}</span>
        <span title="Maintenance visits"><Wrench size={12} aria-hidden="true" />{u.mv_count}</span>
      </div>
    ) },
    { key: 'last_active', label: 'Last active', render: u => (
      <div>
        <div className="text-sm">{timeSince(u.last_login)}</div>
        <div className="u-5be3ef4">Joined {fmtDate(u.created_at)}</div>
      </div>
    ) },
    { key: 'actions', label: 'Actions', render: u => (
      <div className="table-actions">
        <button className="btn btn-sm btn-ghost" onClick={() => setEditing(u)} title="Edit" aria-label={`Edit ${u.name}`}><Pencil size={13} /></button>
        <HeaderMenu label={`More actions for ${u.name}`}>
          <button type="button" onClick={() => setResetting(u)}><KeyRound size={14} aria-hidden="true" /> Reset password</button>
          {u.id !== currentUser.id && <button type="button" onClick={() => revokeSessions(u)}><LogOut size={14} aria-hidden="true" /> Revoke sessions</button>}
          {u.id !== currentUser.id && (
            <button type="button" onClick={() => toggleActive(u)}>
              {u.active ? <UserX size={14} aria-hidden="true" /> : <UserCheck size={14} aria-hidden="true" />} {u.active ? 'Deactivate' : 'Activate'}
            </button>
          )}
          <button type="button" onClick={() => toggle2faExempt(u)} title={u.totp_exempt ? '2FA exempt' : u.totp_enabled ? '2FA enabled' : '2FA not enabled'}>
            <ShieldAlert size={14} aria-hidden="true" /> {u.totp_exempt ? 'Remove 2FA exemption' : 'Exempt from 2FA'}
          </button>
          {u.id !== currentUser.id && <>
            <hr />
            <button type="button" className="text-danger" onClick={() => deleteUser(u)}><Trash2 size={14} aria-hidden="true" /> Delete user</button>
          </>}
        </HeaderMenu>
      </div>
    ) },
  ];

  return (
    <div>
      <Surface title="User directory" actions={
        <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}><UserPlus size={14} aria-hidden="true" /> Create user</button>
      }>
        <ListSearch value={search} onChange={setSearch} label="Search users" placeholder="Search by name or email…" />
        <FilterGroup label="Role">
          {[
            { value: 'all',      label: 'All' },
            { value: 'manager',  label: 'Managers' },
            { value: 'planner',  label: 'Planners' },
            { value: 'engineer', label: 'Engineers' },
            { value: 'pm',       label: 'PMs' },
          ].map(({ value, label }) => (
            <button key={value} className={'filter-pill' + (roleFilter === value ? ' active' : '')} onClick={() => setRoleFilter(value)}>
              {label} <span>({value === 'all' ? users.length : users.filter(u => u.role === value).length})</span>
            </button>
          ))}
        </FilterGroup>
      </Surface>

      <DataTable columns={columns} rows={filtered} rowKey="id" loading={loading}
        empty="No users match this view." rowProps={u => ({ className: u.active ? undefined : 'is-inactive-row' })} />

      {showCreate && (
        <Modal title="Create New User" onClose={() => setShowCreate(false)}>
          <UserForm onSave={data => api.adminCreateUser(data).then(load)} onClose={() => setShowCreate(false)} />
        </Modal>
      )}
      {editing && (
        <Modal title="Edit User" onClose={() => setEditing(null)}>
          <UserForm initial={editing} onSave={data => api.adminUpdateUser(editing.id, data).then(load)} onClose={() => setEditing(null)} />
        </Modal>
      )}
      {resetting && (
        <Modal title="Reset Password" onClose={() => setResetting(null)}>
          <ResetPasswordForm user={resetting} onClose={() => setResetting(null)} />
        </Modal>
      )}
    </div>
  );
}
