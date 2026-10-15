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
      <div className="u-5d414d2">
        {fmtDate(date)}
      </div>
      <button
        onClick={() => { onClose(); onNewVisit(); }}
        className="u-693c0fa"
        onMouseEnter={e => e.currentTarget.style.background = '#fef3c7'}
        onMouseLeave={e => e.currentTarget.style.background = 'none'}
      >
        <span className="u-cdb0e53">
          <Wrench size={13} color="#b45309" />
        </span>
        New Maintenance Visit
      </button>
    </div>
  );
}
