import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Pencil, ChevronDown, ChevronUp, Copy, FolderOpen, CheckSquare, X } from 'lucide-react';
import { api } from '../api';
import { Modal, PriorityBadge } from '../components/Shared';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';

const PRIORITY_OPTS = ['low', 'medium', 'high'];

/* ── Task row inside a template ──────────────────────────── */
function TemplateTaskRow({ task, tplId, onDelete, onUpdate }) {
  const toast    = useToast();
  const [editing, setEditing] = useState(false);
  const [form,    setForm]    = useState({ title: task.title, description: task.description || '', priority: task.priority });
  const [saving,  setSaving]  = useState(false);

  async function save() {
    setSaving(true);
    try { await api.updateTemplateTask(tplId, task.id, form); setEditing(false); onUpdate(); }
    catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  if (editing) return (
    <div style={{ padding: '8px 0', borderBottom: '1px solid var(--gray-100)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} style={{ flex: 2, minWidth: 140, fontSize: 13 }} placeholder="Task title" />
      <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} style={{ width: 100 }}>
        {PRIORITY_OPTS.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
      </select>
      <button className="btn btn-primary btn-sm" onClick={save} disabled={saving || !form.title.trim()}>Save</button>
      <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
    </div>
  );

  return (
    <div style={{ padding: '6px 0', borderBottom: '1px solid var(--gray-50)', display: 'flex', alignItems: 'center', gap: 8 }}>
      <CheckSquare size={13} color="var(--gray-400)" style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, fontSize: 13, color: 'var(--gray-800)' }}>{task.title}</span>
      <PriorityBadge p={task.priority} />
      <button className="btn btn-ghost btn-sm" style={{ padding: '2px 6px' }} onClick={() => setEditing(true)}><Pencil size={12} /></button>
      <button className="btn btn-ghost btn-sm" style={{ padding: '2px 6px', color: 'var(--danger)' }} onClick={() => onDelete(task.id)}><Trash2 size={12} /></button>
    </div>
  );
}

/* ── Template card ───────────────────────────────────────── */
function TemplateCard({ tpl, onDelete, onRefresh }) {
  const navigate = useNavigate();
  const toast    = useToast();
  const confirm  = useConfirm();
  const [expanded,  setExpanded]  = useState(false);
  const [detail,    setDetail]    = useState(null);
  const [adding,    setAdding]    = useState(false);
  const [newTask,   setNewTask]   = useState({ title: '', priority: 'medium' });
  const [saving,    setSaving]    = useState(false);
  const [editing,   setEditing]   = useState(false);
  const [editForm,  setEditForm]  = useState({ name: tpl.name, description: tpl.description || '' });
  const [applying,  setApplying]  = useState(false);

  const loadDetail = () => api.template(tpl.id).then(setDetail);

  useEffect(() => {
    if (expanded && !detail) loadDetail();
  }, [expanded]);

  async function addTask(e) {
    e.preventDefault();
    if (!newTask.title.trim()) return;
    setSaving(true);
    try { await api.addTemplateTask(tpl.id, newTask); setAdding(false); loadDetail(); }
    catch (e) { toast.error(e.message); }
    finally { setSaving(false); setNewTask({ title: '', priority: 'medium' }); }
  }

  async function deleteTask(tid) {
    const ok = await confirm('Remove this task from the template?', { title: 'Remove Task', label: 'Remove' });
    if (!ok) return;
    await api.deleteTemplateTask(tpl.id, tid);
    loadDetail();
  }

  async function saveEdit(e) {
    e.preventDefault();
    if (!editForm.name.trim()) return;
    await api.updateTemplate(tpl.id, editForm);
    setEditing(false);
    onRefresh();
  }

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {editing ? (
            <form onSubmit={saveEdit} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} required style={{ flex: 2, minWidth: 140 }} placeholder="Template name" />
              <input value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} style={{ flex: 3, minWidth: 180 }} placeholder="Description (optional)" />
              <button type="submit" className="btn btn-primary btn-sm">Save</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
            </form>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <FolderOpen size={15} color="var(--primary)" />
                <span style={{ fontWeight: 700, fontSize: 15 }}>{tpl.name}</span>
                <span className="badge badge-active" style={{ fontSize: 10 }}>{tpl.task_count} task{tpl.task_count !== 1 ? 's' : ''}</span>
              </div>
              {tpl.description && <p style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 2 }}>{tpl.description}</p>}
              <p style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 2 }}>Created by {tpl.created_by_name}</p>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
          <button className="btn btn-primary btn-sm" onClick={() => setApplying(true)} title="Use this template to create a project" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Copy size={12} /> Use
          </button>
          {!editing && <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)} title="Edit template"><Pencil size={12} /></button>}
          <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(e => !e)} title="Expand tasks" style={{ display: 'inline-flex', alignItems: 'center' }}>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => onDelete(tpl.id)} title="Delete template"><Trash2 size={12} /></button>
        </div>
      </div>

      {/* Expanded tasks */}
      {expanded && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--gray-100)' }}>
          {!detail
            ? <p className="text-muted text-sm">Loading…</p>
            : detail.tasks.length === 0 && !adding
              ? <p className="text-muted text-sm">No tasks yet — add some below</p>
              : detail.tasks.map(t => (
                  <TemplateTaskRow key={t.id} task={t} tplId={tpl.id} onDelete={deleteTask} onUpdate={loadDetail} />
                ))
          }

          {adding ? (
            <form onSubmit={addTask} style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input autoFocus value={newTask.title} onChange={e => setNewTask(f => ({ ...f, title: e.target.value }))} placeholder="Task title…" style={{ flex: 2, minWidth: 150, fontSize: 13 }} />
              <select value={newTask.priority} onChange={e => setNewTask(f => ({ ...f, priority: e.target.value }))} style={{ width: 100 }}>
                {PRIORITY_OPTS.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
              </select>
              <button type="submit" className="btn btn-primary btn-sm" disabled={saving || !newTask.title.trim()}>Add</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>Cancel</button>
            </form>
          ) : (
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 8, fontSize: 12 }} onClick={() => setAdding(true)}>
              <Plus size={12} /> Add Task
            </button>
          )}
        </div>
      )}

      {/* Apply modal */}
      {applying && (
        <ApplyTemplateModal tpl={tpl} onClose={() => setApplying(false)} onCreated={id => navigate(`/projects/${id}`)} />
      )}
    </div>
  );
}

