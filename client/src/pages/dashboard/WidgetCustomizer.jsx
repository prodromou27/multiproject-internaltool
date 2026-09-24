import React, { useEffect, useState, useRef } from 'react';
import { X, GripVertical, ArrowUp, ArrowDown } from 'lucide-react';

/* ── Widget Customizer Modal ──────────────────────────────── */
export default function WidgetCustomizer({ prefs, defs, onToggle, onReorder, onReset, onClose }) {
  const [dragFrom, setDragFrom] = useState(null);
  const [overIdx,  setOverIdx]  = useState(null);
  const dialogRef = useRef(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    const onKeyDown = event => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const controls = [...dialogRef.current.querySelectorAll('button:not([disabled])')];
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [onClose]);

  return (
    <div className="dashboard-customizer-backdrop" onMouseDown={onClose}>
      <section ref={dialogRef} tabIndex={-1} className="dashboard-customizer" role="dialog" aria-modal="true"
        aria-labelledby="dashboard-customizer-title" onMouseDown={event => event.stopPropagation()}>
        <header>
          <div><h2 id="dashboard-customizer-title">Arrange workspace</h2>
            <p>Choose the information shown and set its reading order.</p></div>
          <button type="button" onClick={onClose} aria-label="Close dashboard customizer">
            <X size={18} />
          </button>
        </header>

        <div className="dashboard-widget-options">
          {prefs.order.map((id, idx) => {
            const def    = defs.find(d => d.id === id);
            if (!def) return null;
            const hidden = prefs.hidden.includes(id);
            return (
              <div
                key={id}
                draggable
                onDragStart={e => { setDragFrom(idx); e.dataTransfer.effectAllowed = 'move'; }}
                onDragEnd={() => { setDragFrom(null); setOverIdx(null); }}
                onDragOver={e => { e.preventDefault(); setOverIdx(idx); }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOverIdx(null); }}
                onDrop={e => {
                  e.preventDefault();
                  if (dragFrom !== null && dragFrom !== idx) onReorder(dragFrom, idx);
                  setDragFrom(null); setOverIdx(null);
                }}
                className={`dashboard-widget-option${overIdx === idx ? ' drag-over' : ''}${dragFrom === idx ? ' dragging' : ''}${hidden ? ' is-hidden' : ''}`}
              >
                <GripVertical size={14} aria-hidden="true" />
                <span>{def.label}</span>
                <div className="dashboard-widget-order" aria-label={`Move ${def.label}`}>
                  <button type="button" onClick={() => onReorder(idx, idx - 1)} disabled={idx === 0} aria-label={`Move ${def.label} up`}><ArrowUp size={13} /></button>
                  <button type="button" onClick={() => onReorder(idx, idx + 1)} disabled={idx === prefs.order.length - 1} aria-label={`Move ${def.label} down`}><ArrowDown size={13} /></button>
                </div>
                <button type="button" className="dashboard-widget-toggle" onClick={() => onToggle(id)} aria-pressed={!hidden}>
                  {hidden ? 'Show' : 'Hide'}
                </button>
              </div>
            );
          })}
        </div>

        <footer>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onReset}>
            Reset to default
          </button>
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </footer>
      </section>
    </div>
  );
}
