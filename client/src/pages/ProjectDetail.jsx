import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Building2, ChevronLeft, MessageSquare, ClipboardList, Plus, RefreshCw, Trash2, FolderOpen, GitBranch, FileText, UserPlus, UserX, Lock, CheckCircle2, X, Upload, LayoutGrid, List as ListIcon, Printer } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageState } from '../components/PageLayout';
import { useLatestRequest } from '../hooks/useLatestRequest';
import { api } from '../api';
import { useAuth } from '../App';
import { StatusBadge, PriorityBadge, RagBadge, fmtDate, fmtRelative, isOverdue, Modal, MentionInput, renderMentions } from '../components/Shared';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { AttachmentsSection, KpiSection } from './project/AttachmentsKpi';
import { RejectDialog, ImportExcelModal } from './project/Dialogs';
import { TaskDetailModal, TaskRow, KanbanView } from './project/TaskViews';
import { GanttTab, MilestonesTab } from './project/GanttMilestones';
import { ScorecardTab } from './project/ScorecardTab';
import { ProjectPrintView } from './project/ProjectPrintView';
import { CustomFieldsTab } from './project/CustomFieldsTab';

export default function ProjectDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate  = useNavigate();
  const toast     = useToast();
  const confirm   = useConfirm();
  const isManager  = user.role === 'manager';
  const isPlanner  = user.role === 'planner';
  const isEngineer = user.role === 'engineer';
  const isPM       = user.role === 'pm';
  const canManage  = isManager || isPlanner;
  const [project,    setProject]    = useState(null);
  const [tasks,      setTasks]      = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [allUsers,   setAllUsers]   = useState([]);
  const [customers,  setCustomers]  = useState([]);
  const [activity,   setActivity]   = useState([]);
  const [tab, setTab] = useState(isPM ? 'milestones' : 'tasks');
  const [statusMsg, setStatusMsg] = useState('');
  const [showEdit,         setShowEdit]         = useState(false);
  const [showAddTask,      setShowAddTask]      = useState(false);
  const [addTaskErr,       setAddTaskErr]       = useState('');
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [showImportExcel,  setShowImportExcel]  = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [taskViewMode, setTaskViewMode] = useState('list'); // 'list' | 'kanban'
  const [taskSearch,   setTaskSearch]   = useState('');
  const [taskForm, setTaskForm] = useState({ title: '', description: '', priority: 'medium', deadline: '', assigned_to: '', is_adhoc: false });
  const [editForm, setEditForm] = useState({});

  const { begin, isCurrent } = useLatestRequest(`${id}:${user.role}`);
  const [loadError, setLoadError] = useState(null);
  const load = useCallback(() => {
    const request = begin();
    if (request.signal.aborted) return Promise.resolve();
    setLoadError(null);
    const options = { signal: request.signal };
    return Promise.all([
      api.project(id, options),
      isPM ? Promise.resolve([]) : api.tasks({ project_id: id }, options),
      isManager ? api.users(options) : Promise.resolve([]),
      isManager ? api.customers(options) : Promise.resolve([]),
      api.projectActivity(id, options),
      api.milestones(id, options),
    ]).then(([p, t, u, c, act, ms]) => {
      if (!isCurrent(request)) return;
      setProject(p);
    if (isEngineer) {
      try {
        const recent = JSON.parse(localStorage.getItem(`hub_recent_projects_${user.id}`) || '[]');
        localStorage.setItem(`hub_recent_projects_${user.id}`, JSON.stringify([
          { id: p.id, title: p.title, status: p.status, viewedAt: Date.now() },
          ...recent.filter(item => item.id !== p.id),
        ].slice(0, 6)));
      } catch {}
    }
      setTasks(t); setAllUsers(u); setCustomers(c); setActivity(act ?? []); setMilestones(ms);
    }).catch(error => {
      if (!isCurrent(request)) return;
      setLoadError({ message: error.message || 'Could not load project', status: error.status, projectId: id });
      if ([401, 403, 404].includes(error.status)) {
        setProject(null); setTasks([]); setActivity([]); setMilestones([]);
      }
    });
  }, [id, isManager, isPM, isEngineer, user.id, begin, isCurrent]);
  const loadMilestones = load;
  useEffect(() => {
    setProject(null); setTasks([]); setMilestones([]); setActivity([]);
    setSelectedTask(null); setShowEdit(false); setShowAddTask(false); setShowRejectDialog(false); setShowImportExcel(false);
    setStatusMsg(''); setTaskSearch('');
    load();
  }, [load]);

  const currentError = loadError?.projectId === id ? loadError : null;
  if (!project || project.id !== Number(id)) {
    if (currentError) return <PageState title={currentError.status === 403 ? 'Project access denied' : currentError.status === 404 ? 'Project not found' : 'Project unavailable'} description={currentError.message}>
      <button className="btn btn-primary" onClick={load}>Retry</button>
      <Link className="btn btn-ghost" to="/projects">Back to projects</Link>
    </PageState>;
    return <div className="page"><p className="text-muted" role="status">Loading project...</p></div>;
  }

  const setT = k => e => setTaskForm(f => ({ ...f, [k]: e.target.value }));
  const setE = k => e => setEditForm(f => ({ ...f, [k]: e.target.value }));

  async function submitStatusUpdate(e) {
    e.preventDefault();
    if (!statusMsg.trim()) return;
    try {
      await api.addStatusUpdate(id, statusMsg);
      toast.success('Status update posted');
      setStatusMsg('');
      load();
    } catch (err) { toast.error(err.message); }
  }

  async function requestClosure() {
    const ok = await confirm('Request closure for this project? It will go to the manager for approval.', { title: 'Request Closure', label: 'Request', danger: false });
    if (!ok) return;
    try { await api.requestClosure(id); toast.success('Closure requested — pending manager approval'); load(); } catch (e) { toast.error(e.message); }
  }

  async function approveClosure() {
    const ok = await confirm('Approve closure for this project? This will mark it as closed.', { title: 'Approve Closure', label: 'Approve', danger: false });
    if (!ok) return;
    try { await api.approveClosure(id, { request_version: project.closure_request_version }); toast.success('Project closed successfully'); load(); } catch (e) { toast.error(e.message); }
  }

  async function rejectClosure(note) {
    await api.rejectClosure(id, { comment: note, request_version: project.closure_request_version });
    toast.success('Project returned for revision');
    setShowRejectDialog(false); load();
  }

  async function reopenProject() {
    const ok = await confirm('Reopen this project?', { title: 'Reopen Project', label: 'Reopen', danger: false });
    if (!ok) return;
    try {
      await api.updateProject(id, { status: 'reopened' });
      await api.addStatusUpdate(id, `Project reopened by ${user.name}.`);
      toast.success('Project reopened');
      load();
    } catch (e) { toast.error(e.message); }
  }

  async function saveEdit(e) {
    e.preventDefault();
    try {
      await api.updateProject(id, editForm);
      toast.success('Project updated');
      setShowEdit(false); load();
    } catch (err) { toast.error(err.message); }
  }

  async function addTask(e) {
    e.preventDefault();
    setAddTaskErr('');
    try {
      await api.createTask({ ...taskForm, project_id: Number(id) });
      toast.success('Task created');
      setShowAddTask(false);
      setAddTaskErr('');
      setTaskForm({ title: '', description: '', priority: 'medium', deadline: '', assigned_to: '', is_adhoc: false });
      load();
    } catch (err) {
      setAddTaskErr(err.message || 'Failed to create task');
    }
  }

  async function updateTask(tid, data) {
    try {
      await api.updateTask(tid, data);
    } catch (err) {
      toast.error(err.message || 'Failed to update task');
    } finally {
      load(); // always refresh so Kanban reverts on failure
    }
  }

  async function duplicateTask(tid) {
    await api.duplicateTask(tid).then(() => toast.success('Task duplicated')).catch(e => toast.error(e.message));
    load();
  }

  const engineers = allUsers.filter(u => u.role === 'engineer');
  const addableUsers = engineers;
  const taskCount = tasks.filter(t => t.status !== 'cancelled').length;
  const doneCount = tasks.filter(t => t.status === 'completed' || t.status === 'closed').length;
  const filteredTasks = taskSearch.trim()
    ? tasks.filter(t => {
        const q = taskSearch.toLowerCase();
        return (t.title || '').toLowerCase().includes(q) ||
               (t.assigned_to_name || '').toLowerCase().includes(q) ||
               (t.status || '').toLowerCase().includes(q);
      })
    : tasks;

  return (
    <div className="page">
      {currentError && <div className="error-msg" role="alert">
        Could not refresh this project: {currentError.message} <button className="btn btn-ghost btn-sm" onClick={load}>Retry</button>
      </div>}
      {/* Print-only view — hidden on screen, shown when printing */}
      <ProjectPrintView project={project} tasks={tasks} milestones={milestones} members={project.members} />

      <div className="print-body-hide">
      <div className="page-header">
        <div>
          <p className="text-sm text-muted" style={{ marginBottom: 4 }}>
            <Link to="/projects" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><ChevronLeft size={14} /> Projects</Link>
          </p>
          <h1 className="page-title">{project.title}</h1>
          <div className="flex-center gap-8 mt-4" style={{ flexWrap: 'wrap' }}>
            <StatusBadge entityType="project" s={project.status} />
            <PriorityBadge p={project.priority} />
            {project.rag_status && <RagBadge rag={project.rag_status} />}
            {project.deadline && <span className={'text-sm ' + (isOverdue(project.deadline) && !['closed','cancelled'].includes(project.status) ? 'overdue' : 'text-muted')}>Due: {fmtDate(project.deadline)}</span>}
          </div>
        </div>
        <div className="flex gap-8">
          {/* Export PDF */}
          {isManager && (
            <button
              className="btn btn-ghost btn-sm print-hide"
              onClick={() => window.print()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
              title="Export a PDF summary of this project"
            >
              <Printer size={14} /> Export PDF
            </button>
          )}
          {/* Edit — manager/planner only, not when closed */}
          {canManage && !['closed','cancelled'].includes(project.status) && (
            <button className="btn btn-ghost btn-sm" onClick={() => {
              setEditForm({ title: project.title, description: project.description, priority: project.priority, deadline: project.deadline?.slice(0, 10) || '', status: project.status, customer_id: project.customer_id || '', pending_from_customer: project.pending_from_customer || '', completion_pct: project.completion_pct ?? '', rag_override: project.rag_override || '' });
              setShowEdit(true);
            }}>Edit</button>
          )}
          {/* Submit for closure — anyone who can manage and project is still active */}
          {!['closed','cancelled','pending_approval'].includes(project.status) && canManage && (
            <button className="btn btn-ghost btn-sm" onClick={requestClosure}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
              title="Submit this project for closure approval">
              <Lock size={13} /> Submit for Closure
            </button>
          )}
          {/* Engineer: request closure */}
          {!['closed','cancelled','pending_approval'].includes(project.status) && isEngineer && (
            <button className="btn btn-ghost btn-sm" onClick={requestClosure}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
              title="Request manager review before closing">
              <Lock size={13} /> Request Closure
            </button>
          )}
          {/* Manager: reopen a closed project */}
          {project.status === 'closed' && isManager && (
            <button className="btn btn-ghost btn-sm" onClick={reopenProject}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <RefreshCw size={13} /> Reopen Project
            </button>
          )}
        </div>
      </div>

      {/* ── Workflow action banner ─────────────────────────── */}
      {project.status === 'pending_approval' && (
        <div style={{
          background: isManager ? '#fffbeb' : '#f0f9ff',
          border: `1px solid ${isManager ? '#fde68a' : '#bae6fd'}`,
          borderRadius: 10, padding: '14px 20px', marginBottom: 16,
          display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 22, flexShrink: 0 }}>⏳</span>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: isManager ? '#92400e' : '#0369a1', marginBottom: 2 }}>
              {isManager ? 'Closure Approval Required' : 'Awaiting Management Approval'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>
              {isManager
                ? 'This project has been submitted for closure. Review and approve or send back for revision.'
                : 'A manager will review this project before it is closed. You will be notified of the decision.'}
            </div>
          </div>
          {isManager && (
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button
                className="btn btn-success btn-sm"
                onClick={approveClosure}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
              >
                <CheckCircle2 size={13} /> Approve &amp; Close
              </button>
              <button
                className="btn btn-warning btn-sm"
                onClick={() => setShowRejectDialog(true)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
              >
                ↩ Send Back
              </button>
            </div>
          )}
        </div>
      )}

      {/* Waiting for Customer banner */}
      {project.status === 'waiting_customer' && (
        <div style={{
          background: 'var(--warning-light)', border: '1px solid #fed7aa', borderRadius: 10,
          padding: '12px 16px', marginBottom: 16, display: 'flex', gap: 12, alignItems: 'flex-start',
        }}>
          <span style={{ fontSize: 20, flexShrink: 0 }}>⏳</span>
          <div>
            <div style={{ fontWeight: 700, color: '#9a3412', marginBottom: 2 }}>Waiting for Customer</div>
            {project.pending_from_customer
              ? <p style={{ margin: 0, fontSize: 13, color: '#7c2d12' }}>{project.pending_from_customer}</p>
              : <p style={{ margin: 0, fontSize: 13, color: '#c2410c' }}>No details provided. Edit the project to add what is needed from the customer.</p>
            }
          </div>
        </div>
      )}

      {project.customer_name && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 13, color: 'var(--gray-600)' }}>
          <Building2 size={14} />
          <span style={{ fontWeight: 600 }}>{project.customer_name}</span>
          {project.customer_contact && <span>· {project.customer_contact}</span>}
          {project.customer_email && <a href={`mailto:${project.customer_email}`} style={{ color: 'var(--primary)' }}>{project.customer_email}</a>}
        </div>
      )}

      {project.description && <p style={{ color: 'var(--gray-600)', marginBottom: 16 }}>{project.description}</p>}

      <div className="grid-4" style={{ marginBottom: 20 }}>
        <div className="card stat"><div className="stat-value" style={{ fontSize: 24 }}>{taskCount}</div><div className="stat-label">Total Tasks</div></div>
        <div className="card stat"><div className="stat-value" style={{ fontSize: 24, color: 'var(--success)' }}>{doneCount}</div><div className="stat-label">Completed</div></div>
        <div className="card stat"><div className="stat-value" style={{ fontSize: 24 }}>{project.members?.length || 0}</div><div className="stat-label">Members</div></div>
        <div className="card stat"><div className="stat-value" style={{ fontSize: 24, color: 'var(--primary)' }}>{project.completion_pct != null ? project.completion_pct : (taskCount > 0 ? Math.round(doneCount / taskCount * 100) : 0)}%</div><div className="stat-label">Progress{project.completion_pct != null ? ' (manual)' : ''}</div></div>
      </div>

      <div className="card" style={{ marginBottom: 4 }}>
        <div className="progress-bar" style={{ height: 12 }}>
          <div className="progress-bar-fill" style={{ width: taskCount > 0 ? `${(doneCount / taskCount) * 100}%` : '0%' }} />
        </div>
      </div>

      <div className="tabs">
        {[
          ...(isPM ? [] : ['tasks']),
          'gantt',
          'milestones',
          'updates',
          'activity',
          'members',
          ...(isPM ? [] : ['attachments']),
          ...(canManage ? ['fields'] : []),
          ...(isManager ? ['kpis', 'scorecard'] : []),
        ].map(t => (
          <button key={t} className={'tab' + (tab === t ? ' active' : '')} onClick={() => setTab(t)}>
            {t === 'kpis' ? 'KPIs' : t === 'scorecard' ? 'Scorecard' : t === 'fields' ? 'Custom Fields' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'tasks' && !isPM && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            {/* View toggle */}
            <div style={{ display: 'flex', borderRadius: 6, border: '1px solid var(--gray-200)', overflow: 'hidden', flexShrink: 0 }}>
              <button
                onClick={() => setTaskViewMode('list')}
                title="List view"
                style={{ padding: '4px 10px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12,
                  background: taskViewMode === 'list' ? 'var(--primary)' : '#fff',
                  color: taskViewMode === 'list' ? '#fff' : 'var(--gray-500)' }}
              >
                <ListIcon size={14} /> List
              </button>
              <button
                onClick={() => setTaskViewMode('kanban')}
                title="Kanban view"
                style={{ padding: '4px 10px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12,
                  background: taskViewMode === 'kanban' ? 'var(--primary)' : '#fff',
                  color: taskViewMode === 'kanban' ? '#fff' : 'var(--gray-500)' }}
              >
                <LayoutGrid size={14} /> Kanban
              </button>
            </div>

            <div style={{ flex: 1 }} />

            {canManage && (
              <>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowImportExcel(true)} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Upload size={14} /> Import from Excel
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => setShowAddTask(true)}>+ Add Task</button>
              </>
            )}
          </div>

          {/* Task search */}
          {tasks.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={{ position: 'relative', flex: 1, maxWidth: 300 }}>
                <input
                  value={taskSearch}
                  onChange={e => setTaskSearch(e.target.value)}
                  placeholder="Search tasks…"
                  style={{ width: '100%', paddingLeft: 30, paddingRight: taskSearch ? 28 : 10, fontSize: 13 }}
                />
                <svg style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', opacity: .4 }} width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><circle cx={11} cy={11} r={8}/><path d="m21 21-4.35-4.35"/></svg>
                {taskSearch && (
                  <button onClick={() => setTaskSearch('')} style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-400)', display: 'flex', alignItems: 'center', padding: 2 }}>
                    <X size={13} />
                  </button>
                )}
              </div>
              {taskSearch && (
                <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>
                  {filteredTasks.length} of {tasks.length}
                </span>
              )}
            </div>
          )}

          {tasks.length === 0 ? (
            <p className="text-muted text-sm">No tasks yet</p>
          ) : filteredTasks.length === 0 ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--gray-400)' }}>
              <p className="text-sm">No tasks matching &ldquo;{taskSearch}&rdquo;</p>
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setTaskSearch('')}>Clear search</button>
            </div>
          ) : taskViewMode === 'kanban' ? (
            <KanbanView
              tasks={filteredTasks}
              isManager={isManager}
              isPlanner={isPlanner}
              onUpdate={updateTask}
              onRowClick={setSelectedTask}
              onDuplicate={duplicateTask}
            />
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Task</th><th>Status</th><th>Priority</th><th>Assigned To</th><th>Deadline</th><th>Hours</th><th>Update</th></tr></thead>
                <tbody>{filteredTasks.map(t => <TaskRow key={t.id} task={t} isManager={isManager} isPlanner={isPlanner} allUsers={allUsers} onUpdate={updateTask} onRowClick={setSelectedTask} onDuplicate={duplicateTask} />)}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'gantt' && (
        <div className="card">
          <GanttTab project={project} tasks={tasks} milestones={milestones} />
        </div>
      )}

      {tab === 'milestones' && (
        <div className="card">
          <MilestonesTab
            projectId={id}
            canManage={canManage}
            milestones={milestones}
            onReload={loadMilestones}
          />
        </div>
      )}

      {tab === 'updates' && (
        <div className="card">
          {!isPM && (
            <form onSubmit={submitStatusUpdate} style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'flex-end' }}>
              <MentionInput
                value={statusMsg}
                onChange={setStatusMsg}
                placeholder="Add a status update… (type @name to notify)"
                users={allUsers}
                style={{ flex: 1 }}
              />
              <button type="submit" className="btn btn-primary btn-sm" disabled={!statusMsg.trim()}>Post</button>
            </form>
          )}
          {!(project.updates?.length > 0)
            ? <p className="text-muted text-sm">No updates yet</p>
            : <ul className="updates-list">
                {project.updates.map(u => (
                  <li key={u.id} className="update-item">
                    <div>{renderMentions(u.message)}</div>
                    <div className="update-meta" title={fmtDate(u.created_at)}>{u.user_name} · {fmtRelative(u.created_at)}</div>
                  </li>
                ))}
              </ul>
          }
        </div>
      )}

      {tab === 'activity' && (
        <div className="card">
          <div className="section-title" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <ClipboardList size={15} /> Activity Feed
          </div>
          {activity.length === 0
            ? <p className="text-muted text-sm">No activity recorded yet.</p>
            : <ul style={{ listStyle: 'none' }}>
                {activity.map((a, i) => {
                  const iconMap = {
                    task_created:    <Plus         size={13} color="var(--success)" />,
                    task_status:     <RefreshCw    size={13} color="var(--primary)" />,
                    task_deleted:    <Trash2       size={13} color="var(--danger)"  />,
                    task_comment:    <MessageSquare size={13} color="var(--gray-500)" />,
                    project_created: <FolderOpen   size={13} color="var(--primary)" />,
                    status_changed:  <GitBranch    size={13} color="var(--warning)" />,
                    status_update:   <FileText     size={13} color="var(--gray-500)" />,
                    member_added:    <UserPlus     size={13} color="var(--success)" />,
                    member_removed:  <UserX        size={13} color="var(--danger)"  />,
                    closure_requested: <Lock       size={13} color="var(--warning)" />,
                    project_closed:  <CheckCircle2 size={13} color="var(--success)" />,
                  };
                  const icon = iconMap[a.action] || <span style={{ width: 13, height: 13 }}>·</span>;
                  const labels = {
                    task_created: 'Created task', task_status: 'Updated task status', task_deleted: 'Deleted task', task_comment: 'Commented on task',
                    project_created: 'Created project', status_changed: 'Changed project status', status_update: 'Posted update',
                    member_added: 'Added member', member_removed: 'Removed member', closure_requested: 'Requested closure', project_closed: 'Closed project',
                  };
                  return (
                    <li key={a.id} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: i < activity.length - 1 ? '1px solid var(--gray-100)' : 'none', alignItems: 'flex-start' }}>
                      <span style={{ width: 20, display: 'flex', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>{icon}</span>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{a.user_name}</span>
                        <span style={{ fontSize: 13, color: 'var(--gray-600)' }}> {labels[a.action] || a.action}</span>
                        {a.detail && <span style={{ fontSize: 13, color: 'var(--gray-500)' }}>: {a.detail}</span>}
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--gray-400)', flexShrink: 0, marginTop: 2 }} title={fmtDate(a.created_at)}>{fmtRelative(a.created_at)}</span>
                    </li>
                  );
                })}
              </ul>
          }
        </div>
      )}

      {tab === 'members' && (
        <div className="card">
          <div className="section-title">Team Members</div>
          {project.members?.length === 0 ? <p className="text-muted text-sm">No members assigned</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Name</th><th>Email</th><th>Role</th>{isManager && <th>Action</th>}</tr></thead>
                <tbody>{project.members?.map(m => (
                  <tr key={m.id}>
                    <td>{m.name}</td><td>{m.email || '—'}</td>
                    <td><span className={`badge badge-${m.role}`}>{m.role}</span></td>
                    {isManager && <td><button className="btn btn-sm btn-danger" onClick={async () => {
                      const ok = await confirm(`Remove ${m.name} from this project?`, { title: 'Remove Member', label: 'Remove' });
                      if (!ok) return;
                      await api.removeMember(id, m.id).catch(e => { toast.error(e.message); return null; });
                      toast.success(`${m.name} removed`);
                      load();
                    }}>Remove</button></td>}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {isManager && addableUsers.filter(u => !project.members?.some(m => m.id === u.id)).length > 0 && (
            <div className="mt-16">
              <div className="section-title">Add Members</div>
              <div className="chip-list">
                {addableUsers.filter(u => !project.members?.some(m => m.id === u.id)).map(u => (
                  <div key={u.id} className="chip" style={{ cursor: 'pointer' }} onClick={() => api.addMembers(id, [u.id]).then(load)}>
                    {u.name}
                    <span style={{ fontSize: 10, marginLeft: 4, opacity: .65 }}>{u.role}</span>
                    <button>+</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'attachments' && (
        <div className="card"><AttachmentsSection projectId={id} /></div>
      )}

      {tab === 'fields' && canManage && (
        <div className="card"><CustomFieldsTab projectId={id} canManage={canManage} /></div>
      )}

      {tab === 'kpis' && isManager && (
        <div className="card"><KpiSection projectId={id} /></div>
      )}

      {tab === 'scorecard' && isManager && (
        <div className="card"><ScorecardTab projectId={id} members={project.members} /></div>
      )}

      {showEdit && (
        <Modal title="Edit Project" onClose={() => setShowEdit(false)}>
          <form onSubmit={saveEdit}>
            <div className="form-group"><label>Title</label><input value={editForm.title} onChange={setE('title')} required /></div>
            <div className="form-group"><label>Description</label><textarea value={editForm.description || ''} onChange={setE('description')} /></div>
            <div className="form-row">
              <div className="form-group"><label>Priority</label>
                <select value={editForm.priority} onChange={setE('priority')}>
                  <option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                </select>
              </div>
              <div className="form-group"><label>Status</label>
                <select value={editForm.status} onChange={setE('status')} disabled={project.status === 'pending_approval'}>
                  {[
                    { value: 'not_started',        label: 'Not Started' },
                    { value: 'in_progress',        label: 'In Progress' },
                    { value: 'waiting_customer',   label: 'Waiting for Customer' },
                    { value: 'waiting_vendor',     label: 'Waiting for Vendor' },
                    { value: 'on_hold',            label: 'On Hold' },
                    { value: 'delayed',            label: 'Delayed' },
                    { value: 'completed_engineer', label: 'Completed by Engineer' },
                    { value: 'pending_approval',   label: 'Pending Management Approval' },
                    { value: 'reopened',           label: 'Reopened' },
                    { value: 'cancelled',          label: 'Cancelled' },
                  ].filter(s => s.value !== 'pending_approval' || project.status === 'pending_approval').map(({ value, label }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                {project.status === 'pending_approval' && <small>Use the closure review controls to approve or return this project.</small>}
              </div>
            </div>
            {/* Completion percentage override */}
            <div className="form-group">
              <label>Completion % (manual override, leave blank to auto-calculate)</label>
              <input
                type="number" min="0" max="100"
                value={editForm.completion_pct ?? ''}
                onChange={e => setEditForm(f => ({ ...f, completion_pct: e.target.value === '' ? null : Number(e.target.value) }))}
                placeholder="e.g. 75"
              />
            </div>
            {/* Pending From Customer/Vendor — required when requires_reason status */}
            {(editForm.status === 'waiting_customer' || editForm.status === 'waiting_vendor') && (
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  ⏳ {editForm.status === 'waiting_vendor' ? 'Pending From Vendor' : 'Pending From Customer'} <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <textarea
                  value={editForm.pending_from_customer || ''}
                  onChange={setE('pending_from_customer')}
                  placeholder={editForm.status === 'waiting_vendor' ? 'Describe what is needed from the vendor…' : 'Describe what is needed from the customer…'}
                  rows={3}
  required
                  style={{ borderColor: '#f97316' }}
                />
              </div>
            )}
            <div className="form-group"><label>Deadline</label><input type="date" value={editForm.deadline || ''} onChange={setE('deadline')} /></div>
            <div className="form-group">
              <label>Health Override (RAG)</label>
              <select value={editForm.rag_override || ''} onChange={setE('rag_override')}>
                <option value="">Auto (calculated)</option>
                <option value="green">🟢 Green — On track</option>
                <option value="amber">🟡 Amber — At risk</option>
                <option value="red">🔴 Red — Critical</option>
              </select>
            </div>
            <div className="form-group">
              <label>Customer</label>
              <select value={editForm.customer_id || ''} onChange={setE('customer_id')}>
                <option value="">— No customer —</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="modal-footer" style={{ padding: '12px 0 0', border: 'none' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setShowEdit(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save</button>
            </div>
          </form>
        </Modal>
      )}

      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          isManager={isManager}
          isPlanner={isPlanner}
          allUsers={allUsers}
          projectTasks={tasks}
          onUpdate={(tid, data) => { updateTask(tid, data); setSelectedTask(null); }}
          onClose={() => setSelectedTask(null)}
        />
      )}

      {showRejectDialog && (
        <RejectDialog
          onConfirm={rejectClosure}
          onCancel={() => setShowRejectDialog(false)}
        />
      )}

      {showImportExcel && (
        <ImportExcelModal
          projectId={id}
          onClose={() => setShowImportExcel(false)}
          onImported={() => { api.tasks({ project_id: id }).then(setTasks); }}
        />
      )}

      {showAddTask && (
        <Modal title="Add Task" onClose={() => { setShowAddTask(false); setAddTaskErr(''); }}>
          <form onSubmit={addTask}>
            <div className="form-group"><label>Title *</label><input value={taskForm.title} onChange={setT('title')} required /></div>
            <div className="form-group"><label>Description</label><textarea value={taskForm.description} onChange={setT('description')} /></div>
            <div className="form-row">
              <div className="form-group"><label>Priority</label>
                <select value={taskForm.priority} onChange={setT('priority')}>
                  <option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                </select>
              </div>
              <div className="form-group"><label>Deadline</label><input type="date" value={taskForm.deadline} onChange={setT('deadline')} /></div>
            </div>
            {isManager && <div className="form-group"><label>Assign To</label>
              <select value={taskForm.assigned_to} onChange={setT('assigned_to')}>
                <option value="">Unassigned</option>
                {engineers.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>}
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}>
                <input type="checkbox" checked={taskForm.is_adhoc} onChange={e => setTaskForm(f => ({ ...f, is_adhoc: e.target.checked }))} style={{ width: 'auto' }} />
                Mark as Ad-hoc Task
              </label>
            </div>
            {addTaskErr && <div className="error-msg" style={{ marginBottom: 8 }}>{addTaskErr}</div>}
            <div className="modal-footer" style={{ padding: '12px 0 0', border: 'none' }}>
              <button type="button" className="btn btn-ghost" onClick={() => { setShowAddTask(false); setAddTaskErr(''); }}>Cancel</button>
              <button type="submit" className="btn btn-primary">Add Task</button>
            </div>
          </form>
        </Modal>
      )}
      </div>{/* end .print-body-hide */}
    </div>
  );
}
