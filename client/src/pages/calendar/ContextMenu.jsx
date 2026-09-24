import { useEffect, useRef } from 'react';
import { Wrench } from 'lucide-react';
import { fmtDate } from '../../components/Shared';

/* ── Context menu (right-click) ─────────────────────────── */
export default function ContextMenu({ x, y, date, onNewVisit, onClose }) {
  const ref = useRef(null);

  // Close on outside click or Escape
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    const onMouse = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onMouse);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onMouse); };
  }, [onClose]);

  // Keep menu in viewport
  const style = {
    position: 'fixed',
    top: Math.min(y, window.innerHeight - 100),
    left: Math.min(x, window.innerWidth - 220),
    zIndex: 9000,
    background: 'var(--surface)',
    border: '1px solid var(--gray-200)',
    borderRadius: 8,
    boxShadow: '0 4px 20px rgba(0,0,0,.12)',
    minWidth: 200,
    overflow: 'hidden',
  };

  return (
    <div ref={ref} style={style}>
      {/* header */}
      <div style={{
        padding: '7px 12px', fontSize: 11, fontWeight: 700,
        color: 'var(--gray-500)', borderBottom: '1px solid var(--gray-100)',
        background: 'var(--gray-50)', letterSpacing: '0.04em',
        textTransform: 'uppercase',
      }}>
        {fmtDate(date)}
      </div>
      <button
        onClick={() => { onClose(); onNewVisit(); }}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
          padding: '10px 14px', background: 'none', border: 'none',
          cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--tone-warning-text)',
          textAlign: 'left',
        }}
        onMouseEnter={e => e.currentTarget.style.background = '#fef3c7'}
        onMouseLeave={e => e.currentTarget.style.background = 'none'}
      >
        <span style={{
          width: 24, height: 24, borderRadius: 6,
          background: 'var(--warning-light)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Wrench size={13} color="#b45309" />
        </span>
        New Maintenance Visit
      </button>
    </div>
  );
}
