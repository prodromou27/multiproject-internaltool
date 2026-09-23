import React, { useState, useCallback, createContext, useContext, useEffect } from 'react';
import { X, CheckCircle2, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import styles from './Toast.module.css';

export const ToastContext = createContext(null);

let _toastId = 0;

const ICON_MAP = {
  success: CheckCircle2,
  error:   AlertCircle,
  warning: AlertTriangle,
  info:    Info,
};

function ToastItem({ id, message, type, onRemove }) {
  const [visible, setVisible] = useState(false);
  const variant = ICON_MAP[type] ? type : 'info';
  const Icon = ICON_MAP[variant];

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div role="alert" className={`${styles.toast} ${styles[variant]} ${visible ? styles.visible : ''}`}>
      <Icon size={16} className={styles.icon} />
      <span className={styles.message}>{message}</span>
      <button onClick={() => onRemove(id)} aria-label="Dismiss" className={styles.dismiss}>
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
        <div aria-live="polite" className={styles.stack}>
          {toasts.map(t => (
            <ToastItem key={t.id} {...t} onRemove={remove} />
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
