import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, AlertTriangle, Settings2 } from 'lucide-react';
import { PageHeader } from '../components/PageLayout';
import OperationalFocus from '../components/OperationalFocus';
import { localDateISO } from '../utils/dates';
import { api } from '../api';
import { useAuth } from '../App';
import { isOverdue } from '../components/Shared';
import { useWidgetPrefs } from './dashboard/widgetPrefs';
import WidgetCustomizer from './dashboard/WidgetCustomizer';
import OverdueBanner from './dashboard/OverdueBanner';
import { plannerWidget } from './dashboard/plannerWidgets';
import { managerWidget } from './dashboard/managerWidgets';
import { engineerWidget } from './dashboard/engineerWidgets';
import { pmWidget } from './dashboard/pmWidgets';
import './Dashboard.css';

export default function Dashboard() {
  const { user } = useAuth();
  const isManager  = user.role === 'manager';
  const isPlanner  = user.role === 'planner';
  const isEngineer = user.role === 'engineer';
  const isPM       = user.role === 'pm';

  const [projects,         setProjects]         = useState([]);
  const [tasks,            setTasks]            = useState([]);
  const [summary,          setSummary]          = useState(null);
  const [visits,           setVisits]           = useState([]);
  const [reviewVisits,     setReviewVisits]     = useState([]);
  const [incompleteVisits, setIncompleteVisits] = useState([]);
  const [pendingReports,   setPendingReports]   = useState([]);
  const [myManagedCustomers, setMyManagedCustomers] = useState([]);
  const [completingVisit,  setCompletingVisit]  = useState(null); // visit id being completed
  const [error,            setError]            = useState('');
  const [loading,          setLoading]          = useState(true);
  const [refreshing,       setRefreshing]       = useState(false);
  const [lastUpdated,      setLastUpdated]      = useState(null);
  const [showCustomizer,   setShowCustomizer]   = useState(false);

  const { prefs, defs, isVisible, toggle, reorder, reset } = useWidgetPrefs(user.id, user.role);

  const [overview, setOverview] = useState(null);
  const [overviewError, setOverviewError] = useState('');
  const overviewRequest = useRef(0);
  const loadedOnce = useRef(false);

  const load = useCallback(async () => {
    const request = ++overviewRequest.current;
    if (loadedOnce.current) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const corePromise=Promise.allSettled([
        (isPlanner) ? Promise.resolve([]) : api.projects(),
        (isPlanner || isPM) ? Promise.resolve([]) : api.tasks({}),
        isManager ? api.reportSummary() : Promise.resolve(null),
        (isManager || isEngineer) ? api.operationsOverview({ as_of: localDateISO() }) : Promise.resolve(null),
      ]);
      const detailPromise=Promise.allSettled([
        api.maintenanceVisits({ month: new Date().toISOString().slice(0,7), overview:1 }),
        isManager ? api.maintenanceVisits({ review_pending:1 }) : Promise.resolve([]),
        (isManager || isPM) ? api.maintenanceVisits({ not_completed:1 }) : Promise.resolve([]),
        isEngineer ? api.maintenanceVisits({ pending_report:1 }) : Promise.resolve([]),
        isEngineer ? api.myManagedCustomers().then(r => r.rows) : Promise.resolve([]),
      ]);
      const [pR,tR,sR,oR]=await corePromise;
      if (request !== overviewRequest.current) return;
      if (oR.status === 'fulfilled') { setOverview(oR.value); setOverviewError(''); }
      else setOverviewError(oR.reason?.message || 'Unable to load the work overview');
      if (pR.status  === 'fulfilled') setProjects(pR.value ?? []);
      if (tR.status  === 'fulfilled') setTasks(tR.value ?? []);
      if (sR.status  === 'fulfilled') setSummary(sR.value);
      loadedOnce.current=true;setLoading(false);
      const [vR,rR,iR,prR,mR]=await detailPromise;
      if (request !== overviewRequest.current) return;
      if (vR.status  === 'fulfilled') setVisits(vR.value ?? []);
      if (rR.status  === 'fulfilled') setReviewVisits(rR.value ?? []);
      if (iR.status  === 'fulfilled') setIncompleteVisits(iR.value ?? []);
      if (prR.status === 'fulfilled') setPendingReports(prR.value ?? []);
      if (mR.status  === 'fulfilled') setMyManagedCustomers(mR.value ?? []);
      // Managed-customer context is a bonus widget, so its failure does not
      // replace usable dashboard data with a page-level error.
      const failed = [pR, tR, sR, vR, rR, iR, prR, oR]
        .filter(r => r.status === 'rejected').map(r => r.reason?.message || 'Unknown');
      if (failed.length) setError(`Some data could not be loaded: ${failed.join(' · ')}`);
    } catch (err) {
      setError(err.message || 'Failed to load dashboard');
    } finally {
      if (request === overviewRequest.current) {
        loadedOnce.current = true;
        setLastUpdated(new Date());
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [isManager, isPlanner, isEngineer, isPM]);

  useEffect(() => { load(); return () => { overviewRequest.current++; }; }, [load]);

  if (loading) return (
    <div className="page dashboard-page">
      <div className="dashboard-loading" role="status">
        <RefreshCw size={18} style={{ animation:'spin 1s linear infinite' }} />
        Loading dashboard…
      </div>
    </div>
  );

  /* ── Derived data ─────────────────────────────────────── */
  const TASK_TERMINAL = ['completed', 'closed', 'cancelled'];
  const active          = projects.filter(p => !['closed', 'cancelled'].includes(p.status));
  const pendingClosure  = projects.filter(p => p.status === 'pending_approval');
  const myOpen          = tasks.filter(t => !TASK_TERMINAL.includes(t.status));
  const overdueProjects = projects.filter(p => isOverdue(p.deadline) && !['closed', 'cancelled', 'pending_approval'].includes(p.status));
  const overdueTasks    = tasks.filter(t => isOverdue(t.deadline) && !TASK_TERMINAL.includes(t.status));

  /* ════════════════════════════════════════════════════════
     Widget render helpers — return null when widget has no
     content so it silently disappears (not "hidden by user")
  ════════════════════════════════════════════════════════ */

  /* ── Render ───────────────────────────────────────────── */
    // Everything the role-specific widget renderers (./dashboard/*Widgets.jsx) read.
  const ctx = { active, completingVisit, incompleteVisits, load, myManagedCustomers, myOpen, pendingClosure, pendingReports, projects, reviewVisits, setCompletingVisit, summary, visits };
  const renderFn = isManager ? managerWidget : isPlanner ? plannerWidget : isPM ? pmWidget : engineerWidget;

  return (
    <div className="page dashboard-page">
      {/* Page header */}
      <PageHeader eyebrow="Workspace" title={isManager ? 'Operations overview' : isEngineer ? 'My work overview' : isPlanner ? 'Maintenance planning' : 'Project overview'}
        description={isManager ? 'Review exceptions, outstanding decisions and upcoming commitments.' : isEngineer ? 'Start with due work, report obligations and customer follow-ups.' : 'Plan and review the work available to your role.'}
        actions={<>
          {isManager && <Link to="/approvals" className="btn btn-primary">Review approvals</Link>}
          {isEngineer && <Link to="/my-day" className="btn btn-primary">Open My Work</Link>}
          <div style={{ display:'flex', gap:8 }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setShowCustomizer(true)}
            style={{ display:'inline-flex', alignItems:'center', gap:5 }}
          >
            <Settings2 size={13} /> Customize
          </button>
          <button className="btn btn-ghost btn-sm" onClick={load} disabled={refreshing}
            style={{ display:'inline-flex', alignItems:'center', gap:5 }}>
            <RefreshCw size={13} className={refreshing ? 'dashboard-spin' : ''} /> {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        </>} />

      <div className="dashboard-statusbar" aria-live="polite">
        <span className="dashboard-snapshot"><i /> Current snapshot</span>
        <span>{new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())}</span>
        <span>Updated {lastUpdated ? lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'just now'}</span>
        <span className="dashboard-widget-count">{prefs.order.length - prefs.hidden.length} of {prefs.order.length} widgets visible</span>
      </div>

      {error && (
        <div className="alert alert-warning mb-20">
          <AlertTriangle size={14} style={{ flexShrink:0 }} /> {error}
        </div>
      )}

      {(isManager || isEngineer) && <OperationalFocus data={overview} error={overviewError} onRefresh={load} />}

      <OverdueBanner overdueProjects={overdueProjects} overdueTasks={overdueTasks} />

      {/* Widgets rendered in user-defined order */}
      {prefs.order.map(id => isVisible(id) ? renderFn(id, ctx) : null)}

      {/* Customizer modal */}
      {showCustomizer && (
        <WidgetCustomizer
          prefs={prefs}
          defs={defs}
          onToggle={toggle}
          onReorder={reorder}
          onReset={reset}
          onClose={() => setShowCustomizer(false)}
        />
      )}
    </div>
  );
}
