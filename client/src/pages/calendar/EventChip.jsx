import { TYPE_STYLE, eventLabel } from './constants';

/* ── Event chip ──────────────────────────────────────────── */
export default function EventChip({ event, onClick, draggable, onDragStart }) {
  const s = TYPE_STYLE[event.type];
  return (
    <button type="button"
      onClick={e => { e.stopPropagation(); onClick(event); }}
      draggable={draggable}
      onDragStart={e => { e.stopPropagation(); onDragStart?.(event, e); }}
      className="u-ca92a11" style={{ background: s.bg, color: s.color, borderLeft: `3px solid ${s.color}`, cursor: draggable ? 'grab' : 'pointer' }}
      title={eventLabel(event) !== event.title && event.title ? `${eventLabel(event)} — ${event.title}` : eventLabel(event)}
    >
      <s.Icon size={10} /> {eventLabel(event)}
    </button>
  );
}
