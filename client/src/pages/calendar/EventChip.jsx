import React from 'react';
import { TYPE_STYLE } from './constants';

/* ── Event chip ──────────────────────────────────────────── */
export default function EventChip({ event, onClick, draggable, onDragStart }) {
  const s = TYPE_STYLE[event.type];
  return (
    <button type="button"
      onClick={e => { e.stopPropagation(); onClick(event); }}
      draggable={draggable}
      onDragStart={e => { e.stopPropagation(); onDragStart?.(event, e); }}
      style={{
        background: s.bg, color: s.color, borderRadius: 4, padding: '1px 5px',
        fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
        overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 2,
        borderLeft: `3px solid ${s.color}`, lineHeight: '18px',
        display: 'flex', width: '100%', borderTop: 0, borderRight: 0, borderBottom: 0, textAlign: 'left', alignItems: 'center', gap: 3, cursor: draggable ? 'grab' : 'pointer',
      }}
      title={event.title || event.customer_name}
    >
      <s.Icon size={10} /> {event.title || event.customer_name}
    </button>
  );
}
