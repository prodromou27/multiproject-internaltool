import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, X } from 'lucide-react';

/* ── Overdue Banner ──────────────────────────────────────── */
export default function OverdueBanner({ overdueProjects, overdueTasks }) {
  const KEY = 'hub_overdue_banner_dismissed';
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(KEY) === '1');

  if (dismissed || (overdueProjects.length === 0 && overdueTasks.length === 0)) return null;

  const dismiss = () => { sessionStorage.setItem(KEY, '1'); setDismissed(true); };

  return (
    <div className="u-f14bc91">
      <AlertTriangle size={16} color="#ef4444" style={{ flexShrink:0, marginTop:2 }} />
      <div className="u-97445a8">
        <div className="u-63897c2">
          Overdue items need attention
        </div>
        <div className="u-30243af">
          {overdueProjects.length > 0 && (
            <span>
              <strong>{overdueProjects.length}</strong> overdue project{overdueProjects.length !== 1 ? 's' : ''}:{' '}
              {overdueProjects.slice(0, 3).map((p, i) => (
                <span key={p.id}>{i > 0 ? ', ' : ''}
                  <Link to={`/projects/${p.id}`} style={{ color:'var(--tone-danger-text)', fontWeight:600 }}>{p.title}</Link>
                </span>
              ))}
              {overdueProjects.length > 3 && ` +${overdueProjects.length - 3} more`}
            </span>
          )}
          {overdueTasks.length > 0 && (
            <span><strong>{overdueTasks.length}</strong> overdue task{overdueTasks.length !== 1 ? 's' : ''}</span>
          )}
        </div>
      </div>
      <button onClick={dismiss}
        className="u-9c8574c">
        <X size={14} />
      </button>
    </div>
  );
}
