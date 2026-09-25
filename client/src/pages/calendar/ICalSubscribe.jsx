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
    <div className="u-7a5dec8">
      <Link2 size={18} color="#0284c7" style={{ flexShrink: 0, marginTop: 2 }} />
      <div className="flex-1 min-w-0">
        <div className="u-fd60ce2">
          Subscribe to your calendar (iCal)
        </div>
        <p className="u-fa2a4d1">
          Add this URL to Google Calendar, Outlook, Apple Calendar or any iCal-compatible app to see your tasks and visits automatically update.
        </p>

        {err && <div className="error-msg mb-8">{err}</div>}

        {status === null ? (
          <p className="u-5bfd35f">Loading…</p>
        ) : url ? (
          <>
            <div className="flex gap-8 items-center flex-wrap">
              <input
                readOnly
                value={url}
                className="u-460d01f"
                onClick={e => e.target.select()}
              />
              <button
                className="btn btn-sm u-08ffd64"
                onClick={copyUrl}
                style={{ background: copied ? '#10b981' : '#0284c7' }}
              >
                <Copy size={12} /> {copied ? 'Copied!' : 'Copy URL'}
              </button>
            </div>
            <p className="u-6777e74">
              ⚠️ Copy this URL now — for security it won't be shown again. It is read-only (calendar events only) and can be revoked at any time.
            </p>
          </>
        ) : status.enabled ? (
          <div className="flex gap-8 items-center flex-wrap">
            <span className="u-14096d2">
              You have an active subscription URL. For your security it can't be displayed again — regenerate to get a fresh URL (this invalidates the old one).
            </span>
            <button className="btn btn-sm" disabled={busy} onClick={generate} style={btnPrimary}>
              {busy ? '…' : 'Regenerate URL'}
            </button>
            <button className="btn btn-sm u-26d9401" disabled={busy} onClick={revoke}>
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
