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
        <div className="u-c0ee35e">
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
                    <span className="u-fc3ef5c">
                      {TYPE_LABELS[f.field_type] || f.field_type}
                    </span>
                    {f.field_type === 'select' && f.options?.length > 0 && (
                      <span className="u-b1235e7">
                        ({f.options.join(', ')})
                      </span>
                    )}
                  </td>
                  <td>{f.required ? <span className="u-bdb581f">Required</span> : <span className="text-muted">Optional</span>}</td>
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
                <div className="u-c4059b0">
                  <input
                    value={optInput}
                    onChange={e => setOptInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOption(); } }}
                    placeholder="Type an option and press Enter"
                    className="flex-1"
                  />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={addOption}>Add</button>
                </div>
                <div className="u-8baf0a1">
                  {form.options.map(opt => (
                    <span key={opt} className="u-c65cc0a">
                      {opt}
                      <button type="button" onClick={() => removeOption(opt)} className="u-736a351">
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="form-group">
              <label className="u-c856e78">
                <input type="checkbox" checked={form.required} onChange={e => setForm(f => ({ ...f, required: e.target.checked }))} className="u-30e741d" />
                Required field
              </label>
            </div>
            <div className="modal-footer u-cc45258">
              <button type="button" className="btn btn-ghost" onClick={() => { setShowAdd(false); setEditing(null); }}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : (editing ? 'Save Changes' : 'Add Field')}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
