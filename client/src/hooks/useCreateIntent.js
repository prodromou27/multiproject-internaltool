import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export function customerIdFromCreateIntent(params) {
  const raw=params?.get?.('customer_id');
  return typeof raw==='string' && /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
}

// Launch the module's existing form after its reference data has loaded. Consume
// the intent so refresh, history navigation and React StrictMode cannot reopen it.
export function useCreateIntent({ allowed, ready, onCreate }) {
  const location = useLocation();
  const navigate = useNavigate();
  const callback = useRef(onCreate);
  const handled = useRef(null);
  callback.current = onCreate;
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (!ready || params.get('create') !== '1' || handled.current === location.key) return;
    handled.current = location.key;
    if (allowed) callback.current(new URLSearchParams(params));
    params.delete('create');
    params.delete('customer_id');
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash }, { replace: true, state: location.state });
  }, [allowed, ready, location.key, location.pathname, location.search, location.hash, location.state, navigate]);
}
