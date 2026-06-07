import { useState, useEffect } from 'react';

/**
 * Like useState but persists the value in localStorage.
 * Use a unique `key` per page so filters don't collide.
 */
export function useSavedFilter(key, defaultValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem('hub_filter_' + key);
      return stored !== null ? stored : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try { localStorage.setItem('hub_filter_' + key, value); } catch {}
  }, [key, value]);

  return [value, setValue];
}
