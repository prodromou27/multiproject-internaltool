import React, { useEffect, useState } from 'react';
import { Users as UsersIcon, Search } from 'lucide-react';
import { api } from '../api';

const ROLE_LABELS = {
  manager:  { label: 'Manager',  cls: 'badge-manager' },
  engineer: { label: 'Engineer', cls: 'badge-engineer' },
  planner:  { label: 'Planner',  cls: 'badge-open' },
  pm:       { label: 'PM',       cls: 'badge-pending_closure' },
};

function UserTable({ users, loading }) {
  if (loading) return <p className="text-muted" style={{ fontSize: 13 }}>Loading…</p>;
  if (users.length === 0) return <p className="text-muted text-sm">None in this group.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th></tr>
        </thead>
        <tbody>
          {users.map(u => {
            const roleInfo = ROLE_LABELS[u.role] || { label: u.role, cls: '' };
            return (
              <tr key={u.id}>
                <td style={{ fontWeight: 600 }}>{u.name}</td>
                <td>
                  <a href={`mailto:${u.email}`} style={{ color: 'var(--gray-700)' }}>{u.email}</a>
                </td>
                <td><span className={`badge ${roleInfo.cls}`}>{roleInfo.label}</span></td>
                <td className="text-muted text-sm">
                  {new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function Users() {
  const [users, setUsers]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');

  useEffect(() => {
    api.users().then(u => { setUsers(u); setLoading(false); });
  }, []);

  const q = search.toLowerCase().trim();
  const visible = q
    ? users.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.role.toLowerCase().includes(q))
    : users;

  const managers  = visible.filter(u => u.role === 'manager');
  const engineers = visible.filter(u => u.role === 'engineer');
  const planners  = visible.filter(u => u.role === 'planner');
  const pms       = visible.filter(u => u.role === 'pm');

  const groups = [
    { key: 'manager',  label: 'Managers',              count: managers.length,  data: managers  },
    { key: 'engineer', label: 'Engineers',              count: engineers.length, data: engineers },
    { key: 'planner',  label: 'Planners',               count: planners.length,  data: planners  },
    { key: 'pm',       label: 'Project Managers (PM)',  count: pms.length,       data: pms       },
  ].filter(g => g.count > 0 || !q); // hide empty groups when searching

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <UsersIcon size={20} /> Team
          </h1>
          <div className="page-subtitle">{users.length} member{users.length !== 1 ? 's' : ''} · New accounts are created via Admin Panel</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ position: 'relative', maxWidth: 340 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)', pointerEvents: 'none' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, email, or role…"
            style={{ paddingLeft: 32 }}
          />
        </div>
      </div>

      {groups.map(g => (
        <div key={g.key} className="card" style={{ marginBottom: 16 }}>
          <div className="section-title" style={{ marginBottom: g.data.length > 0 ? 12 : 4 }}>
            {g.label} <span style={{ fontWeight: 400, color: 'var(--gray-400)', fontSize: 12 }}>({g.count})</span>
          </div>
          <UserTable users={g.data} loading={loading} />
        </div>
      ))}

      {!loading && visible.length === 0 && (
        <div className="empty">
          <div className="empty-icon"><UsersIcon size={40} strokeWidth={1.2} /></div>
          <p>No team members match "{search}"</p>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => setSearch('')}>Clear search</button>
        </div>
      )}
    </div>
  );
}
