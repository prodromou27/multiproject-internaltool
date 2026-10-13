import { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, AlertTriangle, Settings2 } from 'lucide-react';
import { HeaderMenu, PageHeader } from '../components/PageLayout';
import { fmtDate, fmtTime } from '../components/Shared';
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
import { engineerWidget } from './dashboard/engineerWidgets';
import './Dashboard.css';
import { useLiveRefresh } from '../live';

// Engineers have both this dashboard and My Work (where they land after signing in).
export default function Dashboard() {
  const { user } = useAuth();
  const isManager  = user.role === 'manager';
  const isPlanner  = user.role === 'planner';
  const isPM       = user.role === 'pm';
  const isEngineer = user.role === 'engineer';

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
        api.maintenanceVisits({ month: localDateISO().slice(0,7), overview:1 }),
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
      // Managed-customer context is a bonus widget: its failure is not a page error.
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
  }, [isManager, isPlanner, isPM, isEngineer]);

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
  const ctx = { active, completingVisit, incompleteVisits, load, myManagedCustomers, myOpen, pendingClosure, pendingReports, projects, reviewVisits, setCompletingVisit, summary, visits };
  const renderFn = isManager ? managerWidget : isPlanner ? plannerWidget : isPM ? pmWidget : engineerWidget;

  return (
    <div className="page dashboard-page">
      {/* Page header */}
      <PageHeader title={isManager ? 'Operations overview' : isEngineer ? 'My dashboard' : isPlanner ? 'Maintenance planning' : 'Project overview'}
        meta={`${new Intl.DateTimeFormat('en-GB', { weekday: 'long' }).format(new Date())} ${fmtDate(localDateISO())}${lastUpdated ? ` · updated ${fmtTime(lastUpdated)}` : ''}`}
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

      {(isManager || isEngineer) && <OperationalFocus data={overview} error={overviewError} onRefresh={load} />}

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
