/**
 * Localization: loads the admin-configured date/time/number format and timezone
 * once per session and exposes synchronous formatters that the rest of the app
 * (via components/Shared.jsx's fmtDate/fmtDateTime) uses instead of a hardcoded
 * 'en-US' locale. Falls back to sane defaults before the config loads or if the
 * request fails, so no caller needs to handle a "not loaded yet" state.
 */
import { useEffect, useState } from 'react';
import { api } from '../api.js';

export const DEFAULT_LOCALE_CONFIG = {
  default_language: 'en',
  supported_languages: ['en', 'el'],
  date_format: 'DD/MM/YYYY',
  time_format: '24h',
  number_format: '1,000.00',
  timezone: 'Asia/Nicosia',
};

let config = { ...DEFAULT_LOCALE_CONFIG };
let loaded = false;
let pending = null;
const listeners = new Set();

function notify() { listeners.forEach(fn => { try { fn(config); } catch { /* listener error is not this module's concern */ } }); }

/** Fetch the saved config once; safe to call from multiple components — shares one in-flight request. */
export function loadLocaleConfig() {
  if (loaded) return Promise.resolve(config);
  if (pending) return pending;
  pending = api.getLocalization({ redirectOnUnauthorized: false })
    .then(data => { setLocaleConfig(data); return config; })
    .catch(() => { loaded = true; return config; })
    .finally(() => { pending = null; });
  return pending;
}

/** Called by LocalizationTab right after a successful save so formatting updates without a reload. */
export function setLocaleConfig(next) {
  if (next && typeof next === 'object') config = { ...DEFAULT_LOCALE_CONFIG, ...next };
  loaded = true;
  notify();
}

export function getLocaleConfig() { return config; }

/** React hook: re-renders the component when the locale config loads or changes. */
export function useLocaleConfig() {
  const [cfg, setCfg] = useState(config);
  useEffect(() => {
    listeners.add(setCfg);
    loadLocaleConfig();
    return () => listeners.delete(setCfg);
  }, []);
  return cfg;
}

// ── Formatting ────────────────────────────────────────────────────────────────

function pad2(n) { return String(n).padStart(2, '0'); }

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Assemble Y/M/D (+ optional H/M) components per the configured date_format / time_format.
// Pure string assembly — no Intl needed since we already have numeric parts.
function assemble({ year, month, day, hour, minute }, cfg) {
  const mm = pad2(month), dd = pad2(day), mon = MONTH_SHORT[month - 1] || mm;
  let datePart;
  switch (cfg.date_format) {
    case 'MM/DD/YYYY':  datePart = `${mm}/${dd}/${year}`; break;
    case 'YYYY-MM-DD':  datePart = `${year}-${mm}-${dd}`; break;
    case 'D MMM YYYY':  datePart = `${day} ${mon} ${year}`; break;
    case 'MMM D, YYYY': datePart = `${mon} ${day}, ${year}`; break;
    case 'DD/MM/YYYY':
    default:            datePart = `${dd}/${mm}/${year}`;
  }
  if (hour === undefined) return datePart;
  let timePart;
  if (cfg.time_format === '12h') {
    const h12 = hour % 12 || 12;
    timePart = `${h12}:${pad2(minute)} ${hour < 12 ? 'AM' : 'PM'}`;
  } else {
    timePart = `${pad2(hour)}:${pad2(minute)}`;
  }
  return `${datePart}, ${timePart}`;
}

/**
 * Formats a plain calendar date ("YYYY-MM-DD..." or Date/ISO). Calendar dates are
 * never shifted by timezone — a stored deadline of 2026-09-22 is the 22nd
 * everywhere, matching the previous (pre-localization) behavior.
 */
export function formatDate(value, cfg = config) {
  if (!value) return null;
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '—';
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  if (isNaN(date)) return '—';
  return assemble({ year: Number(y), month: Number(mo), day: Number(d) }, cfg);
}

/** Formats an actual timestamp (created_at, etc.) converted into the configured timezone. */
export function formatDateTime(value, cfg = config) {
  if (!value) return '—';
  const date = new Date(value);
  if (isNaN(date)) return '—';
  let parts;
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: cfg.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    const p = Object.fromEntries(dtf.formatToParts(date).map(x => [x.type, x.value]));
    parts = { year: Number(p.year), month: Number(p.month), day: Number(p.day), hour: Number(p.hour === '24' ? '0' : p.hour), minute: Number(p.minute) };
  } catch {
    // Unknown/invalid timezone string — fall back to the browser's local time rather than crash.
    parts = { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), hour: date.getHours(), minute: date.getMinutes() };
  }
  return assemble(parts, cfg);
}

/** Formats a number using the configured group/decimal separators. */
export function formatNumber(value, cfg = config, { decimals } = {}) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const dp = decimals ?? (Number.isInteger(n) ? 0 : 2);
  const [group, decimal] = {
    '1,000.00': [',', '.'],
    '1.000,00': ['.', ','],
    '1 000.00': [' ', '.'],
    '1000.00':  ['', '.'],
  }[cfg.number_format] || [',', '.'];
  const fixed = Math.abs(n).toFixed(dp);
  const [intPart, decPart] = fixed.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return (n < 0 ? '-' : '') + grouped + (decPart ? decimal + decPart : '');
}
