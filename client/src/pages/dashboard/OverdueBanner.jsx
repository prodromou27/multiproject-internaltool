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
    <div style={{
      background:'var(--danger-light)', border:'1px solid #fecaca', borderRadius:10,
      padding:'12px 16px', marginBottom:20,
      display:'flex', alignItems:'flex-start', gap:12,
    }}>
      <AlertTriangle size={16} color="#ef4444" style={{ flexShrink:0, marginTop:2 }} />
      <div style={{ flex:1 }}>
        <div style={{ fontWeight:700, fontSize:13, color:'var(--tone-danger-text)', marginBottom:4 }}>
          Overdue items need attention
        </div>
        <div style={{ fontSize:12, color:'var(--tone-danger-text)', display:'flex', gap:16, flexWrap:'wrap' }}>
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
        style={{ background:'none', border:'none', cursor:'pointer', color:'#ef4444', padding:2, flexShrink:0 }}>
        <X size={14} />
      </button>
    </div>
  );
}
