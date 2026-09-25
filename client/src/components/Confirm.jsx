import { useState, createContext, useContext, useCallback } from 'react';
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
          <div className="u-89d573f">
            <div className="u-90ffd0a" style={{ background: req.danger === false ? '#eff6ff' : '#fef2f2' }}>
              <AlertTriangle size={20} color={req.danger === false ? '#3b82f6' : '#ef4444'} />
            </div>
            <p className="u-bea31f6">
              {req.message}
            </p>
          </div>
          <div className="modal-footer u-75cb963">
            <button autoFocus className="btn btn-ghost" onClick={() => done(false)}>Cancel</button>
            <button
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
