import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import Login from './pages/Login';
import { api } from './api';
import { PAGES, canAccessPage } from './navigation';
import { PageState } from './components/PageLayout';
import ErrorBoundary from './components/ErrorBoundary';
import { loadLocaleConfig } from './utils/locale';
import { StatusProvider } from './hooks/useStatuses';
import { ToastProvider } from './components/Toast';
import { ConfirmProvider } from './components/Confirm';
import { useDarkMode } from './shell/useDarkMode';
import { Layout } from './shell/Layout';
import { AuthContext, useAuth } from './auth';

// Route-level code splitting: each page loads on first visit instead of in the
// initial bundle. Login stays eager so the unauthenticated first paint is instant.
const Dashboard         = lazy(() => import('./pages/Dashboard'));
const Approvals         = lazy(() => import('./pages/Approvals'));
const Projects          = lazy(() => import('./pages/Projects'));
const ProjectDetail     = lazy(() => import('./pages/ProjectDetail'));
const Tasks             = lazy(() => import('./pages/Tasks'));
const Reports           = lazy(() => import('./pages/Reports'));
const KpiManagement     = lazy(() => import('./pages/KpiManagement'));
const UsersPage         = lazy(() => import('./pages/Users'));
const CalendarPage      = lazy(() => import('./pages/CalendarPage'));
const MaintenanceVisits = lazy(() => import('./pages/MaintenanceVisits'));
const Customers         = lazy(() => import('./pages/Customers'));
const AdminPanel        = lazy(() => import('./pages/AdminPanel'));
const Scorecards        = lazy(() => import('./pages/Scorecards'));
const CustomerResponses = lazy(() => import('./pages/CustomerResponses'));
const Templates         = lazy(() => import('./pages/Templates'));
const Workload          = lazy(() => import('./pages/Workload'));
const Notes             = lazy(() => import('./pages/Notes'));
const Profile           = lazy(() => import('./pages/Profile'));
const SLAPage           = lazy(() => import('./pages/SLAPage'));
const SearchPage        = lazy(() => import('./pages/SearchPage'));
const EngineerHub       = lazy(() => import('./pages/EngineerHub'));
const ActivityLog       = lazy(() => import('./pages/ActivityLog'));
const ServiceOperations = lazy(() => import('./pages/ServiceOperations'));
const ManagedCustomers   = lazy(() => import('./pages/ManagedCustomers'));
const CustomerServiceProfile = lazy(() => import('./pages/CustomerServiceProfile'));

export { AuthContext, useAuth } from './auth';

/* ── Route guard ─────────────────────────────────────────── */
function PageLoader() {
  return (
    <div className="page u-59155a5">
      <span className="u-ef6649d" />
      Loading…
    </div>
  );
}

function PrivateRoute({ children, allowedRoles, page }) {
  const { user, saAccess } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace />;
  const definition = page ? PAGES.find(item => item.id === page) : null;
  if (definition?.feature && user.role !== 'manager' && !saAccess.loaded) return <Layout><PageLoader /></Layout>;
  if ((definition && !canAccessPage(definition, user, saAccess.enabled)) ||
      (allowedRoles && !allowedRoles.includes(user.role))) {
    return <Layout><PageState title="Access unavailable" description="Your role or team settings do not allow access to this page. Contact your administrator if you need access." /></Layout>;
  }
  return <Layout><ErrorBoundary resetKey={location.pathname}><Suspense fallback={<PageLoader />}>{children}</Suspense></ErrorBoundary></Layout>;
}

function LegacySettingsRedirect() {
  const { section } = useParams();
  return <Navigate to={section ? `/settings/${section}` : '/settings'} replace />;
}

