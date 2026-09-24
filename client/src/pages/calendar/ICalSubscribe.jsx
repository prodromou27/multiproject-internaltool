import { useEffect, useState } from 'react';
import { Link2, Copy } from 'lucide-react';
import { api } from '../../api';

/* ── iCal Subscription Box ───────────────────────────────── */
export default function ICalSubscribe() {
  // status: null while loading, then { enabled, created_at }.
  // url is the raw subscription URL — only held in memory right after
  // (re)generation, since the token is hashed at rest and never re-displayed.
  const [status, setStatus] = useState(null);
  const [url,    setUrl]    = useState('');
  const [busy,   setBusy]   = useState(false);
  const [copied, setCopied] = useState(false);
  const [err,    setErr]    = useState('');

  useEffect(() => {
    api.icalTokenStatus().then(setStatus).catch(() => setStatus({ enabled: false }));
  }, []);

  async function generate() {
    setErr(''); setBusy(true);
    try {
      const { token } = await api.generateIcalToken();
      setUrl(`${window.location.origin}/api/calendar/ical?token=${token}`);
      setStatus({ enabled: true, created_at: new Date().toISOString() });
    } catch (e) {
      setErr(e.message || 'Failed to generate subscription URL');
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setErr(''); setBusy(true);
    try {
      await api.revokeIcalToken();
      setUrl('');
      setStatus({ enabled: false, created_at: null });
    } catch (e) {
      setErr(e.message || 'Failed to revoke subscription URL');
    } finally {
      setBusy(false);
    }
  }

  function copyUrl() {
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // Fallback for browsers without clipboard API
      const el = document.createElement('textarea');
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const btnPrimary = { display: 'inline-flex', alignItems: 'center', gap: 5, background: '#0284c7', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600, flexShrink: 0 };

  return (
    <div style={{ marginTop: 20, padding: '14px 18px', background: 'var(--primary-light)', border: '1px solid #bae6fd', borderRadius: 10, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <Link2 size={18} color="#0284c7" style={{ flexShrink: 0, marginTop: 2 }} />
      <div className="flex-1 min-w-0">
        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--tone-info-text)', marginBottom: 4 }}>
          Subscribe to your calendar (iCal)
        </div>
        <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--tone-info-text)' }}>
          Add this URL to Google Calendar, Outlook, Apple Calendar or any iCal-compatible app to see your tasks and visits automatically update.
        </p>

        {err && <div className="error-msg mb-8">{err}</div>}

        {status === null ? (
          <p style={{ margin: 0, fontSize: 12, color: 'var(--tone-info-text)' }}>Loading…</p>
        ) : url ? (
          <>
            <div className="flex gap-8 items-center flex-wrap">
              <input
                readOnly
                value={url}
                style={{ flex: 1, minWidth: 200, fontSize: 11, padding: '4px 8px', border: '1px solid #bae6fd', borderRadius: 4, background: 'var(--surface)', color: 'var(--tone-info-text)', fontFamily: 'monospace' }}
                onClick={e => e.target.select()}
              />
              <button
                className="btn btn-sm"
                onClick={copyUrl}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: copied ? '#10b981' : '#0284c7', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600, transition: 'background .2s', flexShrink: 0 }}
              >
                <Copy size={12} /> {copied ? 'Copied!' : 'Copy URL'}
              </button>
            </div>
            <p style={{ margin: '6px 0 0', fontSize: 11, color: '#0284c7', fontWeight: 600 }}>
              ⚠️ Copy this URL now — for security it won't be shown again. It is read-only (calendar events only) and can be revoked at any time.
            </p>
          </>
        ) : status.enabled ? (
          <div className="flex gap-8 items-center flex-wrap">
            <span style={{ fontSize: 12, color: 'var(--tone-info-text)', flex: 1, minWidth: 200 }}>
              You have an active subscription URL. For your security it can't be displayed again — regenerate to get a fresh URL (this invalidates the old one).
            </span>
            <button className="btn btn-sm" disabled={busy} onClick={generate} style={btnPrimary}>
              {busy ? '…' : 'Regenerate URL'}
            </button>
            <button className="btn btn-sm" disabled={busy} onClick={revoke}
              style={{ background: '#fff', color: 'var(--tone-danger-text)', border: '1px solid #fecaca', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
              Revoke
            </button>
          </div>
        ) : (
          <button className="btn btn-sm" disabled={busy} onClick={generate} style={btnPrimary}>
            <Link2 size={12} /> {busy ? 'Generating…' : 'Generate subscription URL'}
          </button>
        )}
      </div>
    </div>
  );
}
