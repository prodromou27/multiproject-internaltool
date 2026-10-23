import { useEffect, useState } from 'react';
import { Contact, Plus, Star } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Modal } from './Shared';
import { useConfirm } from './Confirm';
import { useToast } from './Toast';

const EMPTY = { name: '', role: '', email: '', phone: '', notes: '', is_primary: false };

/* A customer's contacts on Customer 360 → Overview (server: customerContacts.js). Everyone
   who may open the customer sees them; managers and planners add, change and remove them,
   and choose the primary one (the contact the customer record, reports and search use). */
export default function CustomerContacts({ customerId }) {
  const { user } = useAuth() || {};
  const canEdit = ['manager', 'planner'].includes(user?.role);
  const toast = useToast(), confirm = useConfirm();
  const [contacts, setContacts] = useState(null), [error, setError] = useState(''), [editing, setEditing] = useState(null);

  useEffect(() => {
    let live = true;
    api.customerContacts(customerId).then(list => { if (live) setContacts(list); }).catch(failure => { if (live) setError(failure.message); });
    return () => { live = false; };
  }, [customerId]);

  async function makePrimary(contact) {
    try { setContacts((await api.updateCustomerContact(customerId, contact.id, { is_primary: true })).contacts); toast.success(`${contact.name || contact.email} is now the primary contact`); }
    catch (failure) { toast.error(failure.message); }
  }
  async function remove(contact) {
    if (!await confirm(`Remove ${contact.name || contact.email} from this customer's contacts?`, { title: 'Remove contact', label: 'Remove' })) return;
    try { setContacts((await api.deleteCustomerContact(customerId, contact.id)).contacts); toast.success('Contact removed'); }
    catch (failure) { toast.error(failure.message); }
  }

  return <section className="card cs-command-module customer-contacts">
    <header>
      <div><Contact size={17} aria-hidden="true" /><h2>Contacts</h2>{contacts && <span>{contacts.length}</span>}</div>
      {canEdit && <button type="button" onClick={() => setEditing({ ...EMPTY })}><Plus size={14} aria-hidden="true" /> Add contact</button>}
    </header>
    {error ? <div className="cs-module-local-error">{error}</div>
      : !contacts ? <div className="cs-module-skeleton"><span /><span /></div>
      : !contacts.length ? <p className="text-muted text-sm">No contacts yet.{canEdit ? ' Add the people you deal with at this customer.' : ''}</p>
      : <ul className="customer-contact-list">{contacts.map(contact => <li key={contact.id}>
        <div className="customer-contact-main">
          <strong>{contact.name || contact.email}</strong>
          {contact.is_primary && <span className="badge badge-open customer-contact-primary"><Star size={11} aria-hidden="true" /> Primary</span>}
          {contact.role && <span className="text-muted text-sm">{contact.role}</span>}
        </div>
        <div className="customer-contact-ways text-sm">
          {contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}
          {contact.phone && <a href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`}>{contact.phone}</a>}
        </div>
        {contact.notes && <p className="text-muted text-sm customer-contact-notes">{contact.notes}</p>}
        {canEdit && <div className="customer-contact-actions">
          {!contact.is_primary && <button type="button" className="btn btn-ghost btn-sm" onClick={() => makePrimary(contact)}>Make primary</button>}
          <button type="button" className="btn btn-ghost btn-sm" aria-label={`Edit ${contact.name || contact.email}`} onClick={() => setEditing({ ...EMPTY, ...contact })}>Edit</button>
          <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove ${contact.name || contact.email}`} onClick={() => remove(contact)}>Remove</button>
        </div>}
      </li>)}</ul>}
    {editing && <ContactForm customerId={customerId} initial={editing} onClose={() => setEditing(null)} onSaved={list => { setContacts(list); setEditing(null); toast.success('Contact saved'); }} />}
  </section>;
}

function ContactForm({ customerId, initial, onClose, onSaved }) {
  const [form, setForm] = useState(initial), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const set = key => event => setForm(current => ({ ...current, [key]: event.target.value }));
  async function submit(event) {
    event.preventDefault();
    if (!form.name.trim() && !form.email.trim()) { setError('Give the contact a name or an email address.'); return; }
    setSaving(true); setError('');
    const body = { name: form.name, role: form.role, email: form.email, phone: form.phone, notes: form.notes, ...(form.is_primary && !initial.is_primary ? { is_primary: true } : {}) };
    try {
      const result = initial.id ? await api.updateCustomerContact(customerId, initial.id, body) : await api.addCustomerContact(customerId, body);
      onSaved(result.contacts);
    } catch (failure) { setError(failure.message); }
    finally { setSaving(false); }
  }
  return <Modal title={initial.id ? 'Edit contact' : 'Add contact'} onClose={onClose}>
    <form onSubmit={submit}>
      {error && <div className="error-msg" role="alert">{error}</div>}
      <div className="form-row">
        <div className="form-group"><label htmlFor="contact-name">Name</label><input id="contact-name" value={form.name} onChange={set('name')} maxLength={200} autoFocus /></div>
        <div className="form-group"><label htmlFor="contact-role">Role</label><input id="contact-role" value={form.role} onChange={set('role')} maxLength={120} placeholder="e.g. IT manager" /></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label htmlFor="contact-email">Email</label><input id="contact-email" type="email" value={form.email} onChange={set('email')} maxLength={320} /></div>
        <div className="form-group"><label htmlFor="contact-phone">Phone</label><input id="contact-phone" value={form.phone} onChange={set('phone')} maxLength={60} /></div>
      </div>
      <div className="form-group"><label htmlFor="contact-notes">Notes</label><textarea id="contact-notes" rows={2} value={form.notes} onChange={set('notes')} maxLength={2000} /></div>
      {!initial.is_primary && <label className="customer-contact-primary-choice"><input type="checkbox" checked={!!form.is_primary} onChange={event => setForm(current => ({ ...current, is_primary: event.target.checked }))} /> Primary contact (used for reports and on the customer record)</label>}
      <div className="modal-footer u-cc45258">
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  </Modal>;
}
