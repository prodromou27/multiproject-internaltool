import React, { useState, useEffect } from 'react';

/* ── Dark mode hook ──────────────────────────────────────── */
export function useDarkMode() {
  const [dark, setDark] = useState(() => localStorage.getItem('hub_theme') === 'dark');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem('hub_theme', dark ? 'dark' : 'light');
  }, [dark]);
  return [dark, () => setDark(d => !d)];
}
