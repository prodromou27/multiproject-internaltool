import { useEffect, useState } from 'react';
import { Save, Loader2, Globe, Clock } from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../../components/Toast';
import { setLocaleConfig } from '../../utils/locale';

/* ── Localization Tab ────────────────────────────────────── */
export const LANGUAGES = [
  { code: 'en', label: 'English' }, { code: 'el', label: 'Greek' },
  { code: 'de', label: 'German' }, { code: 'fr', label: 'French' },
  { code: 'es', label: 'Spanish' }, { code: 'it', label: 'Italian' },
  { code: 'ar', label: 'Arabic' }, { code: 'tr', label: 'Turkish' },
  { code: 'ru', label: 'Russian' }, { code: 'zh', label: 'Chinese' },
];

export const TIMEZONES = [
  'Asia/Nicosia','UTC','Europe/London','Europe/Paris','Europe/Berlin','Europe/Athens',
  'Europe/Moscow','America/New_York','America/Chicago','America/Denver','America/Los_Angeles',
  'Asia/Dubai','Asia/Riyadh','Asia/Kolkata','Asia/Singapore','Asia/Tokyo','Australia/Sydney',
  'Pacific/Auckland',
];

// Every zone the browser knows, falling back to the short list above on older browsers.
const ALL_TIMEZONES = (() => { try { const zones = Intl.supportedValuesOf('timeZone'); return zones.includes('UTC') ? zones : ['UTC', ...zones]; } catch { return TIMEZONES; } })();

export const DATE_FORMATS = ['DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD','D MMM YYYY','MMM D, YYYY'];

export const NUMBER_FORMATS = ['1,000.00','1.000,00','1 000.00','1000.00'];

