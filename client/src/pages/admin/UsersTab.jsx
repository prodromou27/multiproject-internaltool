import { useEffect, useState } from 'react';
import { Users as UsersIcon, UserX, CheckCircle2, Pencil, KeyRound, UserCheck, Trash2, Save, ShieldAlert } from 'lucide-react';
import { api } from '../../api';
import { fmtDate, Modal } from '../../components/Shared';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/Confirm';
import { timeSince } from './shared';

/* ── User Form ───────────────────────────────────────────── */
export function UserForm({ initial, onSave, onClose }) {
  const [form, setForm] = useState(
    initial || { name: '', email: '', password: '', role: 'engineer' }
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault(); setErr(''); setSaving(true);
    try { await onSave(form); onClose(); }
    catch (ex) { setErr(ex.message); }
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={submit}>
      {err && <div className="error-msg">{err}</div>}
      <div className="form-group"><label>Full Name *</label><input value={form.name} onChange={set('name')} required /></div>
      <div className="form-group">
        <label>Email Address <span style={{ fontWeight: 400, color: 'var(--gray-400)', fontSize: 12 }}>(optional)</span></label>
        <input type="email" value={form.email || ''} onChange={set('email')} placeholder="user@example.com" />
      </div>
      {!initial && (
        <div className="form-group">
          <label>Password * <span className="text-muted text-sm">(min 12 chars)</span></label>
          <input type="password" value={form.password} onChange={set('password')} required minLength={12} />
        </div>
      )}
      <div className="form-group">
        <label>Role *</label>
        <select value={form.role} onChange={set('role')}>
          <option value="engineer">Engineer</option>
          <option value="planner">Planner</option>
          <option value="pm">PM (Project Monitor)</option>
          <option value="manager">Manager</option>
        </select>
      </div>
      <div className="modal-footer" style={{ padding: '12px 0 0', border: 'none' }}>
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
    <div style={{ textAlign: 'center', padding: '20px 0' }}>
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
      <div className="form-group"><label>New Password <span className="text-muted text-sm">(min 12 chars)</span></label><input type="password" value={pw} onChange={e => setPw(e.target.value)} required minLength={12} autoFocus /></div>
      <div className="form-group"><label>Confirm Password</label><input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required /></div>
      <div className="modal-footer" style={{ padding: '12px 0 0', border: 'none' }}>
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

  async function deleteUser(u) {
    const ok = await confirm(`Permanently delete ${u.name}? This cannot be undone.`, { title: 'Delete User' });
    if (!ok) return;
    try { await api.adminDeleteUser(u.id); toast.success(`${u.name} deleted`); load(); } catch(e) { toast.error(e.message); }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or email…" style={{ flex: 1, minWidth: 200, maxWidth: 320 }} />
        <div className="flex gap-6 flex-wrap">
          {[
            { value: 'all',      label: 'All' },
            { value: 'manager',  label: 'Managers' },
            { value: 'planner',  label: 'Planners' },
            { value: 'engineer', label: 'Engineers' },
            { value: 'pm',       label: 'PMs' },
          ].map(({ value, label }) => (
            <button key={value} className={'btn btn-sm ' + (roleFilter === value ? 'btn-primary' : 'btn-ghost')} onClick={() => setRoleFilter(value)}>
              {label}{' '}({value === 'all' ? users.length : users.filter(u => u.role === value).length})
            </button>
          ))}
        </div>
        <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setShowCreate(true)}>+ Create User</button>
      </div>

      {loading ? <p className="text-muted">Loading…</p> : filtered.length === 0
        ? <div className="empty"><div className="empty-icon"><UsersIcon size={40} strokeWidth={1.2} /></div><p>No users found</p></div>
        : (
          <div className="card table-wrap p-0">
            <table>
              <thead>
                <tr>
                  <th>User</th><th>Role</th><th>Status</th><th>Projects</th>
                  <th>Open Tasks</th><th>MV Count</th><th>Last Login</th><th>Joined</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => (
                  <tr key={u.id} style={{ opacity: u.active ? 1 : 0.5 }}>
                    <td>
                      <div className="font-semibold">{u.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>{u.email || '—'}</div>
                    </td>
                    <td><span className={`badge badge-${u.role}`}>{u.role}</span></td>
                    <td>
                      {u.active ? <span className="badge badge-done">Active</span> : <span className="badge badge-cancelled">Inactive</span>}
                      {u.must_change_password ? (
                        <span title="Must set password on first login" style={{
                          display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 6,
                          fontSize: 10, fontWeight: 700, color: 'var(--tone-warning-text)', background: 'var(--warning-light)',
                          border: '1px solid #fcd34d', borderRadius: 4, padding: '1px 5px',
                        }}>⚠ Awaiting setup</span>
                      ) : null}
                    </td>
                    <td className="text-center">{u.project_count}</td>
                    <td className="text-center">{u.open_tasks}</td>
                    <td className="text-center">{u.mv_count}</td>
                    <td className="text-sm text-muted">{timeSince(u.last_login)}</td>
                    <td className="text-sm text-muted">{fmtDate(u.created_at)}</td>
                    <td>
                      <div className="flex gap-8" style={{ flexWrap: 'nowrap' }}>
                        <button className="btn btn-sm btn-ghost inline-flex items-center" onClick={() => setEditing(u)} title="Edit"><Pencil size={13} /></button>
                        <button className="btn btn-sm btn-ghost inline-flex items-center" onClick={() => setResetting(u)} title="Reset password"><KeyRound size={13} /></button>
                        {u.id !== currentUser.id && (
                          <button className={'btn btn-sm ' + (u.active ? 'btn-ghost' : 'btn-success')} onClick={() => toggleActive(u)} title={u.active ? 'Deactivate' : 'Activate'} style={{ display: 'inline-flex', alignItems: 'center' }}>
                            {u.active ? <UserX size={13} /> : <UserCheck size={13} />}
                          </button>
                        )}
                        <button
                          className={'btn btn-sm ' + (u.totp_exempt ? 'btn-warning' : 'btn-ghost')}
                          onClick={() => toggle2faExempt(u)}
                          title={u.totp_exempt ? '2FA Exempt (click to revoke)' : u.totp_enabled ? 'Exempt from 2FA' : '2FA not enabled'}
                          style={{ display: 'inline-flex', alignItems: 'center', opacity: u.totp_enabled || u.totp_exempt ? 1 : 0.4 }}
                        >
                          <ShieldAlert size={13} />
                        </button>
                        {u.id !== currentUser.id && (
                          <button className="btn btn-sm btn-danger inline-flex items-center" onClick={() => deleteUser(u)} title="Delete"><Trash2 size={13} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }

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
