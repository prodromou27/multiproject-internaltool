import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoadError } from '../components/LoadError';
import { Link } from 'react-router-dom';
import { ArrowRight, BellRing, Building2, CalendarDays, CheckCircle2, Clock, ClipboardList, FolderOpen, Pause, Play, Plus, RotateCw, TimerReset, Wrench } from 'lucide-react';
import { HeaderMenu, PageHeader } from '../components/PageLayout';
import OperationalFocus from '../components/OperationalFocus';
import { localDateISO, businessNow } from '../utils/dates';
import { useStatuses } from '../hooks/useStatuses';
import { api } from '../api';
import { useAuth } from '../App';
import { fmtDate, isOverdue, PriorityBadge, StatusBadge } from '../components/Shared';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { useLiveRefresh } from '../live';
import AddToCalendarButton from '../components/AddToCalendarButton';
import { SubtaskProgress, SubtasksDialog } from '../components/TaskSubtasks';
import { MonthVisits, PendingVisitReports } from '../components/EngineerVisits';

const KANBAN = [
  ['open', 'To do'], ['in_progress', 'In progress'],
  ['waiting_customer', 'Waiting'], ['completed', 'Completed'],
];
const QUICK_NOTES = ['Started work', 'Progress update', 'Blocked — needs assistance', 'Ready for review'];
const iso = localDateISO;

