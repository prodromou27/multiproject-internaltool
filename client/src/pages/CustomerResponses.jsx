import { useCallback, useEffect, useState } from 'react';
import { Copy, Check, Pencil, Trash2, Plus } from 'lucide-react';
import { api } from '../api';
import { Modal } from '../components/Shared';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';

/* Each response's colour: the left edge, the dot and the text background. */
const TONES = {
  // Theme tokens, so the cards stay readable in dark mode.
  success: { color: 'var(--tone-success-text)', bg: 'var(--success-light)', label: 'Green' },
  warning: { color: 'var(--tone-warning-text)', bg: 'var(--warning-light)', label: 'Amber' },
  indigo: { color: 'var(--primary)', bg: 'var(--primary-light)', label: 'Indigo' },
  danger: { color: 'var(--tone-danger-text)', bg: 'var(--danger-light)', label: 'Red' },
  info: { color: 'var(--tone-info-text)', bg: 'var(--primary-light)', label: 'Blue' },
  neutral: { color: 'var(--gray-500)', bg: 'var(--gray-50)', label: 'Grey' },
};
const toneOf = row => TONES[row.tone] || TONES.neutral;

function TemplateCard({ tpl, onEdit, onDelete }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    const markDone = () => { setCopied(true); setTimeout(() => setCopied(false), 2000); };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(tpl.body).then(markDone).catch(() => fallbackCopy(tpl.body, markDone));
    } else {
      fallbackCopy(tpl.body, markDone);
    }
  }

  function fallbackCopy(text, onDone) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); onDone(); } catch (_) {}
    document.body.removeChild(ta);
  }

  return (
    <div className="card u-87c136d" style={{ borderLeft: `3px solid ${toneOf(tpl).color}` }}>
      <div className="flex items-center justify-between mb-12">
        <div className="flex-center gap-10">
          <div className="u-2dcdba7" style={{ background: toneOf(tpl).color }} />
          <span className="u-e6cd714">{tpl.title}</span>
        </div>
        <div className="flex-center gap-6">
        {onEdit && <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit} aria-label={`Edit ${tpl.title}`}><Pencil size={13} /></button>}
        {onDelete && <button type="button" className="btn btn-ghost btn-sm" onClick={onDelete} aria-label={`Delete ${tpl.title}`}><Trash2 size={13} /></button>}
        <button
          onClick={copy}
          className="btn btn-sm u-145410d"
          style={{ background: copied ? 'var(--success-light)' : 'var(--gray-50)', color: copied ? 'var(--tone-success-text)' : 'var(--gray-600)', border: `1px solid ${copied ? 'var(--tone-success-text)' : 'var(--gray-200)'}` }}
        >
          {copied ? <><Check size={13} /> Copied!</> : <><Copy size={13} /> Copy</>}
        </button>
        </div>
      </div>
      <pre className="u-1465002" style={{ background: toneOf(tpl).bg, border: '1px solid var(--gray-200)' }}>
        {tpl.body}
      </pre>
    </div>
  );
}

function ResponseForm({ initial, onSaved, onClose }) {
  const [form, setForm] = useState(initial || { title: '', body: '', tone: 'neutral' });
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const set = key => event => setForm(current => ({ ...current, [key]: event.target.value }));
  // The {{names}} a text may use; they are filled in when replying from a customer, task or visit.
  const [placeholders, setPlaceholders] = useState(null);
  useEffect(() => { api.responsePlaceholders().then(setPlaceholders).catch(() => setPlaceholders(null)); }, []);
  async function submit(event) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const body = { title: form.title, body: form.body, tone: form.tone };
      if (initial) await api.updateCustomerResponse(initial.id, body); else await api.createCustomerResponse(body);
      onSaved(); onClose();
    } catch (failure) { setError(failure.message); } finally { setSaving(false); }
  }
  return <Modal title={initial ? 'Edit response' : 'New response'} onClose={saving ? () => {} : onClose}>
    <form onSubmit={submit}>
      {error && <div className="error-msg" role="alert">{error}</div>}
      <div className="form-row">
        <div className="form-group"><label htmlFor="response-title">Title</label><input id="response-title" required maxLength={120} value={form.title} onChange={set('title')} autoFocus /></div>
        <div className="form-group"><label htmlFor="response-tone">Colour</label><select id="response-tone" value={form.tone} onChange={set('tone')}>{Object.entries(TONES).map(([value, tone]) => <option key={value} value={value}>{tone.label}</option>)}</select></div>
      </div>
      <div className="form-group"><label htmlFor="response-body">Text</label><textarea id="response-body" required rows={10} maxLength={10000} value={form.body} onChange={set('body')} aria-describedby={placeholders ? 'response-placeholders' : undefined} />
        {placeholders && <small id="response-placeholders" className="text-muted text-sm">Filled in when replying from a customer, task or visit: {Object.entries(placeholders).map(([name, label]) => `{{${name}}} (${label.toLowerCase()})`).join(', ')}.</small>}</div>
      <div className="modal-footer"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></div>
    </form>
  </Modal>;
}

export default function CustomerResponses() {
  const toast = useToast(), confirm = useConfirm();
  const [data, setData] = useState(null), [error, setError] = useState(''), [editing, setEditing] = useState(null);
  const load = useCallback(() => api.customerResponses().then(result => setData({ rows: Array.isArray(result?.rows) ? result.rows : [], can_edit: !!result?.can_edit })).catch(failure => setError(failure.message)), []);
  useEffect(() => { load(); }, [load]);
  async function remove(row) {
    if (!await confirm(`Delete the response "${row.title}"? Everyone stops seeing it.`, { title: 'Delete response', label: 'Delete' })) return;
    try { await api.deleteCustomerResponse(row.id); toast.success('Response deleted'); load(); } catch (failure) { toast.error(failure.message); }
  }
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Customer Responses</h1>
          <div className="page-subtitle">Ready-to-use email texts — click Copy then paste into your email</div>
        </div>
        {data?.can_edit && <button type="button" className="btn btn-primary" onClick={() => setEditing({})}><Plus size={14} /> New response</button>}
      </div>
      {error && <div className="error-msg" role="alert">{error}</div>}
      {data && !data.rows.length && <div className="card empty"><p>No responses yet.{data.can_edit ? ' Add the first one with New response.' : ''}</p></div>}
      <div className="u-b12974c">
        {data?.rows.map(tpl => <TemplateCard key={tpl.id} tpl={tpl} onEdit={data.can_edit ? () => setEditing({ row: tpl }) : null} onDelete={data.can_edit ? () => remove(tpl) : null} />)}
      </div>
      {editing && <ResponseForm initial={editing.row} onClose={() => setEditing(null)} onSaved={() => { toast.success(editing.row ? 'Response saved' : 'Response added'); load(); }} />}
    </div>
  );
}
