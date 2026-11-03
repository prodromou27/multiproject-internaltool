import { useEffect, useRef, useState } from 'react';
import { History } from 'lucide-react';
import { useAuth } from '../App';
import { fmtDateTime } from '../components/Shared';

/* A draft of a long form, kept while it is being filled in, so a refresh, a
   closed dialog or a session that ran out does not lose the work (review I03).

   - Kept in this browser tab only (sessionStorage), per person and per record, and
     for at most a day: closing the browser on a shared computer removes it.
   - Never applied by itself: reopening the form offers "Restore draft" or
     "Discard draft". A restored draft is labelled as one and is saved only by Save.
   - `base` is the record's version/updated_at when the draft was started; if the
     record changed since, the offer says so.
   Call clear() once the form is saved. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function useFormDraft({ name, value, base = null, enabled = true }) {
  const { user } = useAuth() || {};
  const key = `teamhub-draft:${user?.id ?? 'anon'}:${name}`;
  const read = () => {
    try {
      const draft = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (!draft || Date.now() - draft.saved_at > MAX_AGE_MS) { sessionStorage.removeItem(key); return null; }
      return draft;
    } catch { return null; }
  };
  const [offer, setOffer] = useState(() => (enabled ? read() : null));
  const [restored, setRestored] = useState(false);
  const start = useRef(JSON.stringify(value));

  useEffect(() => {
    if (!enabled || offer) return; // an open offer is not overwritten until answered
    const json = JSON.stringify(value);
    if (json === start.current) return;
    try { sessionStorage.setItem(key, JSON.stringify({ data: value, saved_at: Date.now(), base })); } catch { /* storage full or blocked: no draft */ }
  }, [value, enabled, offer, key, base]);

  const clear = () => { try { sessionStorage.removeItem(key); } catch { /* nothing kept */ } setOffer(null); };
  return {
    offer,
    restored,
    // The record changed after this draft was started.
    stale: !!(offer && base != null && offer.base != null && String(offer.base) !== String(base)),
    restore: () => { const data = offer?.data; setOffer(null); setRestored(true); start.current = ''; return data; },
    discard: clear,
    clear,
  };
}

/** The offer to restore a draft, or the note that the form shows one. */
export function DraftBanner({ draft, onRestore }) {
  if (draft.restored) return <div className="draft-banner is-restored" role="status"><History size={14} aria-hidden="true" /> This is your restored draft. It is not saved until you press Save.</div>;
  if (!draft.offer) return null;
  return <div className="draft-banner" role="status">
    <History size={14} aria-hidden="true" />
    <span>You have an unsaved draft from {fmtDateTime(new Date(draft.offer.saved_at).toISOString())}.{draft.stale ? ' This record has changed since then, so check the draft before saving it.' : ''}</span>
    <button type="button" className="btn btn-primary btn-sm" onClick={() => onRestore(draft.restore())}>Restore draft</button>
    <button type="button" className="btn btn-ghost btn-sm" onClick={draft.discard}>Discard draft</button>
  </div>;
}
