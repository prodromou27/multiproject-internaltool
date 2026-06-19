import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Users as UsersIcon, Shield, Cog, UserX, FolderOpen, CheckCircle2,
  Lock, AlertTriangle, CheckSquare, Inbox, Zap, Wrench, ClipboardList,
  Send, Building2, Paperclip, HardDrive, Pencil, KeyRound, UserCheck,
  Trash2, MessageSquare, ScrollText, Link2, Bell, Save, Loader2,
  Activity, Settings, RefreshCw, Download, TrendingUp, BarChart3,
  ShieldAlert, Globe, Database, FileSpreadsheet, LayoutDashboard, Clock,
  AtSign, ExternalLink, Tag, Plus, GripVertical, ChevronUp, ChevronDown,
} from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../App';
import { fmtDate, Modal, StatusBadge, PriorityBadge, isOverdue } from '../components/Shared';
import { useStatuses } from '../hooks/useStatuses';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';

/* ── helpers ─────────────────────────────────────────────── */
function fileSize(b) {
  if (!b) return '0 B';
  if (b < 1024) return b + ' B';
  if (b < 1024 ** 2) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}

function timeSince(dt) {
  if (!dt) return '—';
  const diff = (Date.now() - new Date(dt).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
  return fmtDate(dt);
}

const ACTIVITY_ICONS = {
  status_update:  <MessageSquare size={15} color="var(--primary)" />,
  task_done:      <CheckCircle2  size={15} color="var(--success)" />,
  project_closed: <Lock          size={15} color="var(--gray-500)" />,
  mv_report:      <ClipboardList size={15} color="var(--warning)" />,
  new_project:    <FolderOpen    size={15} color="var(--primary)" />,
  new_user:       <UsersIcon     size={15} color="#0891b2" />,
};

/* ── User Form ───────────────────────────────────────────── */
function UserForm({ initial, onSave, onClose }) {
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
function ResetPasswordForm({ user, onClose }) {
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
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
        <CheckCircle2 size={48} color="var(--success)" strokeWidth={1.5} />
      </div>
      <p style={{ fontWeight: 600 }}>Password reset successfully for <strong>{user.name}</strong></p>
      <button className="btn btn-primary mt-16" onClick={onClose}>Done</button>
    </div>
  );

  return (
    <form onSubmit={submit}>
      {err && <div className="error-msg">{err}</div>}
      <p className="text-sm text-muted" style={{ marginBottom: 12 }}>
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

/* ── Stat Card ───────────────────────────────────────────── */
function StatCard({ label, value, sub, color, Icon: IconComp }) {
  return (
    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px' }}>
      <div style={{ width: 48, height: 48, borderRadius: 10, background: color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {IconComp && <IconComp size={22} color={color} />}
      </div>
      <div>
        <div style={{ fontSize: 26, fontWeight: 800, color }}>{value}</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-700)' }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 1 }}>{sub}</div>}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════ */
/* ── OVERVIEW TAB ────────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */
function OverviewTab() {
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api.adminStats(), api.adminActivity(8)])
      .then(([s, a]) => { setStats(s); setActivity(a); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading || !stats) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--gray-400)', padding: '24px 0' }}>
      <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Loading overview…
    </div>
  );

  const { users, projects, tasks, maintenance } = stats;

  const alerts = [];
  if (projects.overdue > 0)
    alerts.push({ level: 'danger',  icon: <ShieldAlert size={14} />, msg: `${projects.overdue} project${projects.overdue !== 1 ? 's are' : ' is'} past deadline` });
  if (projects.pending_closure > 0)
    alerts.push({ level: 'warning', icon: <AlertTriangle size={14} />, msg: `${projects.pending_closure} project${projects.pending_closure !== 1 ? 's are' : ' is'} awaiting closure approval` });
  if (maintenance.report_pending > 0)
    alerts.push({ level: 'warning', icon: <AlertTriangle size={14} />, msg: `${maintenance.report_pending} maintenance report${maintenance.report_pending !== 1 ? 's' : ''} pending submission` });
  if (users.total - users.active > 0)
    alerts.push({ level: 'info',    icon: <UserX size={14} />, msg: `${users.total - users.active} user account${(users.total - users.active) !== 1 ? 's' : ''} deactivated` });

  const healthBars = [
    { label: 'Users Active',       value: users.active,                                      total: Math.max(1, users.total),        color: 'var(--success)' },
    { label: 'Projects On Track',  value: Math.max(0, projects.active - projects.overdue),   total: Math.max(1, projects.active),    color: 'var(--primary)' },
    { label: 'Tasks Completed',    value: tasks.done,                                         total: Math.max(1, tasks.total),        color: 'var(--success)' },
    { label: 'MV Reports Sent',    value: maintenance.report_sent,                            total: Math.max(1, maintenance.total),  color: 'var(--primary)' },
  ];

  return (
    <div>
      {/* ── Alert banner ──────────────────────────────────── */}
      <div style={{ marginBottom: 20 }}>
        {alerts.length === 0
          ? <div className="alert alert-success" style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle2 size={14} /> All systems healthy — no outstanding issues detected
            </div>
          : alerts.map((a, i) => (
              <div key={i} className={`alert alert-${a.level === 'info' ? 'warning' : a.level}`}
                   style={{ marginBottom: 8, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                {a.icon}{a.msg}
              </div>
            ))
        }
      </div>

      {/* ── Key metric cards ──────────────────────────────── */}
      <div className="grid-4" style={{ marginBottom: 20 }}>
        <StatCard Icon={UsersIcon}   label="Active Users"    value={users.active}               sub={`${users.managers} managers · ${users.engineers} engineers`}    color="var(--primary)" />
        <StatCard Icon={FolderOpen}  label="Active Projects" value={projects.active}            sub={projects.overdue ? `⚠ ${projects.overdue} overdue` : 'All on track'}  color={projects.overdue ? 'var(--danger)' : 'var(--success)'} />
        <StatCard Icon={CheckSquare} label="Open Tasks"      value={tasks.open}                 sub={`${tasks.done} completed · ${tasks.adhoc} ad-hoc`}              color="var(--warning)" />
        <StatCard Icon={Wrench}      label="MV Reports Due"  value={maintenance.report_pending} sub={`${maintenance.report_sent} sent · ${maintenance.total} total`}  color={maintenance.report_pending > 0 ? 'var(--warning)' : 'var(--success)'} />
      </div>

      {/* ── Health + Recent Activity ──────────────────────── */}
      <div className="grid-2" style={{ marginBottom: 20 }}>

        {/* System health bars */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
            <div className="section-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}><TrendingUp size={14} /> System Health</div>
            <button className="btn btn-ghost btn-sm" onClick={load} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {healthBars.map(({ label, value, total, color }) => {
              const pct = Math.min(100, Math.round((value / total) * 100));
              return (
                <div key={label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
                    <span style={{ fontWeight: 600 }}>{label}</span>
                    <span style={{ color: 'var(--gray-400)' }}>{value}/{total} <strong style={{ color }}>{pct}%</strong></span>
                  </div>
                  <div className="progress-bar">
                    <div className="progress-bar-fill" style={{ width: `${pct}%`, background: color, transition: 'width .6s ease' }} />
                  </div>
                </div>
              );
            })}
          </div>
          {/* Quick counters */}
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--gray-100)', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, textAlign: 'center' }}>
            {[
              { label: 'Customers',       value: stats.customers,         color: '#0891b2' },
              { label: 'Pending Closure', value: projects.pending_closure, color: 'var(--warning)' },
              { label: 'Storage',         value: fileSize(stats.attachments.total_size), color: 'var(--gray-600)' },
            ].map(({ label, value, color }) => (
              <div key={label}>
                <div style={{ fontSize: 17, fontWeight: 800, color }}>{value}</div>
                <div style={{ fontSize: 10, color: 'var(--gray-400)', marginTop: 1, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent activity */}
        <div className="card">
          <div className="section-title" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}><Activity size={14} /> Recent Activity</div>
          {activity.length === 0
            ? <p className="text-muted text-sm">No activity recorded yet</p>
            : <ul style={{ listStyle: 'none' }}>
                {activity.slice(0, 7).map((e, i) => (
                  <li key={i} style={{
                    display: 'flex', gap: 10, padding: '8px 0',
                    borderBottom: i < Math.min(6, activity.length - 1) ? '1px solid var(--gray-100)' : 'none',
                    alignItems: 'flex-start',
                  }}>
                    <span style={{ flexShrink: 0, marginTop: 1 }}>{ACTIVITY_ICONS[e.type] || <Activity size={15} color="var(--gray-400)" />}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <strong>{e.actor}</strong>{' '}<span style={{ color: 'var(--gray-600)' }}>{e.description}</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 1 }}>{timeSince(e.created_at)}</div>
                    </div>
                  </li>
                ))}
              </ul>
          }
        </div>
      </div>

      {/* ── Role breakdown ────────────────────────────────── */}
      <div className="card">
        <div className="section-title" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}><UsersIcon size={14} /> Team Breakdown</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          {[
            { role: 'manager',  label: 'Managers',  count: users.managers,         color: '#7c3aed',          Icon: Shield },
            { role: 'engineer', label: 'Engineers', count: users.engineers,        color: '#0891b2',          Icon: Cog },
            { role: 'planner',  label: 'Planners',  count: users.planners || 0,    color: '#059669',          Icon: LayoutDashboard },
            { role: 'pm',       label: 'PMs',       count: users.pms || 0,         color: '#0ea5e9',          Icon: ClipboardList },
            { role: 'inactive', label: 'Inactive',  count: users.total - users.active, color: 'var(--gray-400)', Icon: UserX },
          ].map(({ label, count, color, Icon }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'var(--gray-50)', borderRadius: 8 }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon size={18} color={color} />
              </div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1 }}>{count}</div>
                <div style={{ fontSize: 11, color: 'var(--gray-500)', marginTop: 2 }}>{label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════ */
/* ── USERS TAB ───────────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */
function UsersTab({ currentUser }) {
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
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
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
          <div className="card table-wrap" style={{ padding: 0 }}>
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
                      <div style={{ fontWeight: 600 }}>{u.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>{u.email || '—'}</div>
                    </td>
                    <td><span className={`badge badge-${u.role}`}>{u.role}</span></td>
                    <td>
                      {u.active ? <span className="badge badge-done">Active</span> : <span className="badge badge-cancelled">Inactive</span>}
                      {u.must_change_password ? (
                        <span title="Must set password on first login" style={{
                          display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 6,
                          fontSize: 10, fontWeight: 700, color: '#92400e', background: '#fef3c7',
                          border: '1px solid #fcd34d', borderRadius: 4, padding: '1px 5px',
                        }}>⚠ Awaiting setup</span>
                      ) : null}
                    </td>
                    <td style={{ textAlign: 'center' }}>{u.project_count}</td>
                    <td style={{ textAlign: 'center' }}>{u.open_tasks}</td>
                    <td style={{ textAlign: 'center' }}>{u.mv_count}</td>
                    <td className="text-sm text-muted">{timeSince(u.last_login)}</td>
                    <td className="text-sm text-muted">{fmtDate(u.created_at)}</td>
                    <td>
                      <div className="flex gap-8" style={{ flexWrap: 'nowrap' }}>
                        <button className="btn btn-sm btn-ghost" onClick={() => setEditing(u)} title="Edit" style={{ display: 'inline-flex', alignItems: 'center' }}><Pencil size={13} /></button>
                        <button className="btn btn-sm btn-ghost" onClick={() => setResetting(u)} title="Reset password" style={{ display: 'inline-flex', alignItems: 'center' }}><KeyRound size={13} /></button>
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
                          <button className="btn btn-sm btn-danger" onClick={() => deleteUser(u)} title="Delete" style={{ display: 'inline-flex', alignItems: 'center' }}><Trash2 size={13} /></button>
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

/* ══════════════════════════════════════════════════════════ */
/* ── PROJECTS ADMIN TAB ──────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */
function ProjectsAdminTab() {
  const [projects, setProjects] = useState([]);
  const [filter,   setFilter]   = useState('all');
  const [search,   setSearch]   = useState('');
  const [loading,  setLoading]  = useState(true);

  useEffect(() => { api.projects().then(d => { setProjects(d ?? []); setLoading(false); }); }, []);

  const counts = ['all','in_progress','not_started','on_hold','pending_approval','closed','cancelled'].reduce((acc, k) => {
    acc[k] = k === 'all' ? projects.length : projects.filter(p => p.status === k).length;
    return acc;
  }, {});

  const filtered = projects.filter(p => {
    const q = search.toLowerCase();
    const matchSearch = !q || p.title.toLowerCase().includes(q) || (p.customer_name || '').toLowerCase().includes(q);
    const matchFilter = filter === 'all' || p.status === filter;
    return matchSearch && matchFilter;
  });

  return (
    <div>
      {/* summary stat row */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { label: 'Total',   count: counts.all,             color: 'var(--primary)' },
          { label: 'Active',  count: counts.active,          color: 'var(--success)' },
          { label: 'On Hold', count: counts.on_hold,         color: 'var(--gray-500)' },
          { label: 'Pending', count: counts.pending_closure, color: 'var(--warning)' },
          { label: 'Closed',  count: counts.closed,          color: 'var(--gray-400)' },
          { label: 'Overdue', count: projects.filter(p => isOverdue(p.deadline) && !['closed','cancelled','completed_engineer'].includes(p.status)).length, color: 'var(--danger)' },
        ].map(({ label, count, color }) => (
          <div key={label} className="card" style={{ padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <span style={{ fontSize: 22, fontWeight: 800, color }}>{count}</span>
            <span style={{ fontSize: 12, color: 'var(--gray-500)', fontWeight: 500 }}>{label}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by title or customer…" style={{ flex: 1, minWidth: 200, maxWidth: 320 }} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[['all','All'],['in_progress','In Progress'],['not_started','Not Started'],['on_hold','On Hold'],['pending_approval','Pending'],['closed','Closed'],['cancelled','Cancelled']].map(([k,l]) => (
            <button key={k} className={'btn btn-sm ' + (filter === k ? 'btn-primary' : 'btn-ghost')} onClick={() => setFilter(k)}>
              {l} ({counts[k] ?? 0})
            </button>
          ))}
        </div>
      </div>

      {loading ? <p className="text-muted">Loading…</p> : filtered.length === 0
        ? <div className="empty"><div className="empty-icon"><FolderOpen size={40} strokeWidth={1.2} /></div><p>No projects match</p></div>
        : (
          <div className="card table-wrap" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Project</th><th>Customer</th><th>Status</th><th>Priority</th>
                  <th>Deadline</th><th>Created By</th><th>Created</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => {
                  const overdue = isOverdue(p.deadline) && !['closed','cancelled'].includes(p.status);
                  return (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</td>
                      <td style={{ color: 'var(--gray-600)', fontSize: 12 }}>{p.customer_name || '—'}</td>
                      <td><StatusBadge s={p.status} /></td>
                      <td><PriorityBadge p={p.priority} /></td>
                      <td>
                        <span className={overdue ? 'overdue' : 'text-sm text-muted'}>
                          {p.deadline ? fmtDate(p.deadline) : '—'}
                        </span>
                        {overdue && <span style={{ marginLeft: 4, fontSize: 10, fontWeight: 700, color: 'var(--danger)' }}>OVERDUE</span>}
                      </td>
                      <td className="text-sm text-muted">{p.created_by_name || '—'}</td>
                      <td className="text-sm text-muted">{fmtDate(p.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      }
    </div>
  );
}

/* ══════════════════════════════════════════════════════════ */
/* ── MAINTENANCE ADMIN TAB ───────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */
function MaintenanceAdminTab() {
  const [visits,  setVisits]  = useState([]);
  const [filter,  setFilter]  = useState('all');
  const [search,  setSearch]  = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { api.maintenanceVisits({}).then(d => { setVisits(d ?? []); setLoading(false); }); }, []);

  const counts = ['all','scheduled','in_progress','completed','cancelled'].reduce((acc, k) => {
    acc[k] = k === 'all' ? visits.length : visits.filter(v => v.status === k).length;
    return acc;
  }, {});
  const pendingReports = visits.filter(v => !v.report_sent && v.status !== 'cancelled').length;

  const filtered = visits.filter(v => {
    const q = search.toLowerCase();
    const matchSearch = !q || v.title.toLowerCase().includes(q) || (v.customer_name||'').toLowerCase().includes(q) || (v.engineer_names||'').toLowerCase().includes(q);
    const matchFilter = filter === 'all' || v.status === filter;
    return matchSearch && matchFilter;
  });

  return (
    <div>
      {/* summary */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { label: 'Total',           count: counts.all,       color: 'var(--primary)' },
          { label: 'Scheduled',       count: counts.scheduled, color: 'var(--warning)' },
          { label: 'In Progress',     count: counts.in_progress, color: '#d97706' },
          { label: 'Completed',       count: counts.completed, color: 'var(--success)' },
          { label: 'Reports Pending', count: pendingReports,   color: pendingReports > 0 ? 'var(--danger)' : 'var(--gray-400)' },
        ].map(({ label, count, color }) => (
          <div key={label} className="card" style={{ padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <span style={{ fontSize: 22, fontWeight: 800, color }}>{count}</span>
            <span style={{ fontSize: 12, color: 'var(--gray-500)', fontWeight: 500 }}>{label}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by visit, customer or engineer…" style={{ flex: 1, minWidth: 200, maxWidth: 340 }} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[['all','All'],['scheduled','Scheduled'],['in_progress','In Progress'],['completed','Completed'],['cancelled','Cancelled']].map(([k,l]) => (
            <button key={k} className={'btn btn-sm ' + (filter === k ? 'btn-primary' : 'btn-ghost')} onClick={() => setFilter(k)}>
              {l} ({counts[k] ?? 0})
            </button>
          ))}
        </div>
      </div>

      {loading ? <p className="text-muted">Loading…</p> : filtered.length === 0
        ? <div className="empty"><div className="empty-icon"><Wrench size={40} strokeWidth={1.2} /></div><p>No visits match</p></div>
        : (
          <div className="card table-wrap" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Visit</th><th>Customer</th><th>Date</th><th>Engineer(s)</th>
                  <th>Status</th><th>Report</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(v => (
                  <tr key={v.id}>
                    <td style={{ fontWeight: 600 }}>{v.title}</td>
                    <td style={{ fontSize: 12, color: 'var(--gray-600)' }}>{v.customer_name}</td>
                    <td className={isOverdue(v.scheduled_date) && v.status === 'scheduled' ? 'overdue' : 'text-sm text-muted'}>{fmtDate(v.scheduled_date)}</td>
                    <td style={{ fontSize: 12, color: 'var(--gray-600)' }}>{v.engineer_names || <span className="text-muted">—</span>}</td>
                    <td><StatusBadge s={v.status} /></td>
                    <td>
                      {v.report_sent_to_customer
                        ? <span className="badge badge-done">Sent to Customer</span>
                        : v.report_sent
                          ? <span className="badge badge-active">Awaiting Review</span>
                          : <span className="badge badge-open">Pending</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
    </div>
  );
}

/* ══════════════════════════════════════════════════════════ */
/* ── SYSTEM STATS TAB ────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */
function StatsTab() {
  const [stats, setStats] = useState(null);
  useEffect(() => { api.adminStats().then(setStats); }, []);
  if (!stats) return <p className="text-muted">Loading…</p>;
  const { users, projects, tasks, maintenance, customers, attachments } = stats;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><UsersIcon size={14} /> Users</div>
        <div className="grid-4">
          <StatCard Icon={UsersIcon}     label="Total Users"    value={users.total}               sub={`${users.active} active`}   color="var(--primary)" />
          <StatCard Icon={Shield}        label="Managers"       value={users.managers}             sub="management role"            color="#7c3aed" />
          <StatCard Icon={Cog}           label="Engineers"      value={users.engineers}            sub="engineering role"           color="#0891b2" />
          <StatCard Icon={UserX}         label="Inactive"       value={users.total - users.active} sub="deactivated"                color="var(--gray-400)" />
        </div>
      </div>
      <div>
        <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><FolderOpen size={14} /> Projects</div>
        <div className="grid-4">
          <StatCard Icon={FolderOpen}    label="Total"          value={projects.total}           sub="all time"               color="var(--primary)" />
          <StatCard Icon={CheckCircle2}  label="Active"         value={projects.active}          sub="in progress"            color="var(--success)" />
          <StatCard Icon={Lock}          label="Closed"         value={projects.closed}          sub="completed"              color="var(--gray-600)" />
          <StatCard Icon={AlertTriangle} label="Overdue"        value={projects.overdue}         sub="past deadline"          color="var(--danger)" />
        </div>
      </div>
      <div>
        <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><CheckSquare size={14} /> Tasks</div>
        <div className="grid-4">
          <StatCard Icon={CheckSquare}   label="Total Tasks"    value={tasks.total}   sub="active & completed"  color="var(--primary)" />
          <StatCard Icon={Inbox}         label="Open"           value={tasks.open}    sub="awaiting action"     color="var(--warning)" />
          <StatCard Icon={CheckCircle2}  label="Completed"      value={tasks.done}    sub="done"                color="var(--success)" />
          <StatCard Icon={Zap}           label="Ad-hoc"         value={tasks.adhoc}   sub="unplanned"           color="#db2777" />
        </div>
      </div>
      <div>
        <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Wrench size={14} /> Maintenance Visits</div>
        <div className="grid-4">
          <StatCard Icon={Wrench}        label="Total MVs"          value={maintenance.total}          sub="all visits"         color="var(--primary)" />
          <StatCard Icon={ClipboardList} label="Reports Pending"    value={maintenance.report_pending} sub="not yet sent"       color="var(--warning)" />
          <StatCard Icon={Send}          label="Reports Sent"       value={maintenance.report_sent}    sub="delivered"          color="var(--success)" />
          <StatCard Icon={Building2}     label="Customers"          value={customers}                  sub="registered clients" color="#0891b2" />
        </div>
      </div>
      <div>
        <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Paperclip size={14} /> Storage</div>
        <div className="grid-2">
          <StatCard Icon={Paperclip}     label="Attachments"    value={attachments.count}               sub="files uploaded"      color="#7c3aed" />
          <StatCard Icon={HardDrive}     label="Storage Used"   value={fileSize(attachments.total_size)} sub="across all projects" color="var(--gray-600)" />
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════ */
/* ── ACTIVITY TAB ────────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */
function ActivityTab() {
  const [events,  setEvents]  = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.adminActivity(100).then(e => { setEvents(e); setLoading(false); }); }, []);

  if (loading) return <p className="text-muted">Loading…</p>;
  if (!events.length) return <div className="empty"><div className="empty-icon"><ScrollText size={40} strokeWidth={1.2} /></div><p>No activity yet</p></div>;

  return (
    <div className="card" style={{ padding: 0 }}>
      <ul style={{ listStyle: 'none' }}>
        {events.map((e, i) => (
          <li key={i} style={{
            display: 'flex', gap: 12, padding: '12px 20px',
            borderBottom: i < events.length - 1 ? '1px solid var(--gray-100)' : 'none',
            alignItems: 'flex-start',
          }}>
            <span style={{ width: 20, display: 'flex', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>{ACTIVITY_ICONS[e.type] || <Bell size={15} color="var(--gray-400)" />}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13 }}>
                <strong>{e.actor}</strong>{' '}
                <span style={{ color: 'var(--gray-600)' }}>{e.description}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 2 }}>
                {timeSince(e.created_at)} · {e.created_at ? new Date(e.created_at).toLocaleString() : ''}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════ */
/* ── DATA EXPORT TAB ─────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */
function DataExportTab() {
  const [exporting, setExporting] = useState({});
  const [done,      setDone]      = useState({});

  async function exportCSV(name, fetchFn, cols) {
    setExporting(e => ({ ...e, [name]: true }));
    try {
      const rows = await fetchFn();
      const header = Object.keys(cols).join(',');
      const body = rows.map(row =>
        Object.values(cols).map(fn => {
          const v = typeof fn === 'function' ? fn(row) : row[fn];
          const s = (v === null || v === undefined) ? '' : String(v);
          return `"${s.replace(/"/g, '""')}"`;
        }).join(',')
      ).join('\n');
      const blob = new Blob([header + '\n' + body], { type: 'text/csv;charset=utf-8;' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `${name}_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setDone(d => ({ ...d, [name]: true }));
      setTimeout(() => setDone(d => ({ ...d, [name]: false })), 3000);
    } finally {
      setExporting(e => ({ ...e, [name]: false }));
    }
  }

  const EXPORTS = [
    {
      name: 'users', label: 'Users', Icon: UsersIcon, color: 'var(--primary)',
      desc: 'All user accounts with role, status and login info',
      fn: () => api.adminUsers(),
      cols: { 'Name': 'name', 'Email': 'email', 'Role': 'role', 'Active': r => r.active ? 'Yes' : 'No', 'Projects': 'project_count', 'Open Tasks': 'open_tasks', 'Joined': 'created_at', 'Last Login': 'last_login' },
    },
    {
      name: 'projects', label: 'Projects', Icon: FolderOpen, color: '#7c3aed',
      desc: 'All projects with status, priority, deadline and customer',
      fn: () => api.projects(),
      cols: { 'Title': 'title', 'Status': 'status', 'Priority': 'priority', 'Deadline': 'deadline', 'Customer': 'customer_name', 'Created By': 'created_by_name', 'Created': 'created_at' },
    },
    {
      name: 'tasks', label: 'Tasks', Icon: CheckSquare, color: 'var(--warning)',
      desc: 'All tasks with assignment, status and deadline',
      fn: () => api.tasks({}),
      cols: { 'Title': 'title', 'Status': 'status', 'Priority': 'priority', 'Assigned To': 'assigned_to_name', 'Project': 'project_title', 'Ad-hoc': r => r.is_adhoc ? 'Yes' : 'No', 'Deadline': 'deadline', 'Created': 'created_at' },
    },
    {
      name: 'maintenance_visits', label: 'Maintenance Visits', Icon: Wrench, color: '#b45309',
      desc: 'All maintenance visits with engineer assignment and report status',
      fn: () => api.maintenanceVisits({}),
      cols: { 'Title': 'title', 'Customer': 'customer_name', 'Date': 'scheduled_date', 'Status': 'status', 'Engineers': 'engineer_names', 'Report Sent': r => r.report_sent ? 'Yes' : 'No', 'Sent to Customer': r => r.report_sent_to_customer ? 'Yes' : 'No' },
    },
    {
      name: 'customers', label: 'Customers', Icon: Building2, color: '#0891b2',
      desc: 'All customer records with contact information',
      fn: () => api.customers(),
      cols: { 'Name': 'name', 'Contact': 'contact_name', 'Email': 'contact_email', 'Phone': 'contact_phone', 'Notes': 'notes', 'Created': 'created_at' },
    },
  ];

  return (
    <div style={{ maxWidth: 680 }}>
      <div className="card" style={{ marginBottom: 20, background: '#eff6ff', border: '1px solid #bfdbfe' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <Database size={16} color="#2563eb" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 13, color: '#1e3a8a' }}>
            All exports are generated client-side as CSV files. Every record currently in the database is included. Data is not filtered by date or status.
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {EXPORTS.map(({ name, label, Icon, color, desc, fn, cols }) => (
          <div key={name} className="card" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px' }}>
            <div style={{ width: 44, height: 44, borderRadius: 10, background: color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Icon size={20} color={color} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{label}</div>
              <div style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 1 }}>{desc}</div>
            </div>
            <button
              className={'btn btn-sm ' + (done[name] ? 'btn-success' : 'btn-ghost')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0, minWidth: 120, justifyContent: 'center' }}
              onClick={() => exportCSV(name, fn, cols)}
              disabled={exporting[name]}
            >
              {exporting[name]
                ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Exporting…</>
                : done[name]
                  ? <><CheckCircle2 size={13} /> Downloaded!</>
                  : <><Download size={13} /> Export CSV</>}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════ */
/* ── INTEGRATIONS TAB ────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */
const DEFAULT_SETTINGS = {
  teams:  { enabled: false, webhook_url: '' },
  webex:  { enabled: false, bot_token: '', mode: 'both', space_id: '', test_email: '' },
  notify_on: { task_assigned: true, project_assigned: true, visit_assigned: true },
};

function Toggle({ checked, onChange, label }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
      <div onClick={() => onChange(!checked)} style={{ width: 40, height: 22, borderRadius: 11, position: 'relative', flexShrink: 0, transition: 'background 0.2s', background: checked ? 'var(--primary)' : 'var(--gray-300)' }}>
        <div style={{ position: 'absolute', top: 3, left: checked ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,.3)' }} />
      </div>
      <span style={{ fontSize: 13 }}>{label}</span>
    </label>
  );
}

function IntegrationsTab() {
  const [cfg,    setCfg]    = useState(DEFAULT_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [testing,setTesting]= useState({});
  const [msg,    setMsg]    = useState('');
  const [err,    setErr]    = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.getIntegrations().then(d => {
      if (d && Object.keys(d).length) {
        setCfg(prev => ({
          teams:     { ...DEFAULT_SETTINGS.teams,     ...d.teams },
          webex:     { ...DEFAULT_SETTINGS.webex,     ...d.webex },
          notify_on: { ...DEFAULT_SETTINGS.notify_on, ...d.notify_on },
        }));
      }
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  const setTeams  = (k, v) => setCfg(c => ({ ...c, teams:     { ...c.teams,     [k]: v } }));
  const setWebex  = (k, v) => setCfg(c => ({ ...c, webex:     { ...c.webex,     [k]: v } }));
  const setNotify = (k, v) => setCfg(c => ({ ...c, notify_on: { ...c.notify_on, [k]: v } }));

  async function save() {
    setSaving(true); setMsg(''); setErr('');
    try { await api.saveIntegrations(cfg); setMsg('Settings saved successfully.'); }
    catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  async function test(platform) {
    setTesting(t => ({ ...t, [platform]: true })); setMsg(''); setErr('');
    try { const r = await api.testIntegration(platform, cfg); setMsg(r.message || `Test sent via ${platform}`); }
    catch (e) { setErr(e.message || 'Test failed'); }
    finally { setTesting(t => ({ ...t, [platform]: false })); }
  }

  if (!loaded) return <p className="text-muted">Loading…</p>;

  const sectionStyle = { background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 10, padding: '20px 24px', marginBottom: 20 };
  const labelStyle   = { fontSize: 12, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6, display: 'block' };

  return (
    <div style={{ maxWidth: 680 }}>
      {msg && <div className="alert alert-success" style={{ marginBottom: 16, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}><CheckCircle2 size={14} /> {msg}</div>}
      {err && <div className="alert alert-danger"  style={{ marginBottom: 16, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}><AlertTriangle size={14} /> {err}</div>}

      <div style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: 8, background: '#e8f0fe', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="4" fill="#4a6cf7"/><path d="M13 7h5v2h-5V7zm0 3h5v2h-5v-2zm-6 5v-8h4a3 3 0 010 6H9v2H7zm2-4h2a1 1 0 000-2H9v2z" fill="white"/></svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Microsoft Teams</div>
            <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>Send notifications via an Incoming Webhook</div>
          </div>
          <Toggle checked={cfg.teams.enabled} onChange={v => setTeams('enabled', v)} label={cfg.teams.enabled ? 'Enabled' : 'Disabled'} />
        </div>
        {cfg.teams.enabled && (
          <>
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Incoming Webhook URL</label>
              <input type="url" value={cfg.teams.webhook_url} onChange={e => setTeams('webhook_url', e.target.value)} placeholder="https://outlook.office.com/webhook/..." />
              <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 4 }}>In Teams: channel → ··· → Connectors → Incoming Webhook → Configure</div>
            </div>
            <button className="btn btn-ghost btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} disabled={!cfg.teams.webhook_url || testing.teams} onClick={() => test('teams')}>
              {testing.teams ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Sending…</> : <><Bell size={13} /> Send Test</>}
            </button>
          </>
        )}
      </div>

      <div style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: 8, background: '#e6f9f0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#00BF6F"/><path d="M8 10a4 4 0 108 0" stroke="white" strokeWidth="2" strokeLinecap="round"/><circle cx="12" cy="14" r="1.5" fill="white"/></svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Cisco Webex</div>
            <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>Send notifications via a Webex Bot</div>
          </div>
          <Toggle checked={cfg.webex.enabled} onChange={v => setWebex('enabled', v)} label={cfg.webex.enabled ? 'Enabled' : 'Disabled'} />
        </div>
        {cfg.webex.enabled && (
          <>
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Bot Access Token</label>
              <input type="password" value={cfg.webex.bot_token} onChange={e => setWebex('bot_token', e.target.value)} placeholder="Your Webex Bot access token" />
              <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 4 }}>Create a bot at <strong>developer.webex.com</strong> and paste its Access Token here.</div>
            </div>
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Delivery Mode</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[['direct','Direct (email)'],['space','Space (room)'],['both','Both']].map(([v,l]) => (
                  <button key={v} className={'btn btn-sm ' + (cfg.webex.mode === v ? 'btn-primary' : 'btn-ghost')} onClick={() => setWebex('mode', v)}>{l}</button>
                ))}
              </div>
            </div>
            {(cfg.webex.mode === 'space' || cfg.webex.mode === 'both') && (
              <div className="form-group" style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Webex Space / Room ID</label>
                <input value={cfg.webex.space_id} onChange={e => setWebex('space_id', e.target.value)} placeholder="Y2lzY29zcGFyazovL3VzL1JPT00v..." />
              </div>
            )}
            {(cfg.webex.mode === 'direct' || cfg.webex.mode === 'both') && (
              <div className="form-group" style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Test Email (for test button only)</label>
                <input type="email" value={cfg.webex.test_email} onChange={e => setWebex('test_email', e.target.value)} placeholder="engineer@yourcompany.com" />
              </div>
            )}
            <button className="btn btn-ghost btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} disabled={!cfg.webex.bot_token || testing.webex} onClick={() => test('webex')}>
              {testing.webex ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Sending…</> : <><Bell size={13} /> Send Test</>}
            </button>
          </>
        )}
      </div>

      {(cfg.teams.enabled || cfg.webex.enabled) && (
        <div style={sectionStyle}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}><Bell size={15} /> Notification Events</div>
          <div style={{ fontSize: 12, color: 'var(--gray-500)', marginBottom: 16 }}>Choose which events trigger a notification.</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Toggle checked={cfg.notify_on.task_assigned}    onChange={v => setNotify('task_assigned', v)}    label="Task assigned to an engineer" />
            <Toggle checked={cfg.notify_on.project_assigned} onChange={v => setNotify('project_assigned', v)} label="Engineer added to a project" />
            <Toggle checked={cfg.notify_on.visit_assigned}   onChange={v => setNotify('visit_assigned', v)}   label="Maintenance visit assigned to an engineer" />
          </div>
        </div>
      )}

      <button className="btn btn-primary" onClick={save} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {saving ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</> : <><Save size={14} /> Save Integration Settings</>}
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════════ */
/* ── Weekly Report Tab ───────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */
const DAY_OPTIONS = [
  { v: 0, l: 'Sunday' }, { v: 1, l: 'Monday' }, { v: 2, l: 'Tuesday' },
  { v: 3, l: 'Wednesday' }, { v: 4, l: 'Thursday' }, { v: 5, l: 'Friday' }, { v: 6, l: 'Saturday' },
];

function WeeklyReportTab() {
  const toast   = useToast();
  const confirm = useConfirm();
  // ── SMTP state ────────────────────────────────────────────
  const [smtp,        setSmtp]        = useState({ host:'', port:587, secure:false, user:'', password:'', from_name:'Solutions Hub', from_email:'' });
  const [smtpSaving,  setSmtpSaving]  = useState(false);
  const [smtpTesting, setSmtpTesting] = useState(false);
  const [smtpMsg,     setSmtpMsg]     = useState(null);
  const [testTo,      setTestTo]      = useState('');

  // ── Schedule state ────────────────────────────────────────
  const [schedule,    setSchedule]    = useState({ enabled: false, day: 1, hour: 9, minute: 0, recipients: [], last_sent: null });
  const [managers,    setManagers]    = useState([]);
  const [schedSaving, setSchedSaving] = useState(false);
  const [schedMsg,    setSchedMsg]    = useState(null);

  // ── Preview / Send state ──────────────────────────────────
  const [preview,     setPreview]     = useState(null);
  const [previewing,  setPreviewing]  = useState(false);
  const [sending,     setSending]     = useState(false);
  const [sendMsg,     setSendMsg]     = useState(null);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    api.getSmtp().then(s => {
      if (s && Object.keys(s).length > 0) setSmtp(prev => ({ ...prev, ...s, password: s.password_set ? '••••••••' : '' }));
    }).catch(() => {});
    api.getReportSchedule().then(setSchedule).catch(() => {});
    api.reportManagers().then(setManagers).catch(() => {});
  }, []);

  async function saveSmtp(e) {
    e.preventDefault();
    setSmtpSaving(true); setSmtpMsg(null);
    try {
      await api.saveSmtp(smtp);
      setSmtpMsg({ ok: true, text: 'SMTP settings saved.' });
    } catch (err) { setSmtpMsg({ ok: false, text: err.message }); }
    finally { setSmtpSaving(false); }
  }

  async function testSmtp() {
    setSmtpTesting(true); setSmtpMsg(null);
    try {
      const res = await api.testSmtp({ ...smtp, password: smtp.password === '••••••••' ? undefined : smtp.password }, testTo || undefined);
      setSmtpMsg({ ok: true, text: res.message || 'Connection successful!' });
    } catch (err) { setSmtpMsg({ ok: false, text: err.message }); }
    finally { setSmtpTesting(false); }
  }

  async function saveSchedule(e) {
    e.preventDefault();
    setSchedSaving(true); setSchedMsg(null);
    try {
      await api.saveReportSchedule(schedule);
      setSchedMsg({ ok: true, text: 'Schedule saved. Scheduler updated.' });
    } catch (err) { setSchedMsg({ ok: false, text: err.message }); }
    finally { setSchedSaving(false); }
  }

  async function loadPreview() {
    setPreviewing(true); setPreview(null);
    try {
      const data = await api.previewReportData();
      setPreview(data);
      setShowPreview(true);
    } catch (err) { toast.error('Preview failed: ' + err.message); }
    finally { setPreviewing(false); }
  }

  async function sendNow() {
    const ok = await confirm('Send the weekly report now to all configured recipients?', { title: 'Send Report Now', label: 'Send', danger: false });
    if (!ok) return;
    setSending(true); setSendMsg(null);
    try {
      const res = await api.sendReportNow();
      setSendMsg({ ok: true, text: res.message });
      // Refresh schedule to update last_sent
      api.getReportSchedule().then(setSchedule).catch(() => {});
    } catch (err) { setSendMsg({ ok: false, text: err.message }); }
    finally { setSending(false); }
  }

  const toggleRecipient = (id) => {
    setSchedule(s => ({
      ...s,
      recipients: s.recipients.includes(id)
        ? s.recipients.filter(r => r !== id)
        : [...s.recipients, id],
    }));
  };

  const set    = k => e => setSmtp(s => ({ ...s, [k]: e.target.value }));
  const setSch = k => e => setSchedule(s => ({ ...s, [k]: e.target.value !== undefined ? (isNaN(e.target.value) ? e.target.value : Number(e.target.value)) : e.target.checked }));

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--gray-900)', marginBottom: 4 }}>Weekly Status Report</h2>
          <p style={{ fontSize: 13, color: 'var(--gray-500)' }}>
            Automatically email a comprehensive status report to management each week.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost btn-sm" onClick={loadPreview} disabled={previewing} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {previewing ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <ScrollText size={13} />}
            Preview Report
          </button>
          <button className="btn btn-primary btn-sm" onClick={sendNow} disabled={sending} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {sending ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={13} />}
            Send Now
          </button>
        </div>
      </div>

      {sendMsg && (
        <div className={`alert ${sendMsg.ok ? 'alert-success' : 'alert-warning'}`} style={{ marginBottom: 16 }}>
          {sendMsg.ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />} {sendMsg.text}
        </div>
      )}

      {/* ── Last sent info ── */}
      {schedule.last_sent && (
        <div style={{ background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: 13, color: 'var(--gray-600)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <CheckCircle2 size={14} color="var(--success)" />
          Last report sent: <strong>{new Date(schedule.last_sent).toLocaleString()}</strong>
        </div>
      )}

      <div className="grid-2" style={{ gap: 20, alignItems: 'start' }}>

        {/* ── Left: SMTP config ── */}
        <div className="card" style={{ padding: '20px 24px' }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <AtSign size={15} color="var(--primary)" /> Email SMTP Configuration
          </h3>
          {smtpMsg && (
            <div className={`alert ${smtpMsg.ok ? 'alert-success' : 'alert-warning'}`} style={{ marginBottom: 12 }}>
              {smtpMsg.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />} {smtpMsg.text}
            </div>
          )}
          <form onSubmit={saveSmtp}>
            <div className="form-row">
              <div className="form-group">
                <label>SMTP Host</label>
                <input value={smtp.host || ''} onChange={set('host')} placeholder="smtp.gmail.com" required />
              </div>
              <div className="form-group" style={{ maxWidth: 100 }}>
                <label>Port</label>
                <input type="number" value={smtp.port || 587} onChange={set('port')} />
              </div>
            </div>
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={!!smtp.secure} onChange={e => setSmtp(s => ({ ...s, secure: e.target.checked }))} style={{ width: 'auto' }} />
                Use SSL/TLS (port 465)
              </label>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Username / Email</label>
                <input value={smtp.user || ''} onChange={set('user')} placeholder="noreply@company.com" />
              </div>
              <div className="form-group">
                <label>Password</label>
                <input type="password" value={smtp.password || ''} onChange={set('password')} placeholder="•••••••" />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>From Name</label>
                <input value={smtp.from_name || ''} onChange={set('from_name')} placeholder="Solutions Hub" />
              </div>
              <div className="form-group">
                <label>From Email</label>
                <input value={smtp.from_email || ''} onChange={set('from_email')} placeholder="noreply@company.com" />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button type="submit" className="btn btn-primary btn-sm" disabled={smtpSaving} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {smtpSaving ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={13} />} Save SMTP
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={smtpTesting} onClick={testSmtp} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {smtpTesting ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Bell size={13} />} Test Connection
              </button>
            </div>
            <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
              <input value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="Send test email to…" style={{ flex: 1, fontSize: 13 }} />
            </div>
          </form>
        </div>

        {/* ── Right: Schedule config ── */}
        <div className="card" style={{ padding: '20px 24px' }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Settings size={15} color="var(--primary)" /> Report Schedule
          </h3>
          {schedMsg && (
            <div className={`alert ${schedMsg.ok ? 'alert-success' : 'alert-warning'}`} style={{ marginBottom: 12 }}>
              {schedMsg.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />} {schedMsg.text}
            </div>
          )}
          <form onSubmit={saveSchedule}>
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={!!schedule.enabled} onChange={e => setSchedule(s => ({ ...s, enabled: e.target.checked }))} style={{ width: 'auto' }} />
                <span style={{ fontWeight: 600 }}>Enable automatic weekly report</span>
              </label>
              {!schedule.enabled && (
                <p style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 4 }}>Enable to have the report sent automatically on schedule.</p>
              )}
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Send On</label>
                <select value={schedule.day ?? 1} onChange={setSch('day')}>
                  {DAY_OPTIONS.map(d => <option key={d.v} value={d.v}>{d.l}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>At (Hour)</label>
                <select value={schedule.hour ?? 9} onChange={setSch('hour')}>
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label>Recipients — Managers</label>
              {managers.length === 0
                ? <p style={{ fontSize: 13, color: 'var(--gray-400)' }}>No active managers found.</p>
                : <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                    {managers.map(m => (
                      <label key={m.id} style={{
                        display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                        padding: '6px 10px', borderRadius: 6, border: '1px solid var(--gray-200)',
                        background: schedule.recipients?.includes(m.id) ? '#eff6ff' : 'transparent',
                        fontSize: 13,
                      }}>
                        <input type="checkbox" style={{ width: 'auto' }}
                          checked={schedule.recipients?.includes(m.id) || false}
                          onChange={() => toggleRecipient(m.id)} />
                        <span style={{ fontWeight: 600 }}>{m.name}</span>
                        <span style={{ color: 'var(--gray-400)', fontSize: 12 }}>{m.email || '—'}</span>
                      </label>
                    ))}
                  </div>
              }
            </div>

            <button type="submit" className="btn btn-primary btn-sm" disabled={schedSaving} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {schedSaving ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={13} />} Save Schedule
            </button>
          </form>
        </div>
      </div>

      {/* ── Report Sections Overview ── */}
      <div className="card" style={{ marginTop: 20, padding: '20px 24px' }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <ScrollText size={15} color="var(--primary)" /> Report Contents
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
          {[
            { emoji: '📁', title: 'Projects Opened',         desc: 'New projects from the past 7 days' },
            { emoji: '📅', title: 'Upcoming Deadlines',      desc: 'Projects & tasks due in 14 days' },
            { emoji: '🔴', title: 'High-Priority Tasks',     desc: 'All open high-priority tasks' },
            { emoji: '🔧', title: 'Maintenance Visits',      desc: 'Visits ±7 days with report status' },
            { emoji: '📄', title: 'Reports Pending',         desc: 'Visits with no submitted report' },
            { emoji: '👷', title: 'Engineer Workload',       desc: 'Tasks, completed & overdue per engineer' },
            { emoji: '⏳', title: 'Closure Approvals',       desc: 'Projects awaiting closure sign-off' },
            { emoji: '📊', title: 'SLA Compliance',          desc: 'Breach summary for all 4 SLA metrics' },
            { emoji: '🏢', title: 'New Customers',           desc: 'Customers added this week' },
          ].map(s => (
            <div key={s.title} style={{ padding: '10px 12px', background: 'var(--gray-50)', borderRadius: 8, border: '1px solid var(--gray-100)' }}>
              <div style={{ fontSize: 14, marginBottom: 2 }}>{s.emoji} <strong style={{ fontSize: 13 }}>{s.title}</strong></div>
              <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>{s.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Preview Modal ── */}
      {showPreview && preview && (
        <Modal title="Report Preview" onClose={() => setShowPreview(false)} width={780}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 8 }}>
              <strong>Subject:</strong> {preview.subject}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              {[
                { label: 'Active Projects',  val: preview.stats?.activeProjects },
                { label: 'Open Tasks',       val: preview.stats?.openTasks },
                { label: 'Overdue Projects', val: preview.stats?.overdueProjects },
                { label: 'Pending Closure',  val: preview.stats?.pendingClosure },
              ].map(s => (
                <div key={s.label} style={{ background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 8, padding: '8px 14px', textAlign: 'center', minWidth: 90 }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--primary)' }}>{s.val ?? 0}</div>
                  <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>{s.label}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8, marginBottom: 12 }}>
              {[
                { emoji: '📁', label: 'Projects opened',   val: preview.projectsOpened?.length },
                { emoji: '📅', label: 'Upcoming deadlines',val: preview.upcomingDeadlines?.length },
                { emoji: '🔴', label: 'High-pri tasks',    val: preview.highPriorityTasks?.length },
                { emoji: '🔧', label: 'MV this period',    val: preview.maintenanceVisits?.length },
                { emoji: '📄', label: 'Reports pending',   val: preview.reportsPending?.length },
                { emoji: '⏳', label: 'Pending closure',   val: preview.closurePending?.length },
              ].map(s => (
                <div key={s.label} style={{ padding: '8px 12px', background: 'var(--gray-50)', borderRadius: 6, border: '1px solid var(--gray-100)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{s.emoji}</span>
                  <span style={{ fontSize: 12, color: 'var(--gray-600)', flex: 1 }}>{s.label}</span>
                  <strong style={{ fontSize: 14 }}>{s.val ?? 0}</strong>
                </div>
              ))}
            </div>
            <a
              href="/api/report-settings/preview"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost btn-sm"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}
            >
              <ExternalLink size={12} /> Open Full HTML Preview in new tab
            </a>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════ */
/* ── STATUS MANAGEMENT TAB ───────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */

const COLOR_PRESETS = [
  { bg: '#eff6ff', text: '#1e40af', dot: '#3b82f6', name: 'Blue'   },
  { bg: '#fef9c3', text: '#854d0e', dot: '#eab308', name: 'Yellow' },
  { bg: '#fff7ed', text: '#9a3412', dot: '#f97316', name: 'Orange' },
  { bg: '#faf5ff', text: '#6b21a8', dot: '#a855f7', name: 'Purple' },
  { bg: '#dcfce7', text: '#166534', dot: '#22c55e', name: 'Green'  },
  { bg: '#d1fae5', text: '#065f46', dot: '#10b981', name: 'Teal'   },
  { bg: '#fee2e2', text: '#991b1b', dot: '#ef4444', name: 'Red'    },
  { bg: '#fef3c7', text: '#92400e', dot: '#f59e0b', name: 'Amber'  },
  { bg: '#f1f5f9', text: '#475569', dot: '#94a3b8', name: 'Slate'  },
  { bg: '#dbeafe', text: '#1d4ed8', dot: '#3b82f6', name: 'Indigo' },
  { bg: '#fce7f3', text: '#9d174d', dot: '#ec4899', name: 'Pink'   },
  { bg: '#f0fdf4', text: '#065f46', dot: '#86efac', name: 'Lime'   },
];

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function StatusRow({ status, onUpdate, onDelete, onMoveUp, onMoveDown, isFirst, isLast }) {
  const [editing, setEditing] = useState(false);
  const [editLabel, setEditLabel] = useState(status.label);
  const [editValue, setEditValue] = useState(status.value);
  const [showColors, setShowColors] = useState(false);

  function save() {
    if (!editLabel.trim()) return;
    const val = editValue.trim() || slugify(editLabel.trim());
    onUpdate({ ...status, label: editLabel.trim(), value: val });
    setEditing(false);
    setShowColors(false);
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
      background: 'var(--gray-50)', borderRadius: 8, border: '1px solid var(--gray-200)',
      flexWrap: 'wrap',
    }}>
      {/* Color preview */}
      <span style={{
        width: 26, height: 26, borderRadius: 6, flexShrink: 0,
        background: status.bg, border: `2px solid ${status.dot}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
      }} onClick={() => setShowColors(v => !v)} title="Change colour">
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: status.dot }} />
      </span>

      {/* Color picker popup */}
      {showColors && (
        <div style={{
          position: 'absolute', zIndex: 100, background: '#fff', border: '1px solid var(--gray-200)',
          borderRadius: 10, padding: 10, boxShadow: '0 8px 24px rgba(0,0,0,.12)',
          display: 'flex', flexWrap: 'wrap', gap: 6, width: 200,
        }}>
          {COLOR_PRESETS.map(p => (
            <span key={p.name} title={p.name}
              onClick={() => { onUpdate({ ...status, bg: p.bg, text: p.text, dot: p.dot }); setShowColors(false); }}
              style={{ width: 28, height: 28, borderRadius: 6, cursor: 'pointer', background: p.bg, border: `2px solid ${p.dot}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.dot }} />
            </span>
          ))}
        </div>
      )}

      {/* Label & value */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              value={editLabel}
              onChange={e => setEditLabel(e.target.value)}
              placeholder="Label"
              style={{ flex: 1, minWidth: 120, fontSize: 13, padding: '4px 8px' }}
              onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
              autoFocus
            />
            <input
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              placeholder="value_slug"
              style={{ width: 130, fontSize: 12, padding: '4px 8px', fontFamily: 'monospace', color: 'var(--gray-500)' }}
            />
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>{status.label}</span>
            <code style={{ fontSize: 11, color: 'var(--gray-400)', background: 'var(--gray-100)', padding: '1px 5px', borderRadius: 4 }}>{status.value}</code>
          </div>
        )}
      </div>

      {/* Toggles */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, color: 'var(--gray-500)', whiteSpace: 'nowrap', userSelect: 'none' }}>
        <input type="checkbox" checked={!!status.requires_reason} style={{ width: 'auto' }}
          onChange={e => onUpdate({ ...status, requires_reason: e.target.checked })} />
        Requires reason
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, color: 'var(--gray-500)', whiteSpace: 'nowrap', userSelect: 'none' }}>
        <input type="checkbox" checked={!!status.is_terminal} style={{ width: 'auto' }}
          onChange={e => onUpdate({ ...status, is_terminal: e.target.checked })} />
        Terminal
      </label>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {!isFirst && <button className="btn btn-sm btn-ghost" onClick={onMoveUp} style={{ padding: '3px 5px' }}><ChevronUp size={12} /></button>}
        {!isLast  && <button className="btn btn-sm btn-ghost" onClick={onMoveDown} style={{ padding: '3px 5px' }}><ChevronDown size={12} /></button>}
        {editing ? (
          <>
            <button className="btn btn-sm btn-primary" onClick={save} style={{ padding: '3px 8px', fontSize: 11 }}>Save</button>
            <button className="btn btn-sm btn-ghost" onClick={() => { setEditing(false); setEditLabel(status.label); setEditValue(status.value); }} style={{ padding: '3px 6px' }}>✕</button>
          </>
        ) : (
          <button className="btn btn-sm btn-ghost" onClick={() => setEditing(true)} style={{ padding: '3px 5px' }}><Pencil size={12} /></button>
        )}
        <button className="btn btn-sm btn-danger" onClick={onDelete} style={{ padding: '3px 5px' }}><Trash2 size={12} /></button>
      </div>
    </div>
  );
}

function StatusSection({ title, statuses, onChange }) {
  function update(idx, updated) {
    const next = [...statuses];
    next[idx] = updated;
    onChange(next);
  }
  function remove(idx) {
    onChange(statuses.filter((_, i) => i !== idx));
  }
  function moveUp(idx) {
    if (idx === 0) return;
    const next = [...statuses];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    onChange(next);
  }
  function moveDown(idx) {
    if (idx === statuses.length - 1) return;
    const next = [...statuses];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    onChange(next);
  }
  function addNew() {
    onChange([...statuses, { value: 'new_status_' + Date.now(), label: 'New Status', bg: '#f1f5f9', text: '#475569', dot: '#94a3b8', requires_reason: false, is_terminal: false }]);
  }

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--gray-800)' }}>{title}</h3>
        <button className="btn btn-sm btn-ghost" onClick={addNew} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Plus size={12} /> Add Status
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, position: 'relative' }}>
        {statuses.map((s, i) => (
          <StatusRow
            key={s.value + i}
            status={s}
            onUpdate={updated => update(i, updated)}
            onDelete={() => remove(i)}
            onMoveUp={() => moveUp(i)}
            onMoveDown={() => moveDown(i)}
            isFirst={i === 0}
            isLast={i === statuses.length - 1}
          />
        ))}
        {statuses.length === 0 && (
          <p className="text-muted text-sm" style={{ padding: '12px 0' }}>No statuses defined. Click "+ Add Status" to add one.</p>
        )}
      </div>
    </div>
  );
}

function StatusManagementTab() {
  const statusCtx = useStatuses();
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (statusCtx?.config && !draft) {
      setDraft(JSON.parse(JSON.stringify(statusCtx.config)));
    }
  }, [statusCtx?.config]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!draft) return;
    setSaving(true); setMsg(''); setErr('');
    try {
      await api.saveStatuses(draft);
      await statusCtx.reload();
      setMsg('Status configuration saved successfully.');
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  if (!draft) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--gray-400)', padding: '24px 0' }}>
      <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Loading status config…
    </div>
  );

  return (
    <div style={{ maxWidth: 740 }}>
      {/* Info banner */}
      <div className="card" style={{ marginBottom: 24, background: '#eff6ff', border: '1px solid #bfdbfe' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <Tag size={16} color="#2563eb" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 13, color: '#1e3a8a' }}>
            Customise the statuses available for Projects, Tasks, and Maintenance Visits.
            Changes take effect immediately for all users. Click the colour dot to change the badge colour.
            Check <strong>Requires reason</strong> to prompt users for a note when selecting that status.
            Check <strong>Terminal</strong> to mark it as a final/closed state.
          </div>
        </div>
      </div>

      {msg && <div className="alert alert-success" style={{ marginBottom: 16, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}><CheckCircle2 size={14} /> {msg}</div>}
      {err && <div className="alert alert-danger"  style={{ marginBottom: 16, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}><AlertTriangle size={14} /> {err}</div>}

      <StatusSection
        title="Project Statuses"
        statuses={draft.project || []}
        onChange={list => setDraft(d => ({ ...d, project: list }))}
      />
      <StatusSection
        title="Task Statuses"
        statuses={draft.task || []}
        onChange={list => setDraft(d => ({ ...d, task: list }))}
      />
      <StatusSection
        title="Maintenance Visit Statuses"
        statuses={draft.visit || []}
        onChange={list => setDraft(d => ({ ...d, visit: list }))}
      />

      <div style={{ display: 'flex', gap: 10, paddingTop: 8 }}>
        <button className="btn btn-primary" onClick={save} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {saving ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</> : <><Save size={14} /> Save All Changes</>}
        </button>
        <button className="btn btn-ghost" onClick={() => setDraft(JSON.parse(JSON.stringify(statusCtx.config)))} disabled={saving}>
          Reset to Last Saved
        </button>
      </div>
    </div>
  );
}

/* ── Localization Tab ────────────────────────────────────── */
const LANGUAGES = [
  { code: 'en', label: 'English' }, { code: 'el', label: 'Greek' },
  { code: 'de', label: 'German' }, { code: 'fr', label: 'French' },
  { code: 'es', label: 'Spanish' }, { code: 'it', label: 'Italian' },
  { code: 'ar', label: 'Arabic' }, { code: 'tr', label: 'Turkish' },
  { code: 'ru', label: 'Russian' }, { code: 'zh', label: 'Chinese' },
];
const TIMEZONES = [
  'Asia/Nicosia','UTC','Europe/London','Europe/Paris','Europe/Berlin','Europe/Athens',
  'Europe/Moscow','America/New_York','America/Chicago','America/Denver','America/Los_Angeles',
  'Asia/Dubai','Asia/Riyadh','Asia/Kolkata','Asia/Singapore','Asia/Tokyo','Australia/Sydney',
  'Pacific/Auckland',
];
const DATE_FORMATS = ['DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD','D MMM YYYY','MMM D, YYYY'];
const NUMBER_FORMATS = ['1,000.00','1.000,00','1 000.00','1000.00'];

function LocalizationTab() {
  const toast = useToast();
  const DEFAULT = { default_language:'en', supported_languages:['en','el'], date_format:'DD/MM/YYYY', time_format:'24h', number_format:'1,000.00', timezone:'Asia/Nicosia' };
  const [cfg, setCfg]     = useState(DEFAULT);
  const [saved, setSaved] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { api.getLocalization().then(d => { if (d) { setCfg(d); setSaved(d); } setLoading(false); }).catch(() => setLoading(false)); }, []);

  const set = (k, v) => setCfg(c => ({ ...c, [k]: v }));
  const toggleLang = code => set('supported_languages',
    cfg.supported_languages.includes(code)
      ? cfg.supported_languages.filter(l => l !== code)
      : [...cfg.supported_languages, code]
  );
  const dirty = JSON.stringify(cfg) !== JSON.stringify(saved);

  async function save() {
    setSaving(true);
    try { await api.saveLocalization(cfg); setSaved({ ...cfg }); toast.success('Localization settings saved'); }
    catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  if (loading) return <p className="text-muted">Loading…</p>;

  return (
    <div style={{ maxWidth: 720 }}>
      {/* Language */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <h3 style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7 }}>
            <Globe size={15} /> Language &amp; Region
          </h3>
        </div>
        <div className="form-group">
          <label>Default Language</label>
          <select value={cfg.default_language} onChange={e => set('default_language', e.target.value)} style={{ maxWidth: 240 }}>
            {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Supported Languages</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
            {LANGUAGES.map(l => {
              const on = cfg.supported_languages.includes(l.code);
              return (
                <label key={l.code} style={{
                  display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer',
                  padding: '4px 10px', borderRadius: 6, fontSize: 13,
                  background: on ? '#dbeafe' : 'var(--gray-100)',
                  border: on ? '1px solid #93c5fd' : '1px solid transparent', userSelect: 'none',
                }}>
                  <input type="checkbox" checked={on} onChange={() => toggleLang(l.code)} style={{ width: 'auto' }} />
                  {l.label}
                </label>
              );
            })}
          </div>
          <p className="text-sm text-muted mt-4">Languages available for user selection in the interface.</p>
        </div>
        <div className="form-group">
          <label>Time Zone</label>
          <select value={cfg.timezone} onChange={e => set('timezone', e.target.value)} style={{ maxWidth: 280 }}>
            {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
          </select>
        </div>
      </div>

      {/* Date & Time */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <h3 style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7 }}>
            <Clock size={15} /> Date, Time &amp; Numbers
          </h3>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Date Format</label>
            <select value={cfg.date_format} onChange={e => set('date_format', e.target.value)}>
              {DATE_FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Time Format</label>
            <select value={cfg.time_format} onChange={e => set('time_format', e.target.value)}>
              <option value="24h">24-hour (14:30)</option>
              <option value="12h">12-hour (2:30 PM)</option>
            </select>
          </div>
        </div>
        <div className="form-group">
          <label>Number Format</label>
          <select value={cfg.number_format} onChange={e => set('number_format', e.target.value)} style={{ maxWidth: 200 }}>
            {NUMBER_FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <p className="text-sm text-muted mt-4">Example: {cfg.number_format === '1.000,00' ? '1.234,56' : cfg.number_format === '1 000.00' ? '1 234.56' : cfg.number_format === '1000.00' ? '1234.56' : '1,234.56'}</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn btn-primary" disabled={!dirty || saving} onClick={save}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {saving ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={14} />}
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
        {dirty && <button className="btn btn-ghost" onClick={() => setCfg({ ...saved })}>Discard Changes</button>}
      </div>
    </div>
  );
}

/* ── Admin Alerts Tab ────────────────────────────────────── */
const ALERT_TYPES = [
  { key: 'background_job_failed',      label: 'Background job failed',           desc: 'A scheduled or background task did not complete successfully.' },
  { key: 'email_queue_failed',         label: 'Email queue has failed messages',  desc: 'One or more outbound emails could not be delivered.' },
  { key: 'db_backup_failed',           label: 'Database backup failed',           desc: 'The automatic database backup job failed.' },
  { key: 'storage_almost_full',        label: 'File storage almost full',         desc: 'Upload storage is approaching the configured threshold.' },
  { key: 'high_error_rate',            label: 'High error rate detected',         desc: 'The number of application errors has exceeded the threshold.' },
  { key: 'unauthorized_access',        label: 'Unauthorized access attempt',      desc: 'Repeated failed login attempts or forbidden access detected.' },
  { key: 'integration_token_expiring', label: 'Integration token expiring',       desc: 'A webhook or API token is missing or about to expire.' },
];
const ALERT_DEFAULT = Object.fromEntries(ALERT_TYPES.map(a => [a.key, { enabled: true, email: false }]));

function AdminAlertsTab() {
  const toast = useToast();
  const [prefs, setPrefs]   = useState(ALERT_DEFAULT);
  const [saved, setSaved]   = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [lastCheck, setLastCheck] = useState(null);
  const [recentAlerts, setRecentAlerts] = useState([]);

  useEffect(() => {
    Promise.all([api.getAdminNotifications(), api.notifications()])
      .then(([p, notes]) => {
        setPrefs(p); setSaved(p);
        const list = notes.notifications || notes || [];
        setRecentAlerts(list.filter(n => n.type === 'system_alert').slice(0, 20));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const setToggle = (key, field, val) => setPrefs(p => ({ ...p, [key]: { ...p[key], [field]: val } }));
  const dirty = JSON.stringify(prefs) !== JSON.stringify(saved);

  async function save() {
    setSaving(true);
    try { await api.saveAdminNotifications(prefs); setSaved({ ...prefs }); toast.success('Alert preferences saved'); }
    catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  async function runCheck() {
    setChecking(true);
    try {
      const result = await api.runSystemCheck();
      setLastCheck(result);
      const notes = await api.notifications();
      const list = notes.notifications || notes || [];
      setRecentAlerts(list.filter(n => n.type === 'system_alert').slice(0, 20));
    } catch (e) { toast.error(e.message); }
    finally { setChecking(false); }
  }

  if (loading) return <p className="text-muted">Loading…</p>;

  const LEVEL_COLORS = { warning: { bg: '#fef3c7', text: '#92400e', dot: '#f59e0b' }, error: { bg: '#fee2e2', text: '#991b1b', dot: '#ef4444' }, ok: { bg: '#dcfce7', text: '#166534', dot: '#22c55e' } };

  return (
    <div style={{ maxWidth: 800 }}>
      {/* Live check card */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7 }}>
            <ShieldAlert size={15} /> System Health Check
          </h3>
          <button className="btn btn-ghost btn-sm" onClick={runCheck} disabled={checking}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            {checking ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={13} />}
            {checking ? 'Checking…' : 'Run Check Now'}
          </button>
        </div>

        {lastCheck ? (
          <div>
            <p style={{ fontSize: 12, color: 'var(--gray-400)', marginBottom: 10 }}>
              Last checked: {new Date(lastCheck.checked_at).toLocaleString()}
            </p>
            {lastCheck.alerts.length === 0
              ? <div style={{ padding: '10px 14px', background: '#dcfce7', borderRadius: 8, color: '#166534', fontSize: 13 }}>✅ All systems healthy — no issues detected.</div>
              : lastCheck.alerts.map((a, i) => {
                  const c = LEVEL_COLORS[a.level] || LEVEL_COLORS.warning;
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 12px', background: c.bg, borderRadius: 8, color: c.text, fontSize: 13, marginBottom: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.dot, flexShrink: 0, marginTop: 4 }} />
                      <div><strong>{a.type.replace(/_/g, ' ')}</strong><br /><span style={{ opacity: .85 }}>{a.message}</span></div>
                    </div>
                  );
                })
            }
          </div>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--gray-400)' }}>Click "Run Check Now" to scan for issues.</p>
        )}
      </div>

      {/* Alert preferences */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <h3 style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7 }}>
            <Bell size={15} /> Alert Preferences
          </h3>
          <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>In-App / Email</span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '6px 0', fontSize: 11, color: 'var(--gray-400)', fontWeight: 600, borderBottom: '1px solid var(--gray-100)' }}>Alert</th>
              <th style={{ textAlign: 'center', padding: '6px 8px', fontSize: 11, color: 'var(--gray-400)', fontWeight: 600, borderBottom: '1px solid var(--gray-100)', width: 80 }}>Enabled</th>
              <th style={{ textAlign: 'center', padding: '6px 8px', fontSize: 11, color: 'var(--gray-400)', fontWeight: 600, borderBottom: '1px solid var(--gray-100)', width: 80 }}>Email</th>
            </tr>
          </thead>
          <tbody>
            {ALERT_TYPES.map(a => (
              <tr key={a.key} style={{ borderBottom: '1px solid var(--gray-100)' }}>
                <td style={{ padding: '10px 0' }}>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{a.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 1 }}>{a.desc}</div>
                </td>
                <td style={{ textAlign: 'center', padding: '10px 8px' }}>
                  <input type="checkbox" checked={prefs[a.key]?.enabled ?? true}
                    onChange={e => setToggle(a.key, 'enabled', e.target.checked)}
                    style={{ width: 15, height: 15, cursor: 'pointer', accentColor: 'var(--primary)' }} />
                </td>
                <td style={{ textAlign: 'center', padding: '10px 8px' }}>
                  <input type="checkbox" checked={prefs[a.key]?.email ?? false}
                    onChange={e => setToggle(a.key, 'email', e.target.checked)}
                    disabled={!prefs[a.key]?.enabled}
                    style={{ width: 15, height: 15, cursor: 'pointer', accentColor: 'var(--primary)', opacity: prefs[a.key]?.enabled ? 1 : 0.4 }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Recent system alerts */}
      {recentAlerts.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <h3 style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7 }}>
              <AlertTriangle size={15} /> Recent System Alerts
            </h3>
          </div>
          {recentAlerts.map(n => (
            <div key={n.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid var(--gray-100)', fontSize: 13 }}>
              <div>
                <span style={{ fontWeight: 500 }}>{n.title}</span>
                {n.body && <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 2 }}>{n.body}</div>}
              </div>
              <span style={{ fontSize: 11, color: 'var(--gray-400)', whiteSpace: 'nowrap', marginLeft: 16 }}>{timeSince(n.created_at)}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn btn-primary" disabled={!dirty || saving} onClick={save}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {saving ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={14} />}
          {saving ? 'Saving…' : 'Save Preferences'}
        </button>
        {dirty && <button className="btn btn-ghost" onClick={() => setPrefs({ ...saved })}>Discard Changes</button>}
      </div>
    </div>
  );
}

/* ── Logging Settings Tab ────────────────────────────────── */
const DEFAULT_LOGGING = {
  log_level: 'info', logging_provider: 'file', log_retention_days: 30,
  structured_logging: true, correlation_id_enabled: true, request_logging: true,
  exception_logging: true, sensitive_data_masking: false, log_download_enabled: true,
};

function ToggleRow({ label, description, value, onChange, recommended }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--gray-100)' }}>
      <div>
        <div style={{ fontWeight: 500, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
          {label}
          {recommended && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: '#dcfce7', color: '#166534' }}>Recommended</span>}
        </div>
        {description && <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 2 }}>{description}</div>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        style={{
          width: 42, height: 24, borderRadius: 99, border: 'none', cursor: 'pointer',
          background: value ? 'var(--primary)' : 'var(--gray-300)',
          position: 'relative', transition: 'background .2s', flexShrink: 0,
        }}
      >
        <span style={{
          position: 'absolute', top: 3, left: value ? 21 : 3, width: 18, height: 18,
          borderRadius: '50%', background: '#fff', transition: 'left .2s',
          boxShadow: '0 1px 3px rgba(0,0,0,.2)',
        }} />
      </button>
    </div>
  );
}

function LoggingTab() {
  const toast = useToast();
  const [cfg, setCfg]     = useState(DEFAULT_LOGGING);
  const [saved, setSaved] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getLogging().then(d => { if (d) { setCfg(d); setSaved(d); } setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const set = (k, v) => setCfg(c => ({ ...c, [k]: v }));
  const dirty = JSON.stringify(cfg) !== JSON.stringify(saved);

  async function save() {
    setSaving(true);
    try { await api.saveLogging(cfg); setSaved({ ...cfg }); toast.success('Logging settings saved'); }
    catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  if (loading) return <p className="text-muted">Loading…</p>;

  return (
    <div style={{ maxWidth: 720 }}>
      {/* Log Configuration */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <h3 style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7 }}>
            <ScrollText size={15} /> Log Configuration
          </h3>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Log Level</label>
            <select value={cfg.log_level} onChange={e => set('log_level', e.target.value)}>
              <option value="error">Error</option>
              <option value="warning">Warning</option>
              <option value="info">Info</option>
              <option value="debug">Debug</option>
            </select>
            <p className="text-sm text-muted mt-4">Controls verbosity. Debug captures the most detail.</p>
          </div>
          <div className="form-group">
            <label>Logging Provider</label>
            <select value={cfg.logging_provider} onChange={e => set('logging_provider', e.target.value)}>
              <option value="file">File</option>
              <option value="database">Database</option>
              <option value="application_insights">Application Insights</option>
              <option value="seq">Seq</option>
            </select>
            <p className="text-sm text-muted mt-4">Where logs are persisted.</p>
          </div>
        </div>

        <div className="form-group">
          <label>Log Retention</label>
          <select value={cfg.log_retention_days} onChange={e => set('log_retention_days', Number(e.target.value))} style={{ maxWidth: 200 }}>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={180}>180 days</option>
          </select>
          <p className="text-sm text-muted mt-4">Logs older than this will be purged automatically.</p>
        </div>
      </div>

      {/* Feature toggles */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <h3 style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7 }}>
            <Zap size={15} /> Logging Features
          </h3>
        </div>
        <ToggleRow
          label="Structured Logging" recommended
          description="Emit logs as JSON for easier parsing and filtering."
          value={cfg.structured_logging} onChange={v => set('structured_logging', v)}
        />
        <ToggleRow
          label="Correlation ID"
          description="Attach a unique ID to every request to trace actions across services."
          value={cfg.correlation_id_enabled} onChange={v => set('correlation_id_enabled', v)}
        />
        <ToggleRow
          label="Request Logging"
          description="Log all incoming HTTP requests (method, path, status, duration)."
          value={cfg.request_logging} onChange={v => set('request_logging', v)}
        />
        <ToggleRow
          label="Exception Logging"
          description="Capture and log all unhandled exceptions with stack traces."
          value={cfg.exception_logging} onChange={v => set('exception_logging', v)}
        />
        <ToggleRow
          label="Sensitive Data Masking"
          description="Automatically redact passwords, tokens, and email addresses from logs."
          value={cfg.sensitive_data_masking} onChange={v => set('sensitive_data_masking', v)}
        />
        <ToggleRow
          label="Log Download"
          description="Allow admins to export activity logs as a CSV file for troubleshooting."
          value={cfg.log_download_enabled} onChange={v => set('log_download_enabled', v)}
        />
      </div>

      {/* Log download */}
      {cfg.log_download_enabled && saved?.log_download_enabled && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <h3 style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7 }}>
              <Download size={15} /> Export Logs
            </h3>
          </div>
          <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 14 }}>
            Download recent application activity as a CSV file (up to last 1 000 entries).
            {cfg.sensitive_data_masking && <strong> Sensitive data masking is active.</strong>}
          </p>
          <button className="btn btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            onClick={() => api.downloadLogs()}>
            <Download size={14} /> Download Log CSV
          </button>
        </div>
      )}

      {/* Save */}
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn btn-primary" disabled={!dirty || saving} onClick={save}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {saving ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={14} />}
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
        {dirty && (
          <button className="btn btn-ghost" onClick={() => setCfg({ ...saved })}>Discard Changes</button>
        )}
      </div>
    </div>
  );
}

/* ── System Update Tab ───────────────────────────────────── */
const PHASE_LABELS = {
  idle:           { label: 'Idle',                     color: 'var(--gray-400)' },
  queued:         { label: 'Queued…',                  color: 'var(--primary)'  },
  install_server: { label: 'Installing server deps…',  color: 'var(--primary)'  },
  install_client: { label: 'Installing client deps…',  color: 'var(--primary)'  },
  build_client:   { label: 'Building client app…',     color: 'var(--warning)'  },
  done:           { label: 'Complete ✓',               color: 'var(--success)'  },
  error:          { label: 'Failed',                   color: 'var(--danger)'   },
};

const STEPS = [
  { key: 'install_server', label: 'Install server deps' },
  { key: 'install_client', label: 'Install client deps' },
  { key: 'build_client',   label: 'Build client app'    },
  { key: 'done',           label: 'Ready to restart'    },
];

function StepDot({ phase, stepKey }) {
  const phases = STEPS.map(s => s.key);
  const current = phases.indexOf(phase);
  const stepIdx = phases.indexOf(stepKey);
  const isDone  = current > stepIdx || phase === 'done';
  const isActive = phase === stepKey;
  const isError  = phase === 'error' && isActive;
  const color = isDone ? 'var(--success)' : isActive ? 'var(--primary)' : 'var(--gray-200)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%', background: color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, color: '#fff', fontWeight: 700,
        border: `2px solid ${color}`,
        transition: 'all .3s',
      }}>
        {isDone ? '✓' : isActive ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : ''}
      </div>
    </div>
  );
}

function DeploymentHealthTab() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      setData(await api.deploymentHealth());
    } catch (e) {
      toast.error(e.message || 'Failed to load deployment health');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  const meta = {
    ok: { label: 'Healthy', color: 'var(--success)', bg: '#dcfce7', Icon: CheckCircle2 },
    warning: { label: 'Needs Attention', color: '#b45309', bg: '#fef3c7', Icon: AlertTriangle },
    error: { label: 'Action Required', color: 'var(--danger)', bg: '#fee2e2', Icon: ShieldAlert },
  };

  if (loading) return <p className="text-muted">Loading...</p>;
  if (!data) return <p className="text-muted">Deployment health is unavailable.</p>;

  const top = meta[data.status] || meta.warning;
  const TopIcon = top.Icon;

  return (
    <div style={{ maxWidth: 880 }}>
      <div className="card" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ width: 48, height: 48, borderRadius: 8, background: top.bg, color: top.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <TopIcon size={24} />
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{top.label}</div>
          <div style={{ fontSize: 13, color: 'var(--gray-500)', marginTop: 3 }}>
            Last checked {fmtDate(data.checked_at)}
          </div>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => load(true)}
          disabled={refreshing}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          {refreshing ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={13} />}
          Refresh
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        {[
          ['Environment', data.app?.node_env],
          ['Version', data.app?.version],
          ['Uptime', `${Math.floor((data.app?.uptime_seconds || 0) / 60)} min`],
          ['Process', data.app?.pid],
        ].map(([label, value]) => (
          <div key={label} className="card" style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: 11, color: 'var(--gray-400)', fontWeight: 700, textTransform: 'uppercase' }}>{label}</div>
            <div style={{ fontSize: 15, fontWeight: 800, marginTop: 4 }}>{value || '-'}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-header">
          <h3 style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7 }}>
            <HardDrive size={15} /> Deployment Checklist
          </h3>
        </div>
        <div style={{ padding: '6px 20px 14px' }}>
          {(data.checks || []).map(check => {
            const m = meta[check.status] || meta.warning;
            const Icon = m.Icon;
            return (
              <div key={check.key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 0', borderBottom: '1px solid var(--gray-100)' }}>
                <Icon size={16} color={m.color} style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{check.label}</div>
                  <div style={{ color: 'var(--gray-500)', fontSize: 12, marginTop: 2, lineHeight: 1.45 }}>{check.detail}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SystemUpdateTab() {
  const toast   = useToast();
  const confirm = useConfirm();
  const [status,    setStatus]    = useState(null);
  const [checking,  setChecking]  = useState(false);
  const [loading,   setLoading]   = useState(true);
  const [restarting, setRestarting] = useState(false);
  const logEndRef = React.useRef(null);
  const pollRef   = React.useRef(null);

  // Initial load
  useEffect(() => {
    api.systemUpdateStatus().then(s => { setStatus(s); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  // Poll when update is running
  useEffect(() => {
    if (status?.running) {
      pollRef.current = setInterval(async () => {
        try {
          const s = await api.systemUpdateStatus();
          setStatus(s);
          if (!s.running) clearInterval(pollRef.current);
        } catch {}
      }, 1200);
    }
    return () => clearInterval(pollRef.current);
  }, [status?.running]);

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [status?.log?.length]);

  async function checkUpdates() {
    setChecking(true);
    try {
      const res = await api.systemUpdateCheck();
      setStatus(s => ({ ...s, outdated: res.outdated }));
    } catch (e) { toast.error(e.message); }
    finally { setChecking(false); }
  }

  async function startUpdate() {
    const ok = await confirm('This will run npm install on server & client, then rebuild the frontend. Continue?', { title: 'Start Update', label: 'Update', danger: false });
    if (!ok) return;
    try {
      await api.systemUpdateStart();
      // Start polling immediately
      const s = await api.systemUpdateStatus();
      setStatus(s);
    } catch (e) { toast.error(e.message); }
  }

  async function restartServer() {
    const ok = await confirm('Restart the server now? You will be disconnected briefly.', { title: 'Restart Server', label: 'Restart' });
    if (!ok) return;
    setRestarting(true);
    try {
      await api.systemUpdateRestart();
    } catch {}
    // Server is restarting — wait then reload the page
    setTimeout(() => window.location.reload(), 5000);
  }

  // Count outdated packages
  const serverOutdated = Object.keys(status?.outdated?.server || {}).length;
  const clientOutdated = Object.keys(status?.outdated?.client || {}).length;
  const totalOutdated  = serverOutdated + clientOutdated;

  const phase    = status?.phase || 'idle';
  const phMeta   = PHASE_LABELS[phase] || PHASE_LABELS.idle;
  const isRunning = !!status?.running;
  const isDone    = phase === 'done';
  const isError   = phase === 'error';
  const updatesDisabled = status?.updates_enabled === false;

  const logLines = status?.log || [];

  if (loading) return <p className="text-muted">Loading…</p>;

  return (
    <div style={{ maxWidth: 780 }}>

      {/* ── Header card ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div style={{
            width: 52, height: 52, borderRadius: 12, flexShrink: 0,
            background: 'linear-gradient(135deg, #1d4ed8, #6366f1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Download size={24} color="#fff" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 3 }}>System Update</div>
            <div style={{ fontSize: 13, color: 'var(--gray-500)', lineHeight: 1.5 }}>
              Installs the latest npm packages for server &amp; client, rebuilds the frontend,
              and restarts the application.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={checkUpdates}
              disabled={checking || isRunning || updatesDisabled}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
            >
              {checking ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={13} />}
              {checking ? 'Checking…' : 'Check for Updates'}
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={startUpdate}
              disabled={isRunning || restarting || updatesDisabled}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
            >
              {isRunning
                ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Updating…</>
                : <><Download size={13} /> Install &amp; Build</>
              }
            </button>
          </div>
        </div>
      </div>

      {/* ── Outdated packages ── */}
      {updatesDisabled && (
        <div
          className="card"
          style={{
            marginBottom: 16,
            borderColor: '#fde68a',
            background: '#fffbeb',
            color: '#92400e',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
          }}
        >
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>
            In-app updates are disabled in this environment. Use the approved Docker and branch deployment pipeline.
          </div>
        </div>
      )}

      {status?.outdated !== null && status?.outdated !== undefined && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 7 }}>
            <Activity size={14} />
            Package Status
            {totalOutdated > 0
              ? <span style={{ background: '#fef3c7', color: '#92400e', borderRadius: 99, padding: '1px 8px', fontSize: 11, fontWeight: 700, marginLeft: 4 }}>
                  {totalOutdated} outdated
                </span>
              : <span style={{ background: '#dcfce7', color: '#166534', borderRadius: 99, padding: '1px 8px', fontSize: 11, fontWeight: 700, marginLeft: 4 }}>
                  All up to date
                </span>
            }
          </div>
          {totalOutdated === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <CheckCircle2 size={14} /> All packages are current.
            </p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[['server', status.outdated.server], ['client', status.outdated.client]].map(([scope, pkgs]) => (
                Object.keys(pkgs).length > 0 && (
                  <div key={scope}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
                      {scope} ({Object.keys(pkgs).length})
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {Object.entries(pkgs).slice(0, 10).map(([name, info]) => (
                        <div key={name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, padding: '4px 8px', background: 'var(--gray-50)', borderRadius: 6 }}>
                          <span style={{ fontWeight: 600, color: '#374151' }}>{name}</span>
                          <span style={{ color: 'var(--gray-400)' }}>
                            <span style={{ color: 'var(--danger)' }}>{info.current}</span>
                            {' → '}
                            <span style={{ color: 'var(--success)', fontWeight: 700 }}>{info.latest}</span>
                          </span>
                        </div>
                      ))}
                      {Object.keys(pkgs).length > 10 && (
                        <div style={{ fontSize: 11, color: 'var(--gray-400)', paddingLeft: 8 }}>
                          +{Object.keys(pkgs).length - 10} more…
                        </div>
                      )}
                    </div>
                  </div>
                )
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Progress steps ── */}
      {(isRunning || isDone || isError || logLines.length > 0) && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 7 }}>
            <Zap size={14} />
            Update Progress
            <span style={{ marginLeft: 'auto', fontSize: 12, color: phMeta.color, fontWeight: 600 }}>
              {phMeta.label}
            </span>
          </div>

          {/* Step indicators */}
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
            {STEPS.map((step, i) => (
              <React.Fragment key={step.key}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                  <StepDot phase={isError && phase !== step.key ? phase : phase} stepKey={step.key} />
                  <div style={{ fontSize: 10, color: 'var(--gray-500)', marginTop: 4, textAlign: 'center' }}>{step.label}</div>
                </div>
                {i < STEPS.length - 1 && (
                  <div style={{ height: 2, flex: 0.5, background: 'var(--gray-100)', marginBottom: 14, borderRadius: 1 }} />
                )}
              </React.Fragment>
            ))}
          </div>

          {/* Log output */}
          <div style={{
            background: '#0f172a', borderRadius: 8, padding: '12px 14px',
            maxHeight: 280, overflowY: 'auto', fontFamily: 'monospace',
            fontSize: 12, lineHeight: 1.6,
          }}>
            {logLines.length === 0
              ? <span style={{ color: '#64748b' }}>Waiting for output…</span>
              : logLines.map((l, i) => {
                  const col = l.level === 'ok' ? '#4ade80' : l.level === 'error' ? '#f87171' : l.level === 'warn' ? '#fbbf24' : '#94a3b8';
                  return <div key={i} style={{ color: col }}>{l.msg}</div>;
                })
            }
            <div ref={logEndRef} />
          </div>

          {/* Timestamps */}
          {status?.started_at && (
            <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 8 }}>
              Started: {new Date(status.started_at).toLocaleString()}
              {status.done_at && ` · Completed: ${new Date(status.done_at).toLocaleString()}`}
            </div>
          )}
        </div>
      )}

      {/* ── Error banner ── */}
      {isError && status?.error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '12px 16px', marginBottom: 16, color: '#991b1b', fontSize: 13, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <div><strong>Update failed:</strong> {status.error}</div>
        </div>
      )}

      {/* ── Restart card ── */}
      {isDone && status?.needs_restart && (
        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '16px 20px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#1e40af', marginBottom: 3 }}>
              🚀 Update complete — restart required
            </div>
            <div style={{ fontSize: 13, color: '#3b82f6' }}>
              The new client build is ready. Restart the server to serve the updated application to all users.
            </div>
          </div>
          <button
            className="btn btn-primary"
            onClick={restartServer}
            disabled={restarting || updatesDisabled}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
          >
            {restarting
              ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Restarting…</>
              : <><RefreshCw size={14} /> Restart Server Now</>
            }
          </button>
        </div>
      )}

      {restarting && (
        <div style={{ background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 8, padding: '12px 16px', fontSize: 13, color: '#92400e', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
          Server is restarting… the page will reload automatically in a few seconds.
        </div>
      )}
    </div>
  );
}

/* ── Audit Log Tab ───────────────────────────────────────── */
function AuditLogTab() {
  const [rows,        setRows]        = useState([]);
  const [total,       setTotal]       = useState(0);
  const [auditUsers,  setAuditUsers]  = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [filter,      setFilter]      = useState({ entity_type: '', user_id: '', action: '', date_from: '', date_to: '' });
  const [offset,      setOffset]      = useState(0);
  const LIMIT = 50;

  const ENTITY_TYPES = ['project', 'milestone', 'task', 'visit', 'user'];
  const ACTIONS      = ['created', 'updated', 'deleted', 'completed', 'reopened', 'status_changed'];

  const load = useCallback(async (off = 0, filterOverride) => {
    setLoading(true);
    const f = filterOverride ?? filter;
    try {
      const params = { limit: LIMIT, offset: off };
      if (f.entity_type) params.entity_type = f.entity_type;
      if (f.user_id)     params.user_id     = f.user_id;
      if (f.action)      params.action       = f.action;
      if (f.date_from)   params.date_from    = f.date_from;
      if (f.date_to)     params.date_to      = f.date_to;
      const data = await api.auditLog(params);
      setRows(data.rows ?? []);
      setTotal(data.total ?? 0);
      setOffset(off);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => {
    api.auditLogUsers().then(setAuditUsers).catch(() => {});
    load(0);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function applyFilter(e) { e.preventDefault(); load(0); }

  const ENTITY_ICONS = { project: '📁', milestone: '◆', task: '✅', visit: '🔧', user: '👤' };
  const ACTION_COLORS = {
    created:  '#22c55e', updated: '#3b82f6', deleted: '#ef4444',
    completed: '#10b981', reopened: '#f59e0b', status_changed: '#8b5cf6',
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div className="section-title" style={{ margin: 0 }}>Audit Log</div>
          <p className="text-sm text-muted" style={{ marginTop: 2 }}>
            System-wide record of who changed what and when. {total > 0 && `${total} total entries.`}
          </p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => load(0)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Filters */}
      <form onSubmit={applyFilter} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <label style={{ fontSize: 11, color: 'var(--gray-500)', fontWeight: 600 }}>Entity Type</label>
          <select value={filter.entity_type} onChange={e => setFilter(f => ({ ...f, entity_type: e.target.value }))} style={{ width: 130, fontSize: 12 }}>
            <option value="">All</option>
            {ENTITY_TYPES.map(et => <option key={et} value={et}>{et}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <label style={{ fontSize: 11, color: 'var(--gray-500)', fontWeight: 600 }}>Action</label>
          <select value={filter.action} onChange={e => setFilter(f => ({ ...f, action: e.target.value }))} style={{ width: 130, fontSize: 12 }}>
            <option value="">All</option>
            {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <label style={{ fontSize: 11, color: 'var(--gray-500)', fontWeight: 600 }}>User</label>
          <select value={filter.user_id} onChange={e => setFilter(f => ({ ...f, user_id: e.target.value }))} style={{ width: 150, fontSize: 12 }}>
            <option value="">All users</option>
            {auditUsers.map(u => <option key={u.user_id} value={u.user_id}>{u.user_name}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <label style={{ fontSize: 11, color: 'var(--gray-500)', fontWeight: 600 }}>From</label>
          <input type="date" value={filter.date_from} onChange={e => setFilter(f => ({ ...f, date_from: e.target.value }))} style={{ width: 140, fontSize: 12 }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <label style={{ fontSize: 11, color: 'var(--gray-500)', fontWeight: 600 }}>To</label>
          <input type="date" value={filter.date_to} onChange={e => setFilter(f => ({ ...f, date_to: e.target.value }))} style={{ width: 140, fontSize: 12 }} />
        </div>
        <button type="submit" className="btn btn-primary btn-sm">Apply</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { const cleared = { entity_type: '', user_id: '', action: '', date_from: '', date_to: '' }; setFilter(cleared); load(0, cleared); }}>Clear</button>
      </form>

      {loading ? (
        <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--gray-400)' }}>
          <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-muted text-sm">No audit entries found for the selected filters.</p>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 150 }}>Date</th>
                  <th>User</th>
                  <th>Role</th>
                  <th>Entity</th>
                  <th>Action</th>
                  <th>Title</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td style={{ fontSize: 11, color: 'var(--gray-500)', whiteSpace: 'nowrap' }}>
                      {fmtDate(r.created_at)}
                    </td>
                    <td style={{ fontWeight: 600, fontSize: 13 }}>{r.user_name || '—'}</td>
                    <td>
                      {r.user_role && <span className={`badge badge-${r.user_role}`}>{r.user_role}</span>}
                    </td>
                    <td>
                      <span style={{ fontSize: 12 }}>
                        {ENTITY_ICONS[r.entity_type] || '•'} {r.entity_type}
                        {r.entity_id ? <span style={{ color: 'var(--gray-400)', marginLeft: 4 }}>#{r.entity_id}</span> : null}
                      </span>
                    </td>
                    <td>
                      <span style={{
                        display: 'inline-block', padding: '1px 8px', borderRadius: 8,
                        fontSize: 11, fontWeight: 700,
                        background: (ACTION_COLORS[r.action] || '#6b7280') + '18',
                        color: ACTION_COLORS[r.action] || '#6b7280',
                      }}>
                        {r.action}
                      </span>
                    </td>
                    <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
                      {r.entity_title || '—'}
                    </td>
                    <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: 'var(--gray-500)' }}>
                      {r.detail || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          {total > LIMIT && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, justifyContent: 'flex-end', fontSize: 12, color: 'var(--gray-500)' }}>
              <span>{offset + 1}–{Math.min(offset + LIMIT, total)} of {total}</span>
              <button className="btn btn-ghost btn-sm" disabled={offset === 0} onClick={() => load(Math.max(0, offset - LIMIT))}>← Prev</button>
              <button className="btn btn-ghost btn-sm" disabled={offset + LIMIT >= total} onClick={() => load(offset + LIMIT)}>Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── SECURITY TAB ────────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */
function SecurityTab() {
  const toast = useToast();
  const [cfg, setCfg]     = useState({ password_expiry_days: 90 });
  const [saved, setSaved] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getSecuritySettings()
      .then(d => { if (d) { setCfg(d); setSaved(d); } setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const dirty = JSON.stringify(cfg) !== JSON.stringify(saved);

  async function save() {
    setSaving(true);
    try { await api.saveSecuritySettings(cfg); setSaved({ ...cfg }); toast.success('Security settings saved'); }
    catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  if (loading) return <p className="text-muted">Loading…</p>;

  return (
    <div style={{ maxWidth: 600 }}>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <h3 style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7 }}>
            <Lock size={15} /> Password Policy
          </h3>
        </div>
        <div style={{ padding: '16px 20px' }}>
          <div className="form-group">
            <label>Password Expiry</label>
            <select
              value={cfg.password_expiry_days}
              onChange={e => setCfg(c => ({ ...c, password_expiry_days: Number(e.target.value) }))}
              style={{ maxWidth: 240 }}
            >
              <option value={0}>Never expires</option>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days (recommended)</option>
              <option value={180}>180 days</option>
              <option value={365}>365 days</option>
            </select>
            <p className="text-sm text-muted mt-4">
              Users will be forced to set a new password after this period.
              Set to <em>Never expires</em> to disable the policy.
            </p>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <h3 style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7 }}>
            <Shield size={15} /> Self-Service Reset
          </h3>
        </div>
        <div style={{ padding: '16px 20px' }}>
          <p className="text-sm text-muted">
            Users can reset their own password via the <em>Forgot your password?</em> link on the login
            page. A time-limited link (1 hour) is sent to their registered email address.
            Ensure SMTP is configured in <strong>Weekly Report → SMTP Settings</strong> for this to work.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-primary" onClick={save} disabled={saving || !dirty}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Save size={13} /> {saving ? 'Saving…' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}

/* ── MAIN PAGE ───────────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */
const TABS = [
  { key: 'overview',       label: 'Overview',           Icon: LayoutDashboard, group: 'overview',      desc: 'Health, activity, and manager attention items' },
  { key: 'users',          label: 'Users & Access',     Icon: UsersIcon,       group: 'people',        desc: 'Accounts, roles, activation, passwords, and 2FA exceptions' },
  { key: 'projects',       label: 'Projects',           Icon: FolderOpen,      group: 'people',        desc: 'Project administration and status visibility' },
  { key: 'maintenance',    label: 'Maintenance Visits', Icon: Wrench,          group: 'people',        desc: 'Visit administration and report status' },
  { key: 'statuses',       label: 'Status Workflow',    Icon: Tag,             group: 'configuration', desc: 'Project status labels, colors, and workflow rules' },
  { key: 'integrations',   label: 'Integrations',       Icon: Globe,           group: 'configuration', desc: 'External service and SMTP configuration' },
  { key: 'weekly_report',  label: 'Weekly Report',      Icon: ScrollText,      group: 'configuration', desc: 'Report schedule, recipients, and preview' },
  { key: 'localization',   label: 'Localization',       Icon: Globe,           group: 'configuration', desc: 'Language and regional settings' },
  { key: 'security',       label: 'Security Policy',    Icon: Shield,          group: 'security',      desc: 'Password expiry and reset policy' },
  { key: 'audit_log',      label: 'Audit Log',          Icon: ClipboardList,   group: 'security',      desc: 'Traceable record of system changes' },
  { key: 'logging',        label: 'Logging',            Icon: Database,        group: 'security',      desc: 'Application logging and retention settings' },
  { key: 'admin_alerts',   label: 'System Alerts',      Icon: ShieldAlert,     group: 'security',      desc: 'Manager alert preferences for operational issues' },
  { key: 'stats',          label: 'System Stats',       Icon: BarChart3,       group: 'operations',    desc: 'Database, storage, and usage metrics' },
  { key: 'activity',       label: 'Activity Feed',      Icon: Activity,        group: 'operations',    desc: 'Recent application activity' },
  { key: 'deployment',     label: 'Deployment Health',  Icon: HardDrive,       group: 'operations',    desc: 'Runtime configuration and deploy status checks' },
  { key: 'export',         label: 'Data Export',        Icon: FileSpreadsheet, group: 'operations',    desc: 'Download operational data' },
  { key: 'system_update',  label: 'System Update',      Icon: Download,        group: 'operations',    desc: 'Controlled application update workflow' },
];

const TAB_GROUPS = [
  { key: 'all',           label: 'All Settings' },
  { key: 'overview',      label: 'Overview' },
  { key: 'people',        label: 'People & Work' },
  { key: 'configuration', label: 'Configuration' },
  { key: 'security',      label: 'Security & Audit' },
  { key: 'operations',    label: 'Operations' },
];

export default function AdminPanel() {
  const { user } = useAuth();
  const [tab, setTab] = useState('overview');
  const [tabGroup, setTabGroup] = useState('all');
  const [tabSearch, setTabSearch] = useState('');
  const activeTab = TABS.find(t => t.key === tab) || TABS[0];
  const activeGroup = TAB_GROUPS.find(g => g.key === activeTab.group);
  const visibleTabs = TABS.filter(t => {
    const inGroup = tabGroup === 'all' || t.group === tabGroup;
    const q = tabSearch.trim().toLowerCase();
    const matches = !q || t.label.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q);
    return inGroup && matches;
  });
  const shownTabs = visibleTabs.length ? visibleTabs : TABS;
  const ActiveIcon = activeTab.Icon;

  return (
    <div className="page">
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Settings size={22} /> Settings
          </h1>
          <p className="text-sm text-muted mt-4">System configuration, access control, security, and operations</p>
        </div>
        <div style={{ fontSize: 12, color: 'var(--gray-400)', textAlign: 'right' }}>
          Signed in as<br /><strong style={{ color: 'var(--gray-700)' }}>{user.name}</strong>
        </div>
      </div>

      <div style={{ padding: '16px 0 20px' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {TAB_GROUPS.map(g => (
              <button
                key={g.key}
                type="button"
                onClick={() => setTabGroup(g.key)}
                className={tabGroup === g.key ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
              >
                {g.label}
              </button>
            ))}
          </div>
          <input
            value={tabSearch}
            onChange={e => setTabSearch(e.target.value)}
            placeholder="Search settings"
            aria-label="Search settings"
            style={{ width: 220, maxWidth: '100%', fontSize: 13 }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 8 }}>
          {shownTabs.map(({ key, label, Icon, desc }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr)', gap: 8,
                minHeight: 68, padding: '10px 11px', borderRadius: 8,
                border: tab === key ? '1px solid var(--primary)' : '1px solid var(--gray-200)',
                background: tab === key ? '#eff6ff' : '#fff',
                color: tab === key ? 'var(--primary)' : 'var(--gray-600)',
                fontWeight: tab === key ? 700 : 600,
                fontSize: 12,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <Icon size={15} style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                <span style={{ display: 'block', marginTop: 3, color: tab === key ? 'var(--primary)' : 'var(--gray-400)', fontSize: 11, fontWeight: 500, lineHeight: 1.25 }}>
                  {desc}
                </span>
              </span>
            </button>
          ))}
        </div>
        {visibleTabs.length === 0 && (
          <p className="text-sm text-muted mt-8">No settings matched. Showing all sections.</p>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 14, fontSize: 13, color: 'var(--gray-500)' }}>
          <ActiveIcon size={15} />
          <strong style={{ color: 'var(--gray-700)' }}>{activeTab.label}</strong>
          <span>in {activeGroup?.label || 'Settings'}</span>
        </div>
      </div>

      {tab === 'overview'     && <OverviewTab />}
      {tab === 'users'        && <UsersTab currentUser={user} />}
      {tab === 'projects'     && <ProjectsAdminTab />}
      {tab === 'maintenance'  && <MaintenanceAdminTab />}
      {tab === 'statuses'     && <StatusManagementTab />}
      {tab === 'stats'        && <StatsTab />}
      {tab === 'activity'     && <ActivityTab />}
      {tab === 'export'       && <DataExportTab />}
      {tab === 'integrations'  && <IntegrationsTab />}
      {tab === 'weekly_report' && <WeeklyReportTab />}
      {tab === 'logging'       && <LoggingTab />}
      {tab === 'localization'  && <LocalizationTab />}
      {tab === 'admin_alerts'  && <AdminAlertsTab />}
      {tab === 'deployment'    && <DeploymentHealthTab />}
      {tab === 'system_update' && <SystemUpdateTab />}
      {tab === 'audit_log'    && <AuditLogTab />}
      {tab === 'security'     && <SecurityTab />}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
