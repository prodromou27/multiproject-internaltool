import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

/* View preferences (review I08). Kept in this browser under the signed-in person's
   id, so someone else signing in here does not get them, and checked when read back
   (a stored value that is no longer valid is ignored). The names in SYNCED are also
   saved on the server, so they follow the person to other browsers. */
const SYNCED = new Set(['tasks.presets', 'tasks.columns', 'display.zoom']);
let userId = null;
const listeners = new Set();
const keyOf = name => `hub:${userId ?? 'anon'}:${name}`;

/** Called by App whenever the signed-in person changes. */
export function setPrefsUser(id) { userId = id ?? null; }

export function readPref(name, valid, fallback) {
  try {
    const raw = localStorage.getItem(keyOf(name));
    if (raw === null) return fallback;
    const value = JSON.parse(raw);
    return valid(value) ? value : fallback;
  } catch { return fallback; }
}

export function writePref(name, value) {
  try { localStorage.setItem(keyOf(name), JSON.stringify(value)); } catch { /* kept for this visit only */ }
  if (SYNCED.has(name) && userId != null) api.savePreference(name, value).catch(() => { /* kept in this browser */ });
  // Other places using the same preference see the change (e.g. the display size chosen in Profile).
  for (const reload of [...listeners]) reload();
}

/** The server's copy, after sign-in: it wins over this browser's. */
export async function loadServerPrefs() {
  const forUser = userId;
  const prefs = await api.preferences();
  if (forUser !== userId) return;
  for (const [name, value] of Object.entries(prefs || {})) {
    if (!SYNCED.has(name)) continue;
    try { localStorage.setItem(keyOf(name), JSON.stringify(value)); } catch { /* not stored */ }
  }
  listeners.forEach(listener => listener());
}

// Keys from before preferences were per person: removed, so they reach no one else.
const LEGACY = [/^hub_filter_/, /^hub_task_filter_presets$/, /^hub_task_columns$/, /^insights_(charts|days)$/];
export function dropLegacyPrefs() {
  try {
    for (const key of Object.keys(localStorage)) if (LEGACY.some(pattern => pattern.test(key))) localStorage.removeItem(key);
  } catch { /* storage unavailable */ }
}

/** useState backed by a view preference. `valid` checks a stored value before it is used. */
export function usePref(name, valid, fallback) {
  const [value, setValue] = useState(() => readPref(name, valid, fallback));
  useEffect(() => {
    const reload = () => setValue(readPref(name, valid, fallback));
    listeners.add(reload);
    // The server's copy may have arrived between the first read and now.
    reload();
    return () => listeners.delete(reload);
  }, [name]);
  const set = useCallback(next => {
    setValue(old => {
      const value = typeof next === 'function' ? next(old) : next;
      writePref(name, value);
      return value;
    });
  }, [name]);
  return [value, set];
}