/* ── Apply Template Modal ────────────────────────────────── */
function ApplyTemplateModal({ tpl, onClose, onCreated }) {
  const toast = useToast();
  const [users,     setUsers]     = useState([]);
  const [customers, setCustomers] = useState([]);
  const [form, setForm] = useState({ title: tpl.name, description: tpl.description || '', priority: 'medium', deadline: '', customer_id: '', member_ids: [] });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([api.users(), api.customers()]).then(([u, c]) => { setUsers(u); setCustomers(c); });
  }, []);

  const engineers = users.filter(u => u.role === 'engineer');
  const toggleMember = id => setForm(f => ({
    ...f,
    member_ids: f.member_ids.includes(id) ? f.member_ids.filter(x => x !== id) : [...f.member_ids, id],
  }));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.applyTemplate(tpl.id, { ...form, customer_id: form.customer_id ? Number(form.customer_id) : null });
      onCreated(res.id);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Create project from "${tpl.name}"`} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-group"><label>Project Title *</label><input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required /></div>
        <div className="form-group"><label>Description</label><textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} /></div>
        <div className="form-row">
          <div className="form-group">
            <label>Priority</label>
            <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
              {PRIORITY_OPTS.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
            </select>
          </div>
          <div className="form-group"><label>Deadline</label><input type="date" value={form.deadline} onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} /></div>
        </div>
        <div className="form-group">
          <label>Customer</label>
          <select value={form.customer_id} onChange={e => setForm(f => ({ ...f, customer_id: e.target.value }))}>
            <option value="">— No customer —</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Assign Engineers</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            {engineers.map(u => (
              <label key={u.id} style={{
                display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', padding: '4px 8px',
                background: form.member_ids.includes(u.id) ? '#dbeafe' : 'var(--gray-100)', borderRadius: 6, fontSize: 12,
                border: form.member_ids.includes(u.id) ? '1px solid #93c5fd' : '1px solid transparent',
              }}>
                <input type="checkbox" checked={form.member_ids.includes(u.id)} onChange={() => toggleMember(u.id)} style={{ width: 'auto' }} />
                {u.name}
              </label>
            ))}
          </div>
        </div>
        <div className="modal-footer" style={{ padding: '12px 0 0', border: 'none' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Creating…' : `Create Project (${tpl.task_count} tasks)`}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Main page ───────────────────────────────────────────── */
export default function Templates() {
  const toast   = useToast();
  const confirm = useConfirm();
  const [templates, setTemplates] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [showNew,   setShowNew]   = useState(false);
  const [newForm,   setNewForm]   = useState({ name: '', description: '' });
  const [saving,    setSaving]    = useState(false);

  const load = () => api.templates().then(d => { setTemplates(d); setLoading(false); });
  useEffect(() => { load(); }, []);

  async function createTemplate(e) {
    e.preventDefault();
    if (!newForm.name.trim()) return;
    setSaving(true);
    try {
      await api.createTemplate(newForm);
      toast.success('Template created');
      setNewForm({ name: '', description: '' });
      setShowNew(false);
      load();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  }

  async function deleteTemplate(id) {
    const ok = await confirm('Delete this template? This cannot be undone.', { title: 'Delete Template' });
    if (!ok) return;
    try { await api.deleteTemplate(id); toast.success('Template deleted'); load(); } catch (e) { toast.error(e.message); }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Project Templates</h1>
          <div className="page-subtitle">Reusable project structures with pre-defined tasks</div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>+ New Template</button>
      </div>

      {loading ? <p className="text-muted">Loading…</p> : templates.length === 0 && !showNew ? (
        <div className="empty">
          <div className="empty-icon"><FolderOpen size={40} strokeWidth={1.2} /></div>
          <p>No templates yet</p>
          <p className="text-sm text-muted">Create templates to quickly spin up projects with a standard set of tasks.</p>
        </div>
      ) : (
        templates.map(tpl => (
          <TemplateCard key={tpl.id} tpl={tpl} onDelete={deleteTemplate} onRefresh={load} />
        ))
      )}

      {showNew && (
        <Modal title="New Template" onClose={() => setShowNew(false)}>
          <form onSubmit={createTemplate}>
            <div className="form-group"><label>Template Name *</label><input autoFocus value={newForm.name} onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))} required placeholder="e.g. Quarterly Site Visit" /></div>
            <div className="form-group"><label>Description</label><textarea value={newForm.description} onChange={e => setNewForm(f => ({ ...f, description: e.target.value }))} rows={2} placeholder="What is this template for?" /></div>
            <div className="modal-footer" style={{ padding: '12px 0 0', border: 'none' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setShowNew(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create Template'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
