import { useEffect, useState } from 'react';
import { Mail } from 'lucide-react';
import { api } from '../api';
import { Modal } from './Shared';
import { useToast } from './Toast';

/* Reply with a Customer Response (enhancement E07): pick a text, see it filled from
   this customer, task or visit, change it if needed, then copy it or send it to the
   customer's contact. Nothing is sent without pressing Send. */
export function ResponseComposer({ context, onDone }) {
  const toast = useToast();
  const [responses, setResponses] = useState(null), [chosen, setChosen] = useState('');
  const [draft, setDraft] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { api.customerResponses().then(data => setResponses(data.rows)).catch(failure => setError(failure.message)); }, []);

  async function choose(id) {
    setChosen(id); setDraft(null); setError('');
    if (!id) return;
    try { setDraft(await api.composeCustomerResponse(id, context)); }
    catch (failure) { setError(failure.message); }
  }
  const unfilled = draft && /\{\{\s*[a-z_]+\s*\}\}/.test(draft.subject + draft.body);
  async function copy() {
    try { await navigator.clipboard.writeText(draft.body); toast.success('Copied'); }
    catch { toast.error('Could not copy; select the text and copy it'); }
  }
  async function send() {
    setBusy(true); setError('');
    try { await api.sendCustomerResponse(chosen, { context, to: draft.recipients[0], subject: draft.subject, body: draft.body }); toast.success(`Sent to ${draft.recipients[0]}`); onDone?.(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="response-composer">
      <div className="form-group">
        <label htmlFor="response-choice">Response</label>
        <select id="response-choice" value={chosen} onChange={event => choose(event.target.value)} disabled={!responses}>
          <option value="">{responses ? 'Choose a response…' : 'Loading…'}</option>
          {(responses || []).map(row => <option key={row.id} value={row.id}>{row.title}</option>)}
        </select>
      </div>
      {error && <p className="error-msg" role="alert">{error}</p>}
      {draft && <>
        {draft.missing.length > 0 && <p className="alert alert-warning" role="note">Not known here, fill in by hand: {draft.missing.map(m => m.label).join(', ')}.</p>}
        <div className="form-group"><label htmlFor="response-subject">Subject</label><input id="response-subject" value={draft.subject} maxLength={200} onChange={event => setDraft(d => ({ ...d, subject: event.target.value }))} /></div>
        <div className="form-group"><label htmlFor="response-body">Text</label><textarea id="response-body" rows={9} value={draft.body} onChange={event => setDraft(d => ({ ...d, body: event.target.value }))} /></div>
        <p className="text-sm text-muted">{draft.recipients.length ? `To: ${draft.recipients[0]} (the customer's contact)` : 'The customer has no contact email, so this can only be copied.'}{draft.recipients.length > 0 && !draft.email_available && ' Email is not set up, so this can only be copied.'}</p>
        <div className="flex gap-8">
          <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>Copy text</button>
          {draft.recipients.length > 0 && draft.email_available && (
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || unfilled || !draft.subject.trim() || !draft.body.trim()} onClick={send} title={unfilled ? 'Fill in or remove the {{placeholders}} first' : undefined}>
              {busy ? 'Sending…' : `Send to ${draft.recipients[0]}`}
            </button>
          )}
        </div>
      </>}
    </div>
  );
}

/** A button that opens the composer: in its own dialog, or `inline` inside one that is already open. */
export function ReplyWithResponse({ context, inline = false, className = 'btn btn-ghost btn-sm' }) {
  const [open, setOpen] = useState(false);
  const button = <button type="button" className={className} aria-expanded={inline ? open : undefined} onClick={() => setOpen(value => !value)}><Mail size={13} aria-hidden="true" /> Reply with a response</button>;
  if (inline) return <>{button}{open && <section aria-label="Reply with a response" className="card" style={{ marginTop: 10, padding: 12 }}><ResponseComposer context={context} onDone={() => setOpen(false)} /></section>}</>;
  return <>{button}{open && <Modal title="Reply with a response" onClose={() => setOpen(false)}><ResponseComposer context={context} onDone={() => setOpen(false)} /></Modal>}</>;
}