const zoneTime = zone => { try { return new Intl.DateTimeFormat(undefined, { timeZone: zone, weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date()); } catch { return '—'; } };

/* The server's clock: which NTP server it is checked against, and how far off it was. */
function ServerClock({ cfg, set, saved }) {
  const [clock, setClock] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { api.serverClock().then(setClock).catch(failure => setError(failure.message)); }, []);
  async function checkNow() {
    setBusy(true); setError('');
    try { setClock(await api.checkServerClock(cfg.ntp_server && cfg.ntp_server !== saved?.ntp_server ? cfg.ntp_server : undefined)); }
    catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  const ntp = clock?.ntp;
  const drift = ntp && ntp.offset_ms != null ? Math.abs(ntp.offset_ms) : null;
  const tone = ntp?.error ? 'is-warning' : drift == null ? '' : drift > (clock?.warn_offset_ms ?? 5000) ? 'is-danger' : 'is-ok';
  return (
    <div className="card mb-16 server-clock">
      <div className="card-header"><h3 className="u-334fee5"><Clock size={15} /> Server clock</h3></div>
      <p className="text-sm text-muted">The server's clock is kept right by its host (the operating system or container platform). The app checks it against an NTP server and warns when it drifts, because sign-in, two-factor codes and reminders depend on it.</p>
      <div className="form-row">
        <div className="form-group">
          <label htmlFor="localization-ntp">NTP server</label>
          <input id="localization-ntp" value={cfg.ntp_server || ''} maxLength={253} placeholder="pool.ntp.org" onChange={e => set('ntp_server', e.target.value.trim())} />
          <p className="text-sm text-muted mt-4">Your own time server (for example a domain controller) or a public one such as pool.ntp.org or time.windows.com. Uses UDP port 123.</p>
        </div>
        <div className="form-group">
          <label htmlFor="localization-ntp-check">Regular checks</label>
          <label className="server-clock-switch"><input id="localization-ntp-check" type="checkbox" checked={cfg.ntp_check_enabled !== false} onChange={e => set('ntp_check_enabled', e.target.checked)} /> Check every 6 hours</label>
        </div>
      </div>
      {error && <div className="error-msg" role="alert">{error}</div>}
      {clock && <div className={`server-clock-status ${tone}`} role="status">
        <div><span>Server time ({clock.timezone.replaceAll('_', ' ')})</span><strong>{clock.local_time}</strong></div>
        <div><span>Last check</span><strong>{!ntp ? 'Not checked yet' : ntp.error ? 'Could not reach the NTP server' : drift <= (clock.warn_offset_ms ?? 5000) ? `In sync (${ntp.offset_ms > 0 ? '+' : ''}${ntp.offset_ms} ms)` : `Off by ${(ntp.offset_ms / 1000).toFixed(1)} s`}</strong>
          {ntp && <small>{ntp.server} · {new Date(ntp.checked_at).toLocaleString()}{ntp.error ? ` · ${ntp.error}` : ''}</small>}</div>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={checkNow}>{busy ? 'Checking…' : 'Check now'}</button>
      </div>}
      {drift != null && drift > (clock?.warn_offset_ms ?? 5000) && <p className="text-sm server-clock-advice">Fix the clock on the server host: turn on time synchronisation (for example <code>timedatectl set-ntp true</code> on Linux, or the Windows Time service), pointing at {ntp.server}. Containers take their time from the host.</p>}
    </div>
  );
}

export function LocalizationTab() {
  const toast = useToast();
  const DEFAULT = { default_language:'en', supported_languages:['en','el'], date_format:'DD/MM/YYYY', time_format:'24h', number_format:'1,000.00', timezone:'Asia/Nicosia', ntp_server:'pool.ntp.org', ntp_check_enabled:true };
  const [cfg, setCfg]     = useState(DEFAULT);
  const [saved, setSaved] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { api.getLocalization().then(d => { if (d) { setCfg(d); setSaved(d); } setLoading(false); }).catch(() => setLoading(false)); }, []);

  const set = (k, v) => setCfg(c => ({ ...c, [k]: v }));
  const toggleLang = code => set('supported_languages',
    cfg.supported_languages.includes(code)
      ? cfg.supported_languages.filter(l => l !== code)
      : [...cfg.supported_languages, code]
  );
  const dirty = JSON.stringify(cfg) !== JSON.stringify(saved);

  async function save() {
    setSaving(true);
    try {
      await api.saveLocalization(cfg);
      setSaved({ ...cfg });
      // Applies immediately, everywhere in this session — dates/numbers reformat without a reload.
      setLocaleConfig(cfg);
      toast.success('Localization settings saved — dates and numbers across the app now use it');
    }
    catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  if (loading) return <p className="text-muted">Loading…</p>;

  return (
    <div className="u-b12974c">
      {/* Language */}
      <div className="card mb-16">
        <div className="card-header">
          <h3 className="u-334fee5">
            <Globe size={15} /> Language &amp; Region
          </h3>
        </div>
        <div className="form-group">
          <label>Default Language</label>
          <select value={cfg.default_language} onChange={e => set('default_language', e.target.value)} className="u-a5d7a03">
            {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Supported Languages</label>
          <div className="u-650b1c9">
            {LANGUAGES.map(l => {
              const on = cfg.supported_languages.includes(l.code);
              return (
                <label key={l.code} className={["u-f3842ee", (on ? 'u-4c55566' : 'u-d994785'), (on ? 'u-8b7de93' : 'u-52e7996')].filter(Boolean).join(' ')}>
                  <input type="checkbox" checked={on} onChange={() => toggleLang(l.code)} className="u-30e741d" />
                  {l.label}
                </label>
              );
            })}
          </div>
          <p className="text-sm text-muted mt-4">Languages available for user selection in the interface.</p>
        </div>
        <div className="form-group">
          <label htmlFor="localization-timezone">Time Zone</label>
          <select id="localization-timezone" value={cfg.timezone} onChange={e => set('timezone', e.target.value)} className="u-2f3f7d7">
            {(ALL_TIMEZONES.includes(cfg.timezone) ? ALL_TIMEZONES : [cfg.timezone, ...ALL_TIMEZONES]).map(tz => <option key={tz} value={tz}>{tz.replaceAll('_', ' ')}</option>)}
          </select>
          <p className="text-sm text-muted mt-4">Decides what "today" means for due and overdue work, report periods and the 08:00 reminders. Now there: {zoneTime(cfg.timezone)}.</p>
        </div>
      </div>

      {/* Date & Time */}
      <div className="card mb-16">
        <div className="card-header">
          <h3 className="u-334fee5">
            <Clock size={15} /> Date, Time &amp; Numbers
          </h3>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Date Format</label>
            <select value={cfg.date_format} onChange={e => set('date_format', e.target.value)}>
              {DATE_FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Time Format</label>
            <select value={cfg.time_format} onChange={e => set('time_format', e.target.value)}>
              <option value="24h">24-hour (14:30)</option>
              <option value="12h">12-hour (2:30 PM)</option>
            </select>
          </div>
        </div>
        <div className="form-group">
          <label>Number Format</label>
          <select value={cfg.number_format} onChange={e => set('number_format', e.target.value)} className="u-a828909">
            {NUMBER_FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <p className="text-sm text-muted mt-4">Example: {cfg.number_format === '1.000,00' ? '1.234,56' : cfg.number_format === '1 000.00' ? '1 234.56' : cfg.number_format === '1000.00' ? '1234.56' : '1,234.56'}</p>
        </div>
      </div>

      <ServerClock cfg={cfg} set={set} saved={saved} />

      <div className="flex gap-10">
        <button className="btn btn-primary inline-flex items-center gap-6" disabled={!dirty || saving} onClick={save}
         >
          {saving ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={14} />}
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
        {dirty && <button className="btn btn-ghost" onClick={() => setCfg({ ...saved })}>Discard Changes</button>}
      </div>
    </div>
  );
}
