import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  StickyNote, CheckSquare, Plus, Trash2, Save, RefreshCw,
} from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../App';
import { useConfirm } from '../components/Confirm';

const AUTOSAVE_MS = 1500; // debounce

export default function Notes() {
  const { user }  = useAuth();
  const confirm   = useConfirm();

  /* ── Scratchpad ──────────────────────────────────────────── */
  const [noteContent,  setNoteContent]  = useState('');
  const [noteSaved,    setNoteSaved]    = useState(true);
  const [noteUpdated,  setNoteUpdated]  = useState('');
  const [noteLoading,  setNoteLoading]  = useState(true);
  const autoSaveTimer = useRef(null);

  const loadNote = useCallback(() => {
    api.getNote().then(d => {
      setNoteContent(d.content || '');
      setNoteUpdated(d.updated_at || '');
      setNoteLoading(false);
      setNoteSaved(true);
    }).catch(() => setNoteLoading(false));
  }, []);

  useEffect(() => { loadNote(); }, [loadNote]);

  function handleNoteChange(val) {
    setNoteContent(val);
    setNoteSaved(false);
    clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      await api.saveNote(val).catch(() => {});
      setNoteSaved(true);
      setNoteUpdated(new Date().toISOString());
    }, AUTOSAVE_MS);
  }

  async function saveNoteNow() {
    clearTimeout(autoSaveTimer.current);
    await api.saveNote(noteContent).catch(() => {});
    setNoteSaved(true);
    setNoteUpdated(new Date().toISOString());
  }

  /* ── Todos ───────────────────────────────────────────────── */
  const [todos,      setTodos]      = useState([]);
  const [newTitle,   setNewTitle]   = useState('');
  const [adding,     setAdding]     = useState(false);
  const [todosLoading, setTodosLoading] = useState(true);

  const loadTodos = useCallback(() => {
    api.getTodos().then(d => { setTodos(d ?? []); setTodosLoading(false); }).catch(() => setTodosLoading(false));
  }, []);

  useEffect(() => { loadTodos(); }, [loadTodos]);

  async function addTodo(e) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setAdding(true);
    await api.createTodo(newTitle.trim()).catch(() => {});
    setNewTitle('');
    setAdding(false);
    loadTodos();
  }

  async function toggleTodo(todo) {
    await api.updateTodo(todo.id, { done: !todo.done }).catch(() => {});
    setTodos(prev => prev.map(t => t.id === todo.id ? { ...t, done: todo.done ? 0 : 1 } : t));
  }

  async function deleteTodo(id) {
    await api.deleteTodo(id).catch(() => {});
    setTodos(prev => prev.filter(t => t.id !== id));
  }

  async function clearDone() {
    const ok = await confirm('Clear all completed items?', { title: 'Clear Completed', label: 'Clear', danger: false });
    if (!ok) return;
    await api.clearDoneTodos().catch(() => {});
    loadTodos();
    // No toast needed — the visual change is instant
  }

  const openTodos = todos.filter(t => !t.done);
  const doneTodos = todos.filter(t => t.done);

  function fmtUpdated(dt) {
    if (!dt) return '';
    const d = new Date(dt);
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <StickyNote size={20} /> My Notes
          </h1>
          <div className="page-subtitle">Private scratchpad and to-do list — only visible to you</div>
        </div>
      </div>

      <div className="grid-2" style={{ gap: 20, alignItems: 'start' }}>

        {/* ── Left: Scratchpad ─────────────────────────────── */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <StickyNote size={15} color="var(--warning)" />
              <span style={{ fontWeight: 700, fontSize: 14 }}>Scratchpad</span>
            </div>
            <div style={{ display: 'flex', align: 'center', gap: 8 }}>
              {noteUpdated && (
                <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>
                  Saved {fmtUpdated(noteUpdated)}
                </span>
              )}
              {!noteSaved && (
                <span style={{ fontSize: 11, color: 'var(--warning)', fontWeight: 600 }}>Unsaved…</span>
              )}
              <button
                className="btn btn-ghost btn-sm"
                onClick={saveNoteNow}
                disabled={noteSaved}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}
              >
                <Save size={12} /> Save
              </button>
            </div>
          </div>

          {noteLoading ? (
            <p className="text-muted text-sm">Loading…</p>
          ) : (
            <textarea
              value={noteContent}
              onChange={e => handleNoteChange(e.target.value)}
              placeholder={`Jot down anything, ${user.name.split(' ')[0]}…\n\nIdeas, reminders, links, quick calculations — this is your private space.`}
              style={{
                width: '100%', minHeight: 340, resize: 'vertical',
                fontSize: 13, lineHeight: 1.65,
                fontFamily: 'ui-monospace, "Cascadia Code", "Fira Code", monospace',
                background: '#fffbf0', border: '1px solid #fde68a',
                borderRadius: 8, padding: '12px 14px',
                color: 'var(--gray-800)',
              }}
            />
          )}
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--gray-400)' }}>
            {noteContent.length} chars · Auto-saves as you type
          </div>
        </div>

        {/* ── Right: Todos ─────────────────────────────────── */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckSquare size={15} color="var(--primary)" />
              <span style={{ fontWeight: 700, fontSize: 14 }}>To-Do List</span>
              {openTodos.length > 0 && (
                <span style={{ background: 'var(--primary)', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 10, padding: '1px 7px' }}>
                  {openTodos.length}
                </span>
              )}
            </div>
            {doneTodos.length > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={clearDone} style={{ fontSize: 11, color: 'var(--gray-400)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Trash2 size={11} /> Clear done ({doneTodos.length})
              </button>
            )}
          </div>

          {/* Add new */}
          <form onSubmit={addTodo} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder="Add a to-do item…"
              style={{ flex: 1, fontSize: 13 }}
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={adding || !newTitle.trim()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Plus size={13} /> Add
            </button>
          </form>

          {todosLoading ? <p className="text-muted text-sm">Loading…</p> : todos.length === 0 ? (
            <p className="text-muted text-sm">No to-dos yet — add one above!</p>
          ) : (
            <ul style={{ listStyle: 'none' }}>
              {/* Open todos first */}
              {openTodos.map(t => (
                <TodoItem key={t.id} todo={t} onToggle={toggleTodo} onDelete={deleteTodo} />
              ))}

              {/* Done section */}
              {doneTodos.length > 0 && (
                <>
                  <li style={{ padding: '8px 0 4px', fontSize: 11, color: 'var(--gray-400)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                    Done
                  </li>
                  {doneTodos.map(t => (
                    <TodoItem key={t.id} todo={t} onToggle={toggleTodo} onDelete={deleteTodo} />
                  ))}
                </>
              )}
            </ul>
          )}
        </div>

      </div>
    </div>
  );
}

function TodoItem({ todo, onToggle, onDelete }) {
  return (
    <li style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '7px 0', borderBottom: '1px solid var(--gray-50)',
    }}>
      <input
        type="checkbox"
        checked={!!todo.done}
        onChange={() => onToggle(todo)}
        style={{ flexShrink: 0, cursor: 'pointer', width: 16, height: 16 }}
      />
      <span style={{
        flex: 1, fontSize: 13,
        color: todo.done ? 'var(--gray-400)' : 'var(--gray-800)',
        textDecoration: todo.done ? 'line-through' : 'none',
      }}>
        {todo.title}
      </span>
      <button
        onClick={() => onDelete(todo.id)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-300)', padding: '1px 3px', display: 'flex', alignItems: 'center' }}
        onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--gray-300)'}
      >
        <Trash2 size={12} />
      </button>
    </li>
  );
}
