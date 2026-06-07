import React, { useState, createContext, useContext, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from './Shared';

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [req, setReq] = useState(null);

  const confirm = useCallback((message, opts = {}) => new Promise(resolve => {
    setReq({ message, resolve, ...opts });
  }), []);

  function done(v) {
    req?.resolve(v);
    setReq(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {req && (
        <Modal title={req.title ?? 'Are you sure?'} onClose={() => done(false)}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 20 }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
              background: req.danger === false ? '#eff6ff' : '#fef2f2',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <AlertTriangle size={20} color={req.danger === false ? '#3b82f6' : '#ef4444'} />
            </div>
            <p style={{ fontSize: 14, color: 'var(--gray-700)', lineHeight: 1.6, margin: 0, paddingTop: 8 }}>
              {req.message}
            </p>
          </div>
          <div className="modal-footer" style={{ padding: 0, border: 'none' }}>
            <button className="btn btn-ghost" onClick={() => done(false)}>Cancel</button>
            <button
              autoFocus
              className={req.danger === false ? 'btn btn-primary' : 'btn btn-danger'}
              onClick={() => done(true)}
            >
              {req.label ?? 'Delete'}
            </button>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);
