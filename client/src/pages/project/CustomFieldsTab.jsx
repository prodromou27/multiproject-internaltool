import { useEffect, useState } from 'react';
import { X, SlidersHorizontal } from 'lucide-react';
import { api } from '../../api';
import { Modal } from '../../components/Shared';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/Confirm';

/* ── Custom Fields Tab ────────────────────────────────────── */
export function CustomFieldsTab({ projectId, canManage }) {
  const toast   = useToast();
  const confirm = useConfirm();
  const [fields,  setFields]  = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form,    setForm]    = useState({ name: '', field_type: 'text', options: [], required: false });
  const [optInput, setOptInput] = useState('');
  const [saving,  setSaving]  = useState(false);

  const loadFields = () => api.customFields(projectId).then(setFields).catch(() => {});
  useEffect(() => { loadFields(); }, [projectId]);

  function openAdd() {
    setEditing(null);
    setForm({ name: '', field_type: 'text', options: [], required: false });
    setOptInput('');
    setShowAdd(true);
  }

  function openEdit(f) {
    setEditing(f);
    setForm({ name: f.name, field_type: f.field_type, options: f.options || [], required: !!f.required });
    setOptInput('');
    setShowAdd(true);
  }

  async function save(e) {
    e.preventDefault(); setSaving(true);
    try {
      if (editing) {
        await api.updateCustomField(projectId, editing.id, form);
      } else {
        await api.createCustomField(projectId, form);
      }
      setShowAdd(false); setEditing(null); loadFields();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  }

  async function del(id) {
    const ok = await confirm('Delete this custom field? All task values for this field will also be removed.', { title: 'Delete Custom Field' });
    if (!ok) return;
    try { await api.deleteCustomField(projectId, id); loadFields(); } catch (e) { toast.error(e.message); }
  }

  function addOption() {
    const v = optInput.trim();
    if (!v || form.options.includes(v)) return;
    setForm(f => ({ ...f, options: [...f.options, v] }));
    setOptInput('');
  }

  function removeOption(opt) {
    setForm(f => ({ ...f, options: f.options.filter(o => o !== opt) }));
  }

  const TYPE_LABELS = { text: 'Text', number: 'Number', date: 'Date', select: 'Dropdown' };

  return (
    <div>
      {canManage && (
        <div className="flex justify-end mb-12">
          <button className="btn btn-primary btn-sm" onClick={openAdd}>+ Add Field</button>
        </div>
      )}

      {fields.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--gray-400)' }}>
          <SlidersHorizontal size={32} style={{ marginBottom: 8, opacity: .3 }} />
          <p className="text-sm">No custom fields yet. Add project-specific fields like "Device Type" or "Ticket ID".</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Field Name</th><th>Type</th><th>Required</th>{canManage && <th>Actions</th>}</tr></thead>
            <tbody>
              {fields.map(f => (
                <tr key={f.id}>
                  <td className="font-semibold">{f.name}</td>
                  <td>
                    <span style={{ fontSize: 11, background: 'var(--gray-100)', padding: '2px 8px', borderRadius: 6, fontWeight: 600, color: 'var(--gray-600)' }}>
                      {TYPE_LABELS[f.field_type] || f.field_type}
                    </span>
                    {f.field_type === 'select' && f.options?.length > 0 && (
                      <span style={{ fontSize: 11, color: 'var(--gray-400)', marginLeft: 6 }}>
                        ({f.options.join(', ')})
                      </span>
                    )}
                  </td>
                  <td>{f.required ? <span style={{ color: '#ef4444', fontWeight: 700 }}>Required</span> : <span className="text-muted">Optional</span>}</td>
                  {canManage && (
                    <td className="flex gap-6">
                      <button className="btn btn-sm btn-ghost" onClick={() => openEdit(f)}>Edit</button>
                      <button className="btn btn-sm btn-danger" onClick={() => del(f.id)}>Delete</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <Modal title={editing ? 'Edit Custom Field' : 'Add Custom Field'} onClose={() => { setShowAdd(false); setEditing(null); }}>
          <form onSubmit={save}>
            <div className="form-group">
              <label>Field Name *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required autoFocus placeholder="e.g. Device Type, Ticket ID" />
            </div>
            <div className="form-group">
              <label>Field Type</label>
              <select value={form.field_type} onChange={e => setForm(f => ({ ...f, field_type: e.target.value, options: [] }))}>
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="date">Date</option>
                <option value="select">Dropdown (select)</option>
              </select>
            </div>
            {form.field_type === 'select' && (
              <div className="form-group">
                <label>Options</label>
                <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                  <input
                    value={optInput}
                    onChange={e => setOptInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOption(); } }}
                    placeholder="Type an option and press Enter"
                    className="flex-1"
                  />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={addOption}>Add</button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {form.options.map(opt => (
                    <span key={opt} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px',
                      background: 'var(--primary-light)', color: 'var(--tone-info-text)', borderRadius: 6, fontSize: 12, fontWeight: 600,
                    }}>
                      {opt}
                      <button type="button" onClick={() => removeOption(opt)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3b82f6', padding: 0, display: 'flex', alignItems: 'center' }}>
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, textTransform: 'none', letterSpacing: 0, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.required} onChange={e => setForm(f => ({ ...f, required: e.target.checked }))} style={{ width: 'auto' }} />
                Required field
              </label>
            </div>
            <div className="modal-footer" style={{ padding: '12px 0 0', border: 'none' }}>
              <button type="button" className="btn btn-ghost" onClick={() => { setShowAdd(false); setEditing(null); }}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : (editing ? 'Save Changes' : 'Add Field')}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
