import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BellOff } from 'lucide-react';
import { api } from '../api';
import { fmtDateTime } from './Shared';

/* Pausing Webex, Teams and notification emails, e.g. while creating many projects at
   once (server/notificationPause.js). The switch is in Settings → Email & notifications; while
   paused, managers see a reminder on every page so it is not left off by mistake. */
const CHANGED = 'notifications-pause-changed';

function usePauseStatus() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let live = true;
    const load = () => api.notificationsPause().then(value => { if (live) setStatus(value); }).catch(() => {});
    load();
    const changed = event => setStatus(event.detail);
    window.addEventListener(CHANGED, changed);
    return () => { live = false; window.removeEventListener(CHANGED, changed); };
  }, []);
  const set = async paused => {
    const value = await api.setNotificationsPause(paused);
    window.dispatchEvent(new CustomEvent(CHANGED, { detail: value }));
    return value;
  };
  return [status, set];
}

/** The switch (Settings → Integrations). */
export function NotificationsPauseCard() {
  const [status, set] = usePauseStatus();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (!status) return null;
  const toggle = async () => {
    setBusy(true); setError('');
    try { await set(!status.paused); } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  };
  return <div className={`card mb-16 notifications-pause${status.paused ? ' is-paused' : ''}`}>
    <div className="notifications-pause-row">
      <div>
        <h3 className="u-334fee5"><BellOff size={15} aria-hidden="true" /> Pause notifications</h3>
        <p className="text-sm text-muted">{status.paused
          ? <>Paused{status.by ? ` by ${status.by}` : ''}{status.since ? ` since ${fmtDateTime(status.since)}` : ''}. Nothing is posted to Webex or Teams and no notification emails are sent; what happens meanwhile is not sent later. The in-app bell still works.</>
          : 'For batch work, such as creating many projects or tasks: stops Webex, Teams and notification emails until you resume them. The in-app bell keeps working.'}</p>
        {error && <div className="error-msg" role="alert">{error}</div>}
      </div>
      <button type="button" className={`btn ${status.paused ? 'btn-primary' : 'btn-ghost'}`} disabled={busy} onClick={toggle}>
        {busy ? 'Saving…' : status.paused ? 'Resume notifications' : 'Pause notifications'}
      </button>
    </div>
  </div>;
}

/** The reminder on every page while paused (managers). */
export function NotificationsPausedBanner() {
  const [status] = usePauseStatus();
  if (!status?.paused) return null;
  return <div className="notifications-paused-banner" role="status">
    <BellOff size={14} aria-hidden="true" /> Webex, Teams and email notifications are paused.
    <Link to="/settings/notifications">Resume</Link>
  </div>;
}
