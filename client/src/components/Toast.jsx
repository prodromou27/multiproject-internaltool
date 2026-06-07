import React, { useState, useCallback, createContext, useContext, useEffect } from 'react';
import { X, CheckCircle2, AlertCircle, AlertTriangle, Info } from 'lucide-react';

export const ToastContext = createContext(null);

let _toastId = 0;

const PALETTE = {
  success: { bg: '#f0fdf4', border: '#86efac', text: '#166534', icon: '#22c55e' },
  error:   { bg: '#fef2f2', border: '#fca5a5', text: '#991b1b', icon: '#ef4444' },
  warning: { bg: '#fffbeb', border: '#fcd34d', text: '#92400e', icon: '#f59e0b' },
  info:    { bg: '#eff6ff', border: '#93c5fd', text: '#1e40af', icon: '#3b82f6' },
};

const ICON_MAP = {
  success: CheckCircle2,
  error:   AlertCircle,
  warning: AlertTriangle,
  info:    Info,
};

function ToastItem({ id, message, type, onRemove }) {
  const [visible, setVisible] = useState(false);
  const p = PALETTE[type] ?? PALETTE.info;
  const Icon = ICON_MAP[type] ?? Info;

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      role="alert"
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: '11px 14px', borderRadius: 10,
        background: p.bg, border: `1px solid ${p.border}`, color: p.text,
        boxShadow: '0 4px 20px rgba(0,0,0,.13)',
        maxWidth: 390, fontSize: 13, lineHeight: 1.5, fontWeight: 500,
        pointerEvents: 'auto',
        transform: visible ? 'translateX(0) scale(1)' : 'translateX(80px) scale(.95)',
        opacity: visible ? 1 : 0,
        transition: 'transform .25s cubic-bezier(.34,1.56,.64,1), opacity .2s ease',
      }}
    >
      <Icon size={16} style={{ color: p.icon, flexShrink: 0, marginTop: 1 }} />
      <span style={{ flex: 1 }}>{message}</span>
      <button
        onClick={() => onRemove(id)}
        aria-label="Dismiss"
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: p.text, opacity: .5, padding: 0,
          display: 'flex', alignItems: 'center', flexShrink: 0,
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const remove = useCallback(id => setToasts(t => t.filter(x => x.id !== id)), []);

  const add = useCallback((message, type, duration) => {
    const id = ++_toastId;
    setToasts(t => [...t, { id, message, type }]);
    const ms = duration !== undefined ? duration : type === 'error' ? 6000 : 4500;
    if (ms > 0) setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), ms);
    return id;
  }, []);

  const toast = {
    success: (msg, dur) => add(msg, 'success', dur),
    error:   (msg, dur) => add(msg, 'error',   dur),
    warning: (msg, dur) => add(msg, 'warning', dur),
    info:    (msg, dur) => add(msg, 'info',    dur),
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          style={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
            display: 'flex', flexDirection: 'column-reverse', gap: 8,
            pointerEvents: 'none',
          }}
        >
          {toasts.map(t => (
            <ToastItem key={t.id} {...t} onRemove={remove} />
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
