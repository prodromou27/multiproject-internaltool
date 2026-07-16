import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, CheckCircle2, Clock, FolderOpen, Pause, Play, Plus, RotateCw, TimerReset, Wrench } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../App';
import { fmtDate, isOverdue, PriorityBadge, StatusBadge } from '../components/Shared';
import { useToast } from '../components/Toast';

const KANBAN = [
  ['open', 'To do'], ['in_progress', 'In progress'],
  ['waiting_customer', 'Waiting'], ['completed', 'Completed'],
];
const QUICK_NOTES = ['Started work', 'Progress update', 'Blocked — needs assistance', 'Ready for review'];
const iso = d => d.toISOString().slice(0, 10);

function weekRange() {
  const now = new Date();
  const day = (now.getDay() + 6) % 7;
  const start = new Date(now); start.setDate(now.getDate() - day);
  const end = new Date(start); end.setDate(start.getDate() + 6);
  return [iso(start), iso(end)];
}

function formatElapsed(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

export default function EngineerHub() {
  const { user } = useAuth();
  const toast = useToast();
  const today = iso(new Date());
  const month = today.slice(0, 7);
  const [tasks, setTasks] = useState([]);
  const [calendar, setCalendar] = useState({ visits: [], projects: [] });
  const [projects, setProjects] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dragged, setDragged] = useState(null);
  const [timer, setTimer] = useState(() => {
    try { return JSON.parse(localStorage.getItem('hub_engineer_timer') || 'null'); } catch { return null; }
  });
  const [tick, setTick] = useState(Date.now());
  const [checklists, setChecklists] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`hub_checklists_${user.id}`) || '{}'); } catch { return {}; }
  });
  const [reminders, setReminders] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`hub_recurring_${user.id}`) || '[]'); } catch { return []; }
  });
  const [recentProjects] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`hub_recent_projects_${user.id}`) || '[]'); } catch { return []; }
  });

  const [from, to] = useMemo(weekRange, []);
  const load = () => Promise.all([api.tasks(), api.calendar(month), api.projects(), api.myTimeLogs(from, to)])
    .then(([taskRows, calendarRows, projectRows, logRows]) => {
      setTasks(taskRows); setCalendar(calendarRows); setProjects(projectRows); setLogs(logRows); setLoading(false);
    }).catch(error => { toast.error(error.message || 'Could not load My Day'); setLoading(false); });

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!timer) return undefined;
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timer]);

  const openTasks = tasks.filter(t => !['completed', 'closed', 'cancelled'].includes(t.status));
  const todayTasks = openTasks.filter(t => t.deadline?.slice(0, 10) === today);
  const overdue = openTasks.filter(t => isOverdue(t.deadline));
  const todayVisits = (calendar.visits || []).filter(v => v.date?.slice(0, 10) === today);
  const pinned = projects.filter(p => p.is_pinned);
  const weekTotal = logs.reduce((sum, log) => sum + Number(log.hours || 0), 0);
  const todayTotal = logs.filter(log => log.logged_at?.slice(0, 10) === today).reduce((sum, log) => sum + Number(log.hours || 0), 0);
  const elapsed = timer ? Math.max(0, Math.floor((tick - timer.startedAt) / 1000)) : 0;

  async function moveTask(task, status) {
    if (!task || task.status === status) return;
    if (status === 'waiting_customer') {
      toast.error('Use the Tasks page to add the required waiting reason');
      return;
    }
    const old = task.status;
    setTasks(rows => rows.map(row => row.id === task.id ? { ...row, status } : row));
    try { await api.updateTask(task.id, { status }); toast.success('Task moved'); }
    catch (error) { setTasks(rows => rows.map(row => row.id === task.id ? { ...row, status: old } : row)); toast.error(error.message); }
  }

  function startTimer(task) {
    const value = { taskId: task.id, title: task.title, startedAt: Date.now() };
    localStorage.setItem('hub_engineer_timer', JSON.stringify(value)); setTimer(value); setTick(Date.now());
  }

  async function stopTimer() {
    if (!timer) return;
    const hours = Math.max(0.02, Math.round(((Date.now() - timer.startedAt) / 3600000) * 100) / 100);
    try {
      await api.logTime({ task_id: timer.taskId, hours, description: 'Tracked from My Day timer' });
      localStorage.removeItem('hub_engineer_timer'); setTimer(null); toast.success(`${hours}h logged`); load();
    } catch (error) { toast.error(error.message || 'Could not save time'); }
  }

  async function quickNote(task, note) {
    try {
      await api.addTaskComment(task.id, note);
      if (note === 'Started work' && task.status === 'open') await moveTask(task, 'in_progress');
      toast.success('Update added');
    } catch (error) { toast.error(error.message); }
  }

  function addChecklistItem(task) {
    const title = window.prompt('Checklist item')?.trim();
    if (!title) return;
    const next = { ...checklists, [task.id]: [...(checklists[task.id] || []), { id: Date.now(), title, done: false }] };
    setChecklists(next); localStorage.setItem(`hub_checklists_${user.id}`, JSON.stringify(next));
  }

  function toggleChecklist(taskId, itemId) {
    const next = { ...checklists, [taskId]: (checklists[taskId] || []).map(item => item.id === itemId ? { ...item, done: !item.done } : item) };
    setChecklists(next); localStorage.setItem(`hub_checklists_${user.id}`, JSON.stringify(next));
  }

  function addReminder() {
    const title = window.prompt('Reminder')?.trim();
    if (!title) return;
    const cadence = window.prompt('Repeat: daily, weekly, or monthly', 'weekly')?.toLowerCase();
    if (!['daily', 'weekly', 'monthly'].includes(cadence)) return toast.error('Use daily, weekly, or monthly');
    const next = [...reminders, { id: Date.now(), title, cadence, next: today }];
    setReminders(next); localStorage.setItem(`hub_recurring_${user.id}`, JSON.stringify(next));
  }

  function completeReminder(reminder) {
    const nextDate = new Date(`${reminder.next}T12:00:00`);
    if (reminder.cadence === 'daily') nextDate.setDate(nextDate.getDate() + 1);
    if (reminder.cadence === 'weekly') nextDate.setDate(nextDate.getDate() + 7);
    if (reminder.cadence === 'monthly') nextDate.setMonth(nextDate.getMonth() + 1);
    const next = reminders.map(item => item.id === reminder.id ? { ...item, next: iso(nextDate) } : item);
    setReminders(next); localStorage.setItem(`hub_recurring_${user.id}`, JSON.stringify(next));
  }

  if (loading) return <div className="page"><div className="skeleton-table"><span /><span /><span /><span /></div></div>;

  return (
    <div className="page engineer-hub">
      <div className="page-header"><div><h1 className="page-title">My Day</h1><p className="page-subtitle">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p></div></div>

      <div className="grid-4" style={{ marginBottom: 16 }}>
        <div className="stat-card"><strong>{todayTasks.length}</strong><span>Due today</span></div>
        <div className="stat-card"><strong className={overdue.length ? 'overdue' : ''}>{overdue.length}</strong><span>Overdue</span></div>
        <div className="stat-card"><strong>{todayVisits.length}</strong><span>Visits today</span></div>
        <div className="stat-card"><strong>{todayTotal.toFixed(1)}h</strong><span>Logged today</span></div>
      </div>

      {timer && <div className="active-timer"><Play size={15} /><div><strong>{timer.title}</strong><span>{formatElapsed(elapsed)}</span></div><button className="btn btn-danger btn-sm" onClick={stopTimer}><Pause size={12} /> Stop & log</button></div>}

      <div className="grid-2 engineer-summary">
        <section className="card"><div className="section-header"><h2 className="section-title">Today & overdue</h2><CalendarDays size={16} /></div>
          {[...overdue, ...todayTasks.filter(t => !overdue.some(o => o.id === t.id))].map(task => <div className="my-day-row" key={task.id}><PriorityBadge p={task.priority} /><span>{task.title}</span><small>{fmtDate(task.deadline)}</small>{!timer && <button className="btn btn-ghost btn-sm" onClick={() => startTimer(task)}><Play size={11} /></button>}</div>)}
          {todayVisits.map(visit => <div className="my-day-row" key={`v${visit.id}`}><Wrench size={14} /><span>{visit.title}</span><small>{visit.customer_name}</small></div>)}
          {!overdue.length && !todayTasks.length && !todayVisits.length && <p className="text-muted">Nothing urgent today.</p>}
        </section>
        <section className="card"><div className="section-header"><h2 className="section-title">Timesheet</h2><Clock size={16} /></div><div className="timesheet-total"><strong>{weekTotal.toFixed(1)}h</strong><span>This week · {from} to {to}</span></div>{todayTotal < 7 && <div className="alert alert-warning">Missing-time reminder: {Math.max(0, 7 - todayTotal).toFixed(1)}h remaining for today.</div>}{logs.slice(0, 6).map(log => <div className="time-row" key={log.id}><span>{log.task_title || log.visit_title || 'Work log'}</span><strong>{Number(log.hours).toFixed(2)}h</strong></div>)}</section>
      </div>

      <section className="card" style={{ marginTop: 16 }}><div className="section-header"><h2 className="section-title">Personal Kanban</h2><Link to="/tasks">All tasks →</Link></div><div className="engineer-kanban">{KANBAN.map(([status, label]) => <div className="kanban-column" key={status} onDragOver={e => e.preventDefault()} onDrop={() => moveTask(dragged, status)}><h3>{label}<span>{tasks.filter(t => t.status === status).length}</span></h3>{tasks.filter(t => t.status === status).map(task => { const list = checklists[task.id] || []; const done = list.filter(i => i.done).length; return <article key={task.id} draggable onDragStart={() => setDragged(task)} className="kanban-card"><div className="kanban-card-title">{task.title}</div><div className="kanban-card-meta"><PriorityBadge p={task.priority} />{task.deadline && <span>{fmtDate(task.deadline)}</span>}</div>{list.map(item => <label className="checklist-item" key={item.id}><input type="checkbox" checked={item.done} onChange={() => toggleChecklist(task.id, item.id)} />{item.title}</label>)}{list.length > 0 && <div className="checklist-progress"><span style={{ width: `${done / list.length * 100}%` }} /></div>}<div className="kanban-actions"><button onClick={() => addChecklistItem(task)} title="Add checklist item"><Plus size={11} /></button>{!timer && <button onClick={() => startTimer(task)} title="Start timer"><TimerReset size={11} /></button>}<select defaultValue="" onChange={e => { if (e.target.value) quickNote(task, e.target.value); e.target.value = ''; }}><option value="">Quick update…</option>{QUICK_NOTES.map(note => <option key={note}>{note}</option>)}</select></div></article>; })}</div>)}</div></section>

      <div className="grid-2" style={{ marginTop: 16 }}><section className="card"><div className="section-header"><h2 className="section-title">Recurring reminders</h2><button className="btn btn-ghost btn-sm" onClick={addReminder}><Plus size={12} /> Add</button></div>{reminders.map(reminder => <div className="reminder-row" key={reminder.id}><RotateCw size={13} /><span>{reminder.title}<small>{reminder.cadence} · next {fmtDate(reminder.next)}</small></span><button className="btn btn-success btn-sm" onClick={() => completeReminder(reminder)}><CheckCircle2 size={11} /></button></div>)}{!reminders.length && <p className="text-muted">No recurring reminders.</p>}</section><section className="card"><div className="section-header"><h2 className="section-title">Projects</h2><FolderOpen size={16} /></div><h3 className="hub-subheading">Bookmarked</h3>{pinned.map(project => <Link className="bookmark-row" key={project.id} to={`/projects/${project.id}`}><span>{project.title}</span><StatusBadge s={project.status} /></Link>)}{!pinned.length && <p className="text-muted">Pin projects from the Projects page.</p>}<h3 className="hub-subheading">Recently viewed</h3>{recentProjects.map(project => <Link className="bookmark-row" key={project.id} to={`/projects/${project.id}`}><span>{project.title}</span><StatusBadge s={project.status} /></Link>)}</section></div>
    </div>
  );
}