function weekRange() {
  const now = businessNow();
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

// canLog: the Log activity button (left out where the page banner already has it);
// canOpenLog: the link to the Activity Log.
function ServiceActivityCard({ stats, customers=[], canLog=false, canOpenLog=canLog }) {
  if (!stats?.enabled && !customers.length) return null;

  return (
    <section className="card workflow-service-workspace">
      <div className="section-header"><h2 className="section-title">Customer operations</h2>{(canLog || canOpenLog) && <div className="flex gap-8">{canLog && <Link className="btn btn-primary btn-sm" to="/activity-log?create=1"><Plus size={13} /> Log activity</Link>}{canOpenLog && <Link className="btn btn-ghost btn-sm" to="/activity-log">Activity Log <ArrowRight size={13} /></Link>}</div>}</div>
      {/* One line of counts rather than four tiles. */}
      {stats?.enabled && <p className="workflow-service-stats"><span><strong>{stats.today}</strong> today</span><span><strong>{stats.week}</strong> this week</span><span><strong>{stats.hours}h</strong> logged</span><span className={stats.pending ? 'is-due' : ''}><strong>{stats.pending}</strong> follow-ups pending</span></p>}
      <div className="workflow-service-columns">
        <div><h3 className="hub-subheading">My managed customers</h3>{customers.slice(0,5).map(customer => <Link className="workflow-customer-row" key={customer.id} to={`/customers/${customer.id}/service-profile`}><Building2 size={14} /><span><strong>{customer.name}</strong><small>{customer.activities_this_month || 0} activities this month{customer.ticketing_enabled ? ` · ${customer.open_tickets || 0} open tickets` : ''}</small></span><ArrowRight size={13} /></Link>)}{!customers.length && <p className="text-muted text-sm">No managed customers are assigned to your teams.</p>}</div>
        <div><h3 className="hub-subheading">Follow-ups and recent work</h3>{(stats?.follow_ups || []).map(item => <Link className="my-day-row" key={`follow-${item.id}`} to={`/activity-log?activity=${item.id}`}><CheckCircle2 size={14} /><span>{item.title}</span><small>Due {fmtDate(item.follow_up_date)}</small></Link>)}{(stats?.recent || []).slice(0,5).map(item => <Link className="my-day-row" key={`recent-${item.id}`} to={`/activity-log?activity=${item.id}`}><ClipboardList size={14} /><span>{item.title}</span><small>{fmtDate(item.activity_date)}</small></Link>)}{!(stats?.follow_ups || []).length && !(stats?.recent || []).length && <p className="text-muted text-sm">No recent activity or due follow-ups.</p>}</div>
      </div>
    </section>
  );
}

export default function EngineerHub() {
  const { user, saAccess } = useAuth();
  const { config } = useStatuses();
  const toast = useToast();
  const confirm = useConfirm();
  const timerKey = `hub_engineer_timer_${user.id}`;
  const savingTimer = useRef(false);
  const [timerSaving, setTimerSaving] = useState(false);
  const today = iso(new Date());
  const month = today.slice(0, 7);
  const [tasks, setTasks] = useState([]);
  const [calendar, setCalendar] = useState({ visits: [], projects: [] });
  const [projects, setProjects] = useState([]);
  const [managedCustomers,setManagedCustomers]=useState([]);
  const [logs, setLogs] = useState([]);
  // Visit reports still to send, and this month's visits (they used to be on the engineers' dashboard).
  const [pendingReports, setPendingReports] = useState([]);
  const [monthVisits, setMonthVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dragged, setDragged] = useState(null);
  const [timer, setTimer] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(timerKey) || 'null');
      return saved && Number.isSafeInteger(saved.taskId) && saved.taskId > 0
        && typeof saved.title === 'string' && Number.isFinite(saved.startedAt) && saved.startedAt > 0
        && saved.startedAt <= Date.now() ? saved : null;
    } catch { return null; }
  });
  const [tick, setTick] = useState(Date.now());
  const [subtasksFor, setSubtasksFor] = useState(null);
  // Subtasks given to this person, on their tasks or colleagues' (routes/tasks.js /my-subtasks).
  const [mySubtasks, setMySubtasks] = useState([]);
  // A failed load is shown as such (with Retry), never as "nothing to do".
  const [subtasksError, setSubtasksError] = useState(''), [remindersError, setRemindersError] = useState('');
  const loadMySubtasks = useCallback(() => api.mySubtasks().then(rows => { setMySubtasks(rows); setSubtasksError(''); }).catch(failure => setSubtasksError(failure.message)), []);
  useEffect(() => { loadMySubtasks(); }, [loadMySubtasks]);
  async function tickSubtask(item) {
    try { await api.updateTaskSubtask(item.task_id, item.id, { done: true }); toast.success(`Done: ${item.title}`); loadMySubtasks(); load({ quiet: true }); }
    catch (error) { toast.error(error.message); }
  }
  const movingChecklists = useRef(false);
  // The next few of the person's reminders; the Reminders page has them all.
  const [reminders, setReminders] = useState([]);
  // Due team reminders come first: they stay open until someone in the team completes them.
  const loadReminders = useCallback(() => api.reminders().then(result => {
    const now = new Date().toISOString();
    const team = (result.team_reminders?.active || []).filter(item => item.due_at <= now).map(item => ({ ...item, team: true }));
    setReminders([...team, ...(result.active || [])]);
    setRemindersError('');
  }).catch(failure => setRemindersError(failure.message)), []);
  useEffect(() => { loadReminders(); }, [loadReminders]);
  useLiveRefresh(() => { loadReminders(); load({ quiet: true }); });
  const [recentProjects] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`hub_recent_projects_${user.id}`) || '[]'); } catch { return []; }
  });

  const [from, to] = useMemo(weekRange, []);
  const [overview, setOverview] = useState(null);
  const [overviewError, setOverviewError] = useState('');
  const [loadError, setLoadError] = useState('');
  const loadRequest = useRef(0);
  const workflowProfile=saAccess.capabilities?.profile || 'shared';
  const managedFocus=['managed_services','mixed'].includes(workflowProfile);
  const workflowCopy=workflowProfile==='mixed'
    ? { eyebrow:'Combined team workflow',title:'Balance customer operations and delivery work',description:'Service operations and delivery commitments are both prioritized from your team memberships.' }
    : workflowProfile==='managed_services'
      ? { eyebrow:'Managed Services focus',title:'Keep customer operations moving',description:'Log customer work, review recent activity and close follow-ups. Projects, tasks and visits remain available below.' }
      : workflowProfile==='project_delivery'
        ? { eyebrow:'Project Delivery focus',title:'Move assigned delivery work forward',description:'Start with deadlines, overdue work, project updates and visit reporting. Service activities remain available when authorized.' }
        : { eyebrow:'Shared workflow',title:'Move your assigned work forward',description:'Review your operational priorities, deadlines and assigned work across the shared workspace.' };
  const load = (loadOptions) => {
    const request = ++loadRequest.current;
    if (loadOptions?.quiet !== true) setLoading(true);
    setLoadError('');
    return Promise.allSettled([api.tasks(), api.calendar(month), api.projects(), api.myTimeLogs(from, to), api.operationsOverview({ as_of: today }),api.myManagedCustomers(),api.maintenanceVisits({ pending_report: 1 }),api.maintenanceVisits({ month, overview: 1 })])
      .then(results => {
        if (request !== loadRequest.current) return;
        const setters = [setTasks, setCalendar, setProjects, setLogs, setOverview, value => setManagedCustomers(value?.rows || []), value => setPendingReports(value || []), value => setMonthVisits(value || [])];
        results.forEach((result, index) => { if (result.status === 'fulfilled') setters[index](result.value); });
        setOverviewError(results[4].status === 'rejected' ? results[4].reason?.message || 'Unable to load work overview' : '');
        const failures = results.filter(result => result.status === 'rejected').map(result => result.reason?.message || 'Request failed');
        if (failures.length) setLoadError(`Some work could not be loaded: ${failures.join('; ')}`);
      }).finally(() => { if (request === loadRequest.current) setLoading(false); });
  };

  useEffect(() => { if (!saAccess.loaded) return undefined;load();return () => { loadRequest.current++; }; }, [saAccess.loaded,workflowProfile]);  
  useEffect(() => {
    if (!timer) return undefined;
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timer]);

  const terminalTasks = new Set(['completed', 'closed', 'cancelled', ...(config?.task || []).filter(status => status.is_terminal).map(status => status.value)]);
  const openTasks = tasks.filter(t => !terminalTasks.has(t.status));
  const weekAhead = iso(new Date(Date.now() + 7 * 86400000));
  const dueSoon = openTasks.filter(t => t.deadline && t.deadline.slice(0, 10) >= today && t.deadline.slice(0, 10) <= weekAhead).sort((a, b) => a.deadline.localeCompare(b.deadline));
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
    try { localStorage.setItem(timerKey, JSON.stringify(value)); }
    catch { toast.error('Could not save the timer in this browser'); return; }
    setTimer(value); setTick(Date.now());
  }

  function clearTimer() {
    setTimer(null);
    try { localStorage.removeItem(timerKey); } catch { /* The visible timer is already cleared. */ }
  }

  async function discardTimer() {
    if (savingTimer.current) return;
    if (await confirm('Discard this timer without logging time?', { title: 'Discard timer', label: 'Discard' })) clearTimer();
  }

  async function stopTimer() {
    if (!timer || savingTimer.current) return;
    const hours = Math.max(0.02, Math.round(((Date.now() - timer.startedAt) / 3600000) * 100) / 100);
    if (hours > 24) { toast.error('This timer exceeds 24 hours. Log the correct time from Tasks, then discard the timer.'); return; }
    savingTimer.current = true;
    setTimerSaving(true);
    try {
      await api.logTime({ task_id: timer.taskId, hours, description: 'Tracked from My Day timer' });
      clearTimer(); toast.success(`${hours}h logged`); load();
    } catch (error) { toast.error(error.message || 'Could not save time'); }
    finally { savingTimer.current = false; setTimerSaving(false); }
  }

  async function quickNote(task, note) {
    try {
      await api.addTaskComment(task.id, note);
      if (note === 'Started work' && task.status === 'open') await moveTask(task, 'in_progress');
      toast.success('Update added');
    } catch (error) { toast.error(error.message); }
  }

  // Checklists used to live only in this browser; they now are the task's subtasks,
  // which everyone working on it sees. Move any left here to their tasks, once.
  useEffect(() => {
    const key = `hub_checklists_${user.id}`;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch { saved = {}; }
    const pending = Object.entries(saved).filter(([id, items]) => Array.isArray(items) && items.length && tasks.some(task => String(task.id) === id));
    if (!pending.length || movingChecklists.current) return;
    movingChecklists.current = true;
    (async () => {
      for (const [id, items] of pending) {
        try {
          const { subtasks: list } = await api.addTaskSubtasks(id, { items: items.map(item => ({ title: String(item.title || '').slice(0, 300) || 'Checklist item' })) });
          const added = list.slice(-items.length);
          for (const [index, item] of items.entries()) if (item.done && added[index]) await api.updateTaskSubtask(id, added[index].id, { done: true });
          delete saved[id];
        } catch { /* left for the next visit */ }
      }
      try { if (Object.keys(saved).length) localStorage.setItem(key, JSON.stringify(saved)); else localStorage.removeItem(key); } catch { /* nothing more to do */ }
      movingChecklists.current = false;
      load({ quiet: true });
    })();
  }, [tasks, user.id]);

  async function completeReminder(reminder) {
    try {
      if (reminder.team) await api.completeTeamReminder(reminder.id); else await api.completeReminder(reminder.id);
      toast.success(reminder.team ? `Done for the ${reminder.team_name} team` : reminder.repeat === 'none' ? 'Reminder done' : 'Done — moved to the next time'); loadReminders();
    }
    catch (failure) { toast.error(failure.message); }
  }

  if (loading) return <div className="page"><div className="skeleton-table"><span /><span /><span /><span /></div></div>;

  return (
    <div className="page engineer-hub">
      <PageHeader title="My Work"
        actions={<HeaderMenu><button type="button" onClick={load}><RotateCw size={14} aria-hidden="true" /> Refresh</button></HeaderMenu>} />
      {loadError && <p className="error-msg" role="alert">{loadError}</p>}
      <section className={`workflow-banner is-${workflowProfile}`} title={workflowCopy.description}><p className="operations-eyebrow">{workflowCopy.eyebrow}</p><div className="workflow-banner-actions">{managedFocus && saAccess.enabled && <Link className="btn btn-primary" to="/activity-log?create=1"><ClipboardList size={15} /> Log activity</Link>}<Link className={managedFocus && saAccess.enabled?'btn btn-ghost':'btn btn-primary'} to="/tasks"><CheckCircle2 size={15} /> Open tasks</Link><Link className="btn btn-ghost" to="/projects"><FolderOpen size={15} /> My projects</Link></div></section>
      {managedFocus && <ServiceActivityCard stats={overview?.service} customers={managedCustomers} canOpenLog={saAccess.enabled} />}
      <OperationalFocus data={overview} error={overviewError} onRefresh={load} />

      {timer && <div className="active-timer"><Play size={15} /><div><strong>{timer.title}</strong><span>{formatElapsed(elapsed)}</span></div><button className="btn btn-danger btn-sm" disabled={timerSaving} onClick={stopTimer}><Pause size={12} /> {timerSaving ? 'Saving…' : 'Stop & log'}</button><button className="btn btn-ghost btn-sm" disabled={timerSaving} onClick={discardTimer}><TimerReset size={12} /> Discard</button></div>}

      <div className="grid-2 engineer-summary">
        <section className="card"><div className="section-header"><h2 className="section-title">Overdue and due this week</h2><CalendarDays size={16} /></div>
          {[...overdue, ...dueSoon.filter(t => !overdue.some(o => o.id === t.id))].map(task => <div className="my-day-row" key={task.id}><PriorityBadge p={task.priority} /><span className="my-day-title">{task.title}</span><small>{fmtDate(task.deadline)}</small>{!timer && <button className="btn btn-ghost btn-sm" aria-label={`Start timer: ${task.title}`} onClick={() => startTimer(task)}><Play size={11} /></button>}</div>)}
          {todayVisits.map(visit => <div className="my-day-row" key={`v${visit.id}`}><Wrench size={14} /><span>{visit.title}</span><small>{visit.customer_name}</small><AddToCalendarButton visitId={visit.id} title={visit.title} compact /></div>)}
          {!overdue.length && !dueSoon.length && !todayVisits.length && <p className="text-muted">Nothing due this week.</p>}
        </section>
        <section className="card"><div className="section-header"><h2 className="section-title">Timesheet</h2><Clock size={16} /></div><div className="timesheet-total"><strong>{weekTotal.toFixed(1)}h</strong><span>This week · {fmtDate(from)} – {fmtDate(to)}</span></div><p className={`timesheet-today${todayTotal < 7 ? ' is-short' : ''}`}><strong>{todayTotal.toFixed(1)}h</strong> logged today{todayTotal < 7 ? ` · ${Math.max(0, 7 - todayTotal).toFixed(1)}h still to log` : ''}</p>{logs.slice(0, 6).map(log => <div className="time-row" key={log.id}><span>{log.task_title || log.visit_title || 'Work log'}</span><strong>{Number(log.hours).toFixed(2)}h</strong></div>)}</section>
      </div>

      {/* Visit reports to send, then this month's visits; each shows only when there is something. */}
      {(pendingReports.length > 0 || monthVisits.length > 0) && <div className="mt-16">
        <PendingVisitReports reports={pendingReports} onSent={() => load({ quiet: true })} />
        <MonthVisits visits={monthVisits} />
      </div>}

      {subtasksFor && <SubtasksDialog task={subtasksFor} onClose={() => { setSubtasksFor(null); load({ quiet: true }); }} />}
      {(subtasksError || remindersError) && <div className="mt-16">{subtasksError && <LoadError compact what="Your subtasks" error={subtasksError} onRetry={loadMySubtasks} />}{remindersError && <LoadError compact what="Your reminders" error={remindersError} onRetry={loadReminders} />}</div>}
      {mySubtasks.length > 0 && <section className="card mt-16 hub-subtasks" aria-label="My subtasks"><div className="section-header"><h2 className="section-title">My subtasks</h2><span className="text-muted text-sm">{mySubtasks.length} open</span></div>
        <ul>{mySubtasks.map(item => <li key={item.id}>
          <input type="checkbox" aria-label={`Done: ${item.title}`} onChange={() => tickSubtask(item)} />
          <span><strong>{item.title}</strong><small>{item.task_title}{item.customer_name ? ` · ${item.customer_name}` : ''}</small></span>
          {item.due_date && <span className={`hub-subtask-due${item.due_date < today ? ' is-late' : ''}`}>{item.due_date < today ? 'Overdue · ' : 'Due '}{fmtDate(item.due_date)}</span>}
          {item.customer_id && <Link className="btn btn-ghost btn-sm" to={`/customers/${item.customer_id}/service-profile?section=tasks&task=${item.task_id}`}>Open task</Link>}
        </li>)}</ul>
      </section>}
      <section className="card mt-16"><div className="section-header"><h2 className="section-title">Personal Kanban</h2><Link to="/tasks">All tasks →</Link></div><div className="engineer-kanban">{KANBAN.map(([status, label]) => <div className="kanban-column" key={status} onDragOver={e => e.preventDefault()} onDrop={() => moveTask(dragged, status)}><h3>{label}<span>{tasks.filter(t => t.status === status).length}</span></h3>{tasks.filter(t => t.status === status).map(task => { return <article key={task.id} draggable onDragStart={() => setDragged(task)} className="kanban-card"><div className="kanban-card-title">{task.title}</div><div className="kanban-card-meta"><PriorityBadge p={task.priority} />{task.deadline && <span>{fmtDate(task.deadline)}</span>}</div>{task.subtasks_total > 0 && <div className="kanban-subtasks"><SubtaskProgress total={task.subtasks_total} done={task.subtasks_done} onClick={() => setSubtasksFor(task)} /></div>}<div className="kanban-actions"><button onClick={() => setSubtasksFor(task)} title="Subtasks" aria-label={`Subtasks of ${task.title}`}><Plus size={11} /></button>{!timer && <button onClick={() => startTimer(task)} title="Start timer"><TimerReset size={11} /></button>}<select defaultValue="" onChange={e => { if (e.target.value) quickNote(task, e.target.value); e.target.value = ''; }}><option value="">Quick update…</option>{QUICK_NOTES.map(note => <option key={note}>{note}</option>)}</select></div></article>; })}</div>)}</div></section>

      {!managedFocus && (saAccess?.enabled || managedCustomers.length > 0) && <ServiceActivityCard stats={overview?.service} customers={managedCustomers} canLog={saAccess.enabled} />}

      {/* Only what has something in it: reminders come from the Reminders page, bookmarks from Projects. */}
      {(reminders.length > 0 || pinned.length > 0 || recentProjects.length > 0) && <div className={`${reminders.length && (pinned.length || recentProjects.length) ? 'grid-2 ' : ''}mt-16`}>{reminders.length > 0 && <section className="card"><div className="section-header"><h2 className="section-title">Reminders</h2><Link className="btn btn-ghost btn-sm" to="/reminders"><Plus size={12} /> Add</Link></div>{reminders.slice(0, 5).map(reminder => <div className="reminder-row" key={`${reminder.team ? 't' : 'p'}${reminder.id}`}><BellRing size={13} /><span>{reminder.title}<small>{reminder.team ? `${reminder.team_name} team · due now` : new Date(reminder.due_at) <= new Date() ? 'Due now' : `Next ${fmtDate(reminder.due_at)}`}</small></span><button className="btn btn-success btn-sm" aria-label={`Done: ${reminder.title}`} onClick={() => completeReminder(reminder)}><CheckCircle2 size={11} /></button></div>)}{reminders.length > 5 && <Link to="/reminders" className="text-sm">All {reminders.length} reminders</Link>}</section>}{(pinned.length > 0 || recentProjects.length > 0) && <section className="card"><div className="section-header"><h2 className="section-title">Projects</h2><FolderOpen size={16} /></div>{pinned.length > 0 && <h3 className="hub-subheading">Bookmarked</h3>}{pinned.map(project => <Link className="bookmark-row" key={project.id} to={`/projects/${project.id}`}><span>{project.title}</span><StatusBadge entityType="project" s={project.status} /></Link>)}{recentProjects.length > 0 && <h3 className="hub-subheading">Recently viewed</h3>}{recentProjects.map(project => <Link className="bookmark-row" key={project.id} to={`/projects/${project.id}`}><span>{project.title}</span><StatusBadge entityType="project" s={project.status} /></Link>)}</section>}</div>}
    </div>
  );
}
