import { Link } from 'react-router-dom';

/* ── StatCard ────────────────────────────────────────────── */
export default function StatCard({ icon: Icon, iconBg, iconColor, value, label, valueColor, to }) {
  const Component = to ? Link : 'div';
  return (
    <Component to={to} className={`dashboard-stat${to ? ' dashboard-stat-link' : ''}`}
      style={{ '--stat-icon-bg': iconBg, '--stat-icon-color': iconColor, '--stat-value-color': valueColor || 'var(--gray-900)' }}>
      <span className="dashboard-stat-icon"><Icon size={18} /></span>
      <span className="dashboard-stat-copy"><strong>{value}</strong><small>{label}</small></span>
    </Component>
  );
}

/* ══════════════════════════════════════════════════════════ */