/* ── App root ────────────────────────────────────────────── */
export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [passwordChangeUser, setPasswordChangeUser] = useState(null);
  const [dark, toggleDark] = useDarkMode();
  // Service Activity Tracking module access is team-membership-driven, not role-driven,
  // so it's fetched separately from the login payload and re-checked on every mount.
  // This only controls nav/route visibility (UX) — every server route independently
  // re-verifies team membership + enablement on each request.
  const [saAccess, setSaAccess] = useState({ enabled: false, teams: [], capabilities: {}, loaded: false });

  const refreshPermissions=useCallback(async () => {
    const result=await api.myPermissions();
    setUser(current => {
      if (!current) return current;
      const next=result.permissions || {};
      return JSON.stringify(current.permissions || {})===JSON.stringify(next) ? current : { ...current,permissions:next };
    });
  },[]);

  useEffect(() => {
    // Remove legacy browser-stored credentials; identity now comes from the API.
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    let mounted = true;
    // Loaded alongside auth (not awaited sequentially) so the app's configured date/time/
    // number format is already in place before the first protected page renders — no
    // flash of default formatting, no need for pages to know localization exists.
    loadLocaleConfig().catch(() => {});
    api.me({ redirectOnUnauthorized: false }).then(fresh => {
      if (!mounted) return;
      if (fresh.must_change_password) setPasswordChangeUser(fresh);
      else setUser(fresh);
    }).catch(error => {
      if (mounted && ![401, 403].includes(error.status)) setAuthError(error.message || 'Unable to restore your session');
    }).finally(() => { if (mounted) setAuthLoading(false); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!user) { setSaAccess({ enabled: false, teams: [], capabilities: {}, loaded: false }); return; }
    let mounted = true;
    api.teamsMine().then(d => {
      if (mounted) setSaAccess({ enabled: !!d.service_activity_enabled, teams: d.teams || [], capabilities:d.capabilities || {}, loaded: true });
    }).catch(() => { if (mounted) setSaAccess({ enabled: false, teams: [], capabilities:{}, loaded: true }); });
    return () => { mounted = false; };
  }, [user?.id]);  

  useEffect(() => {
    if (!user) return undefined;
    const refresh=() => refreshPermissions().catch(() => {});
    const timer=setInterval(refresh,60000);
    const onVisibility=() => { if (document.visibilityState==='visible') refresh(); };
    document.addEventListener('visibilitychange',onVisibility);
    window.addEventListener('permissions-changed',refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange',onVisibility);
      window.removeEventListener('permissions-changed',refresh);
    };
  },[user?.id,refreshPermissions]);

  const login = (userData) => {
    setPasswordChangeUser(null);
    setUser(userData);
  };
  const logout = async () => {
    await api.logout();
    setPasswordChangeUser(null);
    setUser(null);
  };

  if (authLoading) return <PageLoader />;
  if (authError) return <div className="page"><p className="error-msg" role="alert">{authError}</p><button className="btn btn-primary" onClick={() => window.location.reload()}>Retry</button></div>;

  return (
    <AuthContext.Provider value={{ user, login, logout, dark, toggleDark, saAccess, passwordChangeUser }}>
      <ToastProvider>
      <ConfirmProvider>
      <StatusProvider enabled={!!user}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
          <Route path="/"                    element={<PrivateRoute page="dashboard"><Dashboard /></PrivateRoute>} />
          <Route path="/calendar"            element={<PrivateRoute page="calendar"><CalendarPage /></PrivateRoute>} />
          <Route path="/projects"            element={<PrivateRoute page="projects"><Projects /></PrivateRoute>} />
          <Route path="/projects/:id"        element={<PrivateRoute page="projects"><ProjectDetail /></PrivateRoute>} />
          <Route path="/tasks"               element={<PrivateRoute page="tasks"><Tasks /></PrivateRoute>} />
          <Route path="/maintenance-visits"  element={<PrivateRoute page="visits"><MaintenanceVisits /></PrivateRoute>} />
          <Route path="/customers"           element={<PrivateRoute page="customers"><Customers /></PrivateRoute>} />
          <Route path="/managed-customers"   element={<PrivateRoute page="managedCustomers"><ManagedCustomers /></PrivateRoute>} />
          <Route path="/managed-customers/:id" element={<PrivateRoute page="managedCustomers"><ManagedCustomers /></PrivateRoute>} />
          <Route path="/scorecards"          element={<PrivateRoute page="scorecards"><Scorecards /></PrivateRoute>} />
          <Route path="/reports"             element={<PrivateRoute page="reports"><Reports /></PrivateRoute>} />
          <Route path="/kpis"                element={<PrivateRoute page="kpiManagement"><KpiManagement /></PrivateRoute>} />
          <Route path="/approvals"           element={<PrivateRoute page="approvals"><Approvals /></PrivateRoute>} />
          <Route path="/users"               element={<PrivateRoute page="users"><UsersPage /></PrivateRoute>} />
          <Route path="/settings"            element={<PrivateRoute page="settings"><AdminPanel /></PrivateRoute>} />
          <Route path="/settings/:section"   element={<PrivateRoute page="settings"><AdminPanel /></PrivateRoute>} />
          <Route path="/admin"               element={<LegacySettingsRedirect />} />
          <Route path="/admin/:section"      element={<LegacySettingsRedirect />} />
          <Route path="/templates"           element={<PrivateRoute page="templates"><Templates /></PrivateRoute>} />
          <Route path="/workload"            element={<PrivateRoute page="workload"><Workload /></PrivateRoute>} />
          <Route path="/sla"               element={<PrivateRoute page="sla"><SLAPage /></PrivateRoute>} />
          <Route path="/notes"               element={<PrivateRoute page="notes"><Notes /></PrivateRoute>} />
          <Route path="/search"             element={<PrivateRoute page="search"><SearchPage /></PrivateRoute>} />
          <Route path="/my-day"             element={<PrivateRoute page="myWork"><EngineerHub /></PrivateRoute>} />
          <Route path="/profile"             element={<PrivateRoute page="profile"><Profile /></PrivateRoute>} />
          <Route path="/customer-responses"  element={<PrivateRoute page="responses"><CustomerResponses /></PrivateRoute>} />
          <Route path="/activity-log"        element={<PrivateRoute page="activities"><ActivityLog /></PrivateRoute>} />
          <Route path="/service-operations"  element={<PrivateRoute page="serviceOperations"><ServiceOperations /></PrivateRoute>} />
          <Route path="/customers/:id/service-profile" element={<PrivateRoute allowedRoles={['manager','engineer','planner']}><CustomerServiceProfile /></PrivateRoute>} />
          <Route path="*" element={<PrivateRoute><PageState title="Page not found" description="This page may have moved, or the link may be incorrect." /></PrivateRoute>} />
        </Routes>
      </BrowserRouter>
      </StatusProvider>
      </ConfirmProvider>
      </ToastProvider>
    </AuthContext.Provider>
  );
}
