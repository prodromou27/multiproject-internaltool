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

export const DATE_FORMATS = ['DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD','D MMM YYYY','MMM D, YYYY'];

export const NUMBER_FORMATS = ['1,000.00','1.000,00','1 000.00','1000.00'];

export function LocalizationTab() {
  const toast = useToast();
  const DEFAULT = { default_language:'en', supported_languages:['en','el'], date_format:'DD/MM/YYYY', time_format:'24h', number_format:'1,000.00', timezone:'Asia/Nicosia' };
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
                <label key={l.code} className="u-f3842ee" style={{ background: on ? '#dbeafe' : 'var(--gray-100)', border: on ? '1px solid #93c5fd' : '1px solid transparent' }}>
                  <input type="checkbox" checked={on} onChange={() => toggleLang(l.code)} className="u-30e741d" />
                  {l.label}
                </label>
              );
            })}
          </div>
          <p className="text-sm text-muted mt-4">Languages available for user selection in the interface.</p>
        </div>
        <div className="form-group">
          <label>Time Zone</label>
          <select value={cfg.timezone} onChange={e => set('timezone', e.target.value)} className="u-2f3f7d7">
            {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
          </select>
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
