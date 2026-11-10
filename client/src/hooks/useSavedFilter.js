import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { readPref, writePref } from '../utils/prefs';

/**
 * Like useState for a page's filter or view (review I08). The value is kept in the
 * address (?param=value), so refresh, back/forward and a shared link show the same
 * view, and it is remembered for the signed-in person in this browser. `allowed`
 * lists the valid values; anything else (an old or edited link) is ignored.
 */
export function useSavedFilter(key, defaultValue, { param = key, allowed } = {}) {
  const [params, setParams] = useSearchParams();
  const ok = useCallback(value => typeof value === 'string' && value !== '' && (!allowed || allowed.includes(value)), [allowed]);
  const [stored, setStored] = useState(() => readPref(`filter.${key}`, ok, defaultValue));
  const fromUrl = params.get(param);
  const value = ok(fromUrl) ? fromUrl : stored;

  // The address always shows the view, so a copied link opens it.
  useEffect(() => {
    if (fromUrl === value || value === defaultValue && fromUrl === null) return;
    setParams(current => {
      const next = new URLSearchParams(current);
      if (value === defaultValue) next.delete(param); else next.set(param, value);
      return next;
    }, { replace: true });
  }, [fromUrl, value, defaultValue, param, setParams]);

  const setValue = useCallback(next => {
    const resolved = typeof next === 'function' ? next(value) : next;
    if (!ok(resolved)) return;
    setStored(resolved);
    writePref(`filter.${key}`, resolved);
    setParams(current => {
      const updated = new URLSearchParams(current);
      if (resolved === defaultValue) updated.delete(param); else updated.set(param, resolved);
      return updated;
    }, { replace: true });
  }, [value, ok, key, defaultValue, param, setParams]);

  return [value, setValue];
}

/** The open tab, kept in the address (?tab=), so refresh and links keep it. */
export function useUrlTab(tabs, defaultTab, param = 'tab') {
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get(param);
  const tab = tabs.includes(fromUrl) ? fromUrl : defaultTab;
  const setTab = useCallback(next => {
    setParams(current => {
      const updated = new URLSearchParams(current);
      if (next === defaultTab) updated.delete(param); else updated.set(param, next);
      return updated;
    }, { replace: true });
  }, [defaultTab, param, setParams]);
  return [tab, setTab];
}
