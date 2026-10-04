import { Link } from 'react-router-dom';

/* ── StatCard ────────────────────────────────────────────── */
// Numbers are ink and icons quiet; only a warning-type count above zero turns
// signal red. Callers' per-card colours are no longer used for decoration.
export default function StatCard({ icon: Icon, iconColor, value, label, valueColor, to }) {
  const Component = to ? Link : 'div';
  const urgent = /ef4444|dc2626|danger/i.test(`${iconColor || ''} ${valueColor || ''}`) && Number(value) > 0;
  return (
    <Component to={to} className={`dashboard-stat${to ? ' dashboard-stat-link' : ''}${urgent ? ' is-urgent' : ''}`}>
      <span className="dashboard-stat-icon"><Icon size={18} /></span>
      <span className="dashboard-stat-copy"><strong>{value}</strong><small>{label}</small></span>
    </Component>
  );
}

/* ══════════════════════════════════════════════════════════ */
