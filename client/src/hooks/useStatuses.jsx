import { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../api';

/* ── Context ──────────────────────────────────────────────── */
export const StatusContext = createContext(null);

/* ── Hook ─────────────────────────────────────────────────── */
export function useStatuses() {
  return useContext(StatusContext);
}

/* ── Helpers (work with the config object directly) ─────── */
export function getStatusDef(config, entityType, value) {
  if (!config || !config[entityType]) return null;
  return config[entityType].find(s => s.value === value) || null;
}

export function getStatusesFor(config, entityType) {
  if (!config) return [];
  return config[entityType] || [];
}

/* ── Provider (wrap authenticated parts of the app) ─────── */
export function StatusProvider({ children, enabled }) {
  const [config, setConfig] = useState(null);

  const reload = () =>
    api.getStatuses().then(setConfig).catch(() => {});

  useEffect(() => {
    if (enabled) reload();
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <StatusContext.Provider value={{ config, reload }}>
      {children}
    </StatusContext.Provider>
  );
}
