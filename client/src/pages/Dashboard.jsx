import { useEffect, useState, useCallback, useRef } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { RefreshCw, AlertTriangle, Settings2 } from 'lucide-react';
import { HeaderMenu, PageHeader } from '../components/PageLayout';
import { PAGES, canAccessPage } from '../navigation';
import OperationalFocus from '../components/OperationalFocus';
import { localDateISO } from '../utils/dates';
import { api } from '../api';
import { useAuth } from '../App';
import { useWidgetPrefs } from './dashboard/widgetPrefs';
import WidgetCustomizer from './dashboard/WidgetCustomizer';
import { plannerWidget } from './dashboard/plannerWidgets';
import { managerWidget } from './dashboard/managerWidgets';
import { pmWidget } from './dashboard/pmWidgets';
import './Dashboard.css';
import { useLiveRefresh } from '../live';

// Engineers work from My Work, which has everything their dashboard had.
export default function Dashboard() {
  const { user } = useAuth();
  return user.role === 'engineer' ? <Navigate to="/my-day" replace /> : <RoleDashboard />;
}

function RoleDashboard() {
  const { user } = useAuth();
  const isManager  = user.role === 'manager';
  const isPlanner  = user.role === 'planner';
  const isPM       = user.role === 'pm';

  const [projects,         setProjects]         = useState([]);
  const [tasks,            setTasks]            = useState([]);
  const [summary,          setSummary]          = useState(null);
  const [visits,           setVisits]           = useState([]);
  const [reviewVisits,     setReviewVisits]     = useState([]);
  const [incompleteVisits, setIncompleteVisits] = useState([]);
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
        isManager ? api.operationsOverview({ as_of: localDateISO() }) : Promise.resolve(null),
      ]);
      const detailPromise=Promise.allSettled([
        api.maintenanceVisits({ month: localDateISO().slice(0,7), overview:1 }),
        isManager ? api.maintenanceVisits({ review_pending:1 }) : Promise.resolve([]),
        (isManager || isPM) ? api.maintenanceVisits({ not_completed:1 }) : Promise.resolve([]),
      ]);
      const [pR,tR,sR,oR]=await corePromise;
      if (request !== overviewRequest.current) return;
      if (oR.status === 'fulfilled') { setOverview(oR.value); setOverviewError(''); }
      else setOverviewError(oR.reason?.message || 'Unable to load the work overview');
      if (pR.status  === 'fulfilled') setProjects(pR.value ?? []);
      if (tR.status  === 'fulfilled') setTasks(tR.value ?? []);
      if (sR.status  === 'fulfilled') setSummary(sR.value);
      loadedOnce.current=true;setLoading(false);
      const [vR,rR,iR]=await detailPromise;
      if (request !== overviewRequest.current) return;
      if (vR.status  === 'fulfilled') setVisits(vR.value ?? []);
      if (rR.status  === 'fulfilled') setReviewVisits(rR.value ?? []);
      if (iR.status  === 'fulfilled') setIncompleteVisits(iR.value ?? []);
      const failed = [pR, tR, sR, vR, rR, iR, oR]
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
  }, [isManager, isPlanner, isPM]);

  useEffect(() => { load(); return () => { overviewRequest.current++; }; }, [load]);
  useLiveRefresh(load);

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

  /* ════════════════════════════════════════════════════════
     Widget render helpers — return null when widget has no
     content so it silently disappears (not "hidden by user")
  ════════════════════════════════════════════════════════ */

  /* ── Render ───────────────────────────────────────────── */
    // Everything the role-specific widget renderers (./dashboard/*Widgets.jsx) read.
  const ctx = { active, completingVisit, incompleteVisits, load, myOpen, pendingClosure, projects, reviewVisits, setCompletingVisit, summary, visits };
  const renderFn = isManager ? managerWidget : isPlanner ? plannerWidget : pmWidget;

  return (
    <div className="page dashboard-page">
      {/* Page header */}
      <PageHeader title={isManager ? 'Operations overview' : isPlanner ? 'Maintenance planning' : 'Project overview'}
        meta={`${new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}${lastUpdated ? ` · updated ${lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}`}
        actions={<>
          {/* Approvals has no place in the menu: it opens from here. */}
          {canAccessPage(PAGES.find(page => page.id === 'approvals'), user) && <Link to="/approvals" className="btn btn-primary">Review approvals</Link>}
          {/* The page refreshes itself when anything changes; Refresh stays in the menu. */}
          <HeaderMenu>
            <button type="button" onClick={() => setShowCustomizer(true)}><Settings2 size={14} aria-hidden="true" /> Customize</button>
            <button type="button" onClick={load} disabled={refreshing}><RefreshCw size={14} aria-hidden="true" /> {refreshing ? 'Refreshing…' : 'Refresh'}</button>
          </HeaderMenu>
        </>} />


      {error && (
        <div className="alert alert-warning mb-20">
          <AlertTriangle size={14} style={{ flexShrink:0 }} /> {error}
        </div>
      )}

      {isManager && <OperationalFocus data={overview} error={overviewError} onRefresh={load} />}

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
