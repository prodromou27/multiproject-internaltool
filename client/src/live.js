import { useEffect, useRef, useSyncExternalStore } from 'react';

/* Live updates. The server announces each change other people make (see
   server/liveUpdates.js); pages that read `useLiveVersion()` in their loading
   effects re-read their data in the background when it ticks.

   Changes arriving close together are combined, and while the tab is hidden
   they wait until it is visible again, so a busy team never floods a tab that
   nobody is looking at. */

// This tab's identity, sent with every request so it can skip its own changes.
export const CLIENT_ID = (globalThis.crypto?.randomUUID?.() || `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9-]/g, '').slice(0, 64);

const SETTLE_MS = 800;
let version = 0;
let source = null;
let timer = null;
let pending = false;
const listeners = new Set();

function bump() {
  timer = null;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') { pending = true; return; }
  pending = false;
  version += 1;
  listeners.forEach(listener => listener());
}
function changed() { if (!timer) timer = setTimeout(bump, SETTLE_MS); }
function onVisible() { if (document.visibilityState === 'visible' && pending) changed(); }

/** Open the live connection for the signed-in user (idempotent). */
export function startLive() {
  if (source || typeof EventSource === 'undefined') return;
  let dropped = false;
  source = new EventSource(`/api/live?client=${encodeURIComponent(CLIENT_ID)}`, { withCredentials: true });
  source.addEventListener('change', changed);
  // After a dropped connection, anything may have changed meanwhile.
  source.onerror = () => { dropped = true; };
  source.onopen = () => { if (dropped) { dropped = false; changed(); } };
  document.addEventListener('visibilitychange', onVisible);
}

/** Close it again (sign-out). */
export function stopLive() {
  source?.close();
  source = null;
  clearTimeout(timer); timer = null; pending = false;
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
}

const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
const snapshot = () => version;

/** A number that goes up whenever someone else changes data. Add it to a loading effect's dependencies. */
export function useLiveVersion() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * Call `refresh` whenever someone else changes data (not on first render).
 * Pass a refresh that keeps what is on screen (filters, selection, scroll) and
 * swaps in the new data when it arrives.
 */
export function useLiveRefresh(refresh) {
  const current = useLiveVersion();
  const seen = useRef(current);
  const latest = useRef(refresh);
  useEffect(() => { latest.current = refresh; });
  useEffect(() => {
    if (seen.current === current) return;
    seen.current = current;
    latest.current?.();
  }, [current]);
}
