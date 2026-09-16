import React, { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { api } from '../api';

function ChartCard({ title, children }) {
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 14, color: 'var(--gray-700)' }}>{title}</div>
      {children}
    </div>
  );
}

export default function ServiceOperations() {
  const [from, setFrom] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; });
  const [to, setTo] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    const params = {}; if (from) params.from = from; if (to) params.to = to;
    api.serviceActivityOverview(params).then(d => { setData(d); setLoading(false); }).catch(e => { setError(e.message); setLoading(false); });
  }, [from, to]);

  if (loading || !data) return <div className="page"><p className="text-muted">Loading…</p></div>;
  if (error) return <div className="page"><div className="alert alert-warning">{error}</div></div>;

  const categoryCount = name => data.byCategory.find(c => c.name === name)?.count || 0;

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Service Operations</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ width: 'auto' }} />
          <span className="text-muted">to</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ width: 'auto' }} placeholder="today" />
        </div>
      </div>

      <div className="grid-4" style={{ marginBottom: 20 }}>
        <div className="card stat"><div className="stat-value">{data.total_activities}</div><div className="stat-label">Activities</div></div>
        <div className="card stat"><div className="stat-value">{data.total_hours}h</div><div className="stat-label">Total Logged Hours</div></div>
        <div className="card stat"><div className="stat-value">{data.customer_facing_hours}h</div><div className="stat-label">Customer-Facing Hours</div></div>
        <div className="card stat"><div className="stat-value">{data.internal_hours}h</div><div className="stat-label">Internal Hours</div></div>
      </div>

      <div className="grid-4" style={{ marginBottom: 20 }}>
        <div className="card stat"><div className="stat-value">{categoryCount('Support')}</div><div className="stat-label">Support Activities</div></div>
        <div className="card stat"><div className="stat-value">{categoryCount('Maintenance') + categoryCount('Preventive Maintenance')}</div><div className="stat-label">Maintenance Activities</div></div>
        <div className="card stat"><div className="stat-value">{categoryCount('Configuration Change')}</div><div className="stat-label">Configuration Changes</div></div>
        <div className="card stat"><div className="stat-value">{categoryCount('Upgrade')}</div><div className="stat-label">Upgrades</div></div>
      </div>

      <div className="grid-2" style={{ marginBottom: 20 }}>
        <div className="card stat"><div className="stat-value">{data.customers_supported}</div><div className="stat-label">Customers Supported</div></div>
        <div className="card stat"><div className="stat-value">{data.byEngineer.length}</div><div className="stat-label">Engineers Active</div></div>
      </div>

      <div className="grid-2" style={{ gap: 20 }}>
        <ChartCard title="Activities by Team">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.byTeam} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="hours" name="Hours" fill="#3b82f6" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Activities by Engineer">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.byEngineer} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="hours" name="Hours" fill="#22c55e" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid-2" style={{ gap: 20 }}>
        <ChartCard title="Activities by Customer">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.byCustomer} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="hours" name="Hours" fill="#f59e0b" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Activities by Technology">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.byTechnology} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" name="Activities" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <ChartCard title="Activities by Category">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data.byCategory} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={70} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="hours" name="Hours" fill="#0891b2" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
