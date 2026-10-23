import { useState, createContext, useContext, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from './Shared';

const ConfirmContext = createContext(null);

// opts.typeToConfirm: the text (e.g. the name) to type before the button works — for deletes that cannot be undone.
export function ConfirmProvider({ children }) {
  const [req, setReq] = useState(null);
  const [typed, setTyped] = useState('');

  const confirm = useCallback((message, opts = {}) => new Promise(resolve => {
    setTyped('');
    setReq({ message, resolve, ...opts });
  }), []);

  function done(v) {
    req?.resolve(v);
    setReq(null);
  }
  const blocked = !!req?.typeToConfirm && typed.trim() !== String(req.typeToConfirm).trim();

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {req && (
        <Modal title={req.title ?? 'Are you sure?'} onClose={() => done(false)}>
          <div className="u-89d573f">
            <div className={["u-90ffd0a", (req.danger === false ? 'u-4ff1ea9' : 'u-60cd622')].filter(Boolean).join(' ')}>
              <AlertTriangle size={20} color={req.danger === false ? '#3b82f6' : '#ef4444'} />
            </div>
            <p className="u-bea31f6">
              {req.message}
            </p>
          </div>
          {req.typeToConfirm && <div className="form-group">
            <label htmlFor="confirm-typed">Type <strong>{req.typeToConfirm}</strong> to confirm</label>
            <input id="confirm-typed" value={typed} onChange={event => setTyped(event.target.value)} autoComplete="off" />
          </div>}
          <div className="modal-footer u-75cb963">
            <button autoFocus className="btn btn-ghost" onClick={() => done(false)}>Cancel</button>
            <button
              className={req.danger === false ? 'btn btn-primary' : 'btn btn-danger'}
              disabled={blocked}
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
