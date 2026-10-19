import { lazy, Suspense, useEffect, useState } from 'react';
import { FolderKanban, Users as UsersIcon, ShieldCheck, HardDrive, ScrollText, Globe, LayoutDashboard, Tag, Building2, AtSign } from 'lucide-react';
import { PageHeader } from '../components/PageLayout';
import ErrorBoundary from '../components/ErrorBoundary';
import { TabPanel, Tabs } from '../components/EnterpriseUI';
import { api } from '../api';
import { useAuth } from '../App';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
// Each section loads when it is opened, so Settings does not download every one up front.
const UsersTab = lazy(() => import('./admin/UsersTab').then(module => ({ default: module.UsersTab })));
const OverviewTab = lazy(() => import('./admin/OverviewTab').then(module => ({ default: module.OverviewTab })));
const IntegrationsTab = lazy(() => import('./admin/IntegrationsTab').then(module => ({ default: module.IntegrationsTab })));
const WeeklyReportTab = lazy(() => import('./admin/WeeklyReportTab').then(module => ({ default: module.WeeklyReportTab })));
const EmailSettingsTab = lazy(() => import('./admin/EmailSettingsTab').then(module => ({ default: module.EmailSettingsTab })));
const StatusManagementTab = lazy(() => import('./admin/StatusManagementTab').then(module => ({ default: module.StatusManagementTab })));
const LocalizationTab = lazy(() => import('./admin/LocalizationTab').then(module => ({ default: module.LocalizationTab })));
const AdminAlertsTab = lazy(() => import('./admin/AlertsLoggingTab').then(module => ({ default: module.AdminAlertsTab })));
const SystemHealthTab = lazy(() => import('./admin/SystemTabs').then(module => ({ default: module.SystemHealthTab })));
const AuditLogTab = lazy(() => import('./admin/SystemTabs').then(module => ({ default: module.AuditLogTab })));
const SecurityTab = lazy(() => import('./admin/SystemTabs').then(module => ({ default: module.SecurityTab })));
const ServiceActivityAdminTab = lazy(() => import('./admin/ServiceActivityAdmin').then(module => ({ default: module.ServiceActivityAdminTab })));
const TeamsAdminSection = lazy(() => import('./admin/ServiceActivityAdmin').then(module => ({ default: module.TeamsAdminSection })));
const ActivityBotSettings = lazy(() => import('./admin/ActivityBotSettings').then(module => ({ default: module.ActivityBotSettings })));
const SsoSettings = lazy(() => import('./admin/SsoSettings').then(module => ({ default: module.SsoSettings })));
const ManagedReportTemplatesTab = lazy(() => import('./admin/ManagedReportTemplatesTab').then(module => ({ default: module.ManagedReportTemplatesTab })));
const PermissionsTab = lazy(() => import('./admin/PermissionsTab').then(module => ({ default: module.PermissionsTab })));
const TicketingSettings = lazy(() => import('./admin/TicketingSettings'));
const BackupsTab = lazy(() => import('./admin/BackupsTab').then(module => ({ default: module.BackupsTab })));
const SlaSettingsTab = lazy(() => import('./admin/SlaSettingsTab').then(module => ({ default: module.SlaSettingsTab })));
const ContractTypesTab = lazy(() => import('./admin/ContractTypesTab').then(module => ({ default: module.ContractTypesTab })));
const GrafanaTab = lazy(() => import('./admin/GrafanaTab').then(module => ({ default: module.GrafanaTab })));
const StorageTab = lazy(() => import('./admin/StorageTab').then(module => ({ default: module.StorageTab })));
const VisitChecklistsTab = lazy(() => import('./admin/VisitChecklistsTab').then(module => ({ default: module.VisitChecklistsTab })));
const Templates = lazy(() => import('./Templates'));

/* ── MAIN PAGE ───────────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */
// The sections (each was a page of its own before; their addresses still work).
const SECTIONS = {
  overview: { label: 'Overview', desc: 'Health, activity, and items that need a manager' },
  users: { label: 'Users', desc: 'Accounts, roles, activation, passwords, and 2FA exceptions' },
  teams: { label: 'Teams', desc: 'Teams, their members and activity tracking' },
  permissions: { label: 'Permissions', desc: 'What each role may do, and exceptions for individual people' },
  security: { label: 'Sign-in & passwords', desc: 'Microsoft 365 sign-in, password expiry and reset policy' },
  service_activity_tracking: { label: 'Activity categories', desc: 'Categories, subcategories and technologies engineers choose when logging activities' },
  statuses: { label: 'Project statuses', desc: 'Project status names, colours and workflow rules' },
  contract_types: { label: 'Contract types', desc: 'The contract types offered for managed customers, such as 24x7 or 8x5' },
  sla: { label: 'SLAs', desc: 'Which SLAs apply and their time limits' },
  project_templates: { label: 'Project templates', desc: 'Reusable project structures with their default tasks' },
  visit_checklists: { label: 'Visit checklists', desc: 'What engineers check on a maintenance visit, step by step' },
  managed_report_templates: { label: 'Customer report template', desc: 'The company template for the reports we send to customers: wording, colour, default sections and Word layout' },
  weekly_report: { label: 'Weekly report', desc: 'When the weekly report is sent, to whom, and a preview' },
  email: { label: 'Email (SMTP)', desc: 'The mail server for every email the app sends: reports, reminders, password resets' },
  notifications: { label: 'Notifications', desc: 'The shared Teams channel and Webex space, which events they receive, and alerts about the system' },
  ticketing: { label: 'Request Tracker', desc: 'The connection, customer queues, engineers, status mapping and sync health' },
  grafana: { label: 'Grafana devices', desc: 'Device versions and models from Grafana, matched to customer assets' },
  activity_bot: { label: 'Activity bot', desc: 'Engineers log service activities by chatting with a Webex or Teams bot' },
  localization: { label: 'Time & region', desc: 'Time zone, server clock, language and date formats' },
  backups: { label: 'Backups', desc: 'Automatic database backups, checks, download and restore' },
  storage: { label: 'Storage', desc: 'How long customer report files are kept, and what is stored' },
  system_health: { label: 'System health', desc: 'Status, deployment, logging, updates and data export' },
  audit_log: { label: 'Audit log', desc: 'Who changed what, and when' },
};

// Ten pages: related settings share one page, one section under the other.
const TABS = [
  { key: 'overview', label: 'Overview', Icon: LayoutDashboard, group: 'overview', desc: SECTIONS.overview.desc, sections: ['overview'] },
  { key: 'users', label: 'Users & teams', Icon: UsersIcon, group: 'people', desc: 'Accounts and roles, and the teams they work in', sections: ['users', 'teams'] },
  { key: 'access', label: 'Access & sign-in', Icon: ShieldCheck, group: 'people', desc: 'What each role may do, Microsoft 365 sign-in and password rules', sections: ['permissions', 'security'] },
  { key: 'lists', label: 'Lists', Icon: Tag, group: 'work', desc: 'Activity categories, project statuses, contract types and SLAs', sections: ['service_activity_tracking', 'statuses', 'contract_types', 'sla'] },
  { key: 'templates', label: 'Templates', Icon: FolderKanban, group: 'work', desc: 'Project templates, visit checklists and the customer report template', sections: ['project_templates', 'visit_checklists', 'managed_report_templates'] },
  { key: 'weekly_report', label: 'Weekly report', Icon: ScrollText, group: 'work', desc: SECTIONS.weekly_report.desc, sections: ['weekly_report'] },
  { key: 'messages', label: 'Email & notifications', Icon: AtSign, group: 'connections', desc: 'The mail server, the shared Teams and Webex channels, and alerts about the system', sections: ['email', 'notifications'] },
  { key: 'integrations', label: 'Integrations', Icon: Building2, group: 'connections', desc: 'Request Tracker, Grafana devices and the activity bot', sections: ['ticketing', 'grafana', 'activity_bot'] },
  { key: 'localization', label: 'Time & region', Icon: Globe, group: 'system', desc: SECTIONS.localization.desc, sections: ['localization'] },
  { key: 'system', label: 'Backups & health', Icon: HardDrive, group: 'system', desc: 'Backups, storage, system health and the audit log', sections: ['backups', 'storage', 'system_health', 'audit_log'] },
];
// The page each section is on.
const PAGE_OF = Object.fromEntries(TABS.flatMap(page => page.sections.map(key => [key, page.key])));

const TAB_GROUPS = [
  { key: 'overview',    label: 'Overview' },
  { key: 'people',      label: 'People' },
  { key: 'work',        label: 'How we work' },
  { key: 'connections', label: 'Connections' },
  { key: 'system',      label: 'Organisation & system' },
];

// Old section names → where that content lives now ([tab, part] or a page path).
const MOVED = {
  managed_services: ['ticketing'],
  admin_alerts: ['notifications'],
  activity: ['audit_log'],
  logging: ['system_health', 'logging'],
  stats: ['system_health', 'stats'],
  deployment: ['system_health', 'deployment'],
  system_update: ['system_health', 'updates'],
  export: ['system_health', 'export'],
  projects: '/projects',
  maintenance: '/maintenance-visits',
};

const TAB_KEYS = new Set(TABS.map(t => t.key));

const STATUS_STYLES = {
  ok:      { label: 'OK',     color: 'var(--tone-success-text)', bg: 'var(--success-light)' },
  warning: { label: 'Review', color: 'var(--tone-warning-text)', bg: 'var(--warning-light)' },
  error:   { label: 'Issue',  color: 'var(--tone-danger-text)',  bg: 'var(--danger-light)' },
};

function SettingsStatusPill({ status }) {
  if (!status) return null;
  const s = STATUS_STYLES[status] || STATUS_STYLES.warning;
  return (
    <span className="u-f29654b" style={{ background: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}

export default function AdminPanel() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { section } = useParams();
  const location = useLocation();
  const part = new URLSearchParams(location.search).get('part');
  const initialTab = TAB_KEYS.has(section) ? section : PAGE_OF[section] || 'overview';
  const [tab, setTab] = useState(initialTab);
  // The section shown on a page with several (its tab); null = the page's first.
  const [focus, setFocus] = useState(TAB_KEYS.has(section) ? null : section || null);
  const [tabSearch, setTabSearch] = useState('');
  const [sectionStatus, setSectionStatus] = useState({});

  useEffect(() => {
    if (!section) { setTab('overview'); return; }
    const moved = MOVED[section];
    if (typeof moved === 'string') { navigate(moved, { replace: true }); return; }
    if (moved) { navigate(`/settings/${moved[0]}${moved[1] ? `?part=${moved[1]}` : ''}`, { replace: true }); return; }
    if (TAB_KEYS.has(section)) { setTab(section); setFocus(null); return; }
    // A section's own address (e.g. /settings/teams): its page, with that tab open.
    if (PAGE_OF[section]) { setTab(PAGE_OF[section]); setFocus(section); return; }
    navigate('/settings', { replace: true });
  }, [section, navigate]);

  useEffect(() => {
    let mounted = true;
    Promise.allSettled([api.deploymentHealth(), api.getSecuritySettings()])
      .then(([deployment, security]) => {
        if (!mounted) return;
        const next = {};
        next.system = deployment.status === 'fulfilled' ? deployment.value?.status || 'warning' : 'warning';
        next.access = security.status === 'fulfilled' && Number(security.value?.password_expiry_days ?? 0) > 0 ? 'ok' : 'warning';
        setSectionStatus(next);
      });
    return () => { mounted = false; };
  }, []);

  // A page, optionally at one of its sections; each has its own address.
  function selectTab(key, sectionKey = null) {
    const page = TABS.find(t => t.key === key);
    const first = !sectionKey || sectionKey === page?.sections[0];
    setTab(key); setFocus(first ? null : sectionKey);
    navigate(key === 'overview' ? '/settings' : `/settings/${first ? key : sectionKey}`);
  }

  const activeTab = TABS.find(t => t.key === tab) || TABS[0];
  const activeSection = focus && activeTab.sections.includes(focus) ? focus : activeTab.sections[0];
  function renderSection(key) {
    switch (key) {
      case 'overview': return <OverviewTab />;
      case 'users': return <UsersTab currentUser={user} />;
      case 'teams': return <TeamsAdminSection />;
      case 'permissions': return <PermissionsTab />;
      case 'security': return <><SsoSettings /><SecurityTab /></>;
      case 'service_activity_tracking': return <ServiceActivityAdminTab />;
      case 'statuses': return <StatusManagementTab />;
      case 'contract_types': return <ContractTypesTab />;
      case 'sla': return <SlaSettingsTab />;
      case 'project_templates': return <Templates embedded />;
      case 'visit_checklists': return <VisitChecklistsTab />;
      case 'managed_report_templates': return <ManagedReportTemplatesTab />;
      case 'weekly_report': return <WeeklyReportTab />;
      case 'email': return <EmailSettingsTab />;
      case 'notifications': return <><IntegrationsTab /><h4 className="settings-subheading">Alerts about the system</h4><AdminAlertsTab /></>;
      case 'ticketing': return <TicketingSettings />;
      case 'grafana': return <GrafanaTab />;
      case 'activity_bot': return <ActivityBotSettings sectionStyle={{ background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 10, padding: '20px 24px', marginBottom: 20 }} />;
      case 'localization': return <LocalizationTab />;
      case 'backups': return <BackupsTab />;
      case 'storage': return <StorageTab />;
      case 'system_health': return <SystemHealthTab key={part || 'stats'} initial={part} />;
      case 'audit_log': return <AuditLogTab />;
      default: return null;
    }
  }
  const q = tabSearch.trim().toLowerCase();
  const filteredTabs = TABS.filter(t => !q || [t.label, t.desc, ...t.sections.map(key => SECTIONS[key].label)].some(text => text.toLowerCase().includes(q)));

  return (
    <div className="page">
      <PageHeader title="Settings" />

      <div className="settings-shell">
        <aside className="settings-nav" aria-label="Settings sections">
          <select className="settings-nav-select" aria-label="Settings section" value={tab} onChange={event => selectTab(event.target.value)}>
            {TAB_GROUPS.map(group => <optgroup key={group.key} label={group.label}>{TABS.filter(t => t.group === group.key).map(t => <option key={t.key} value={t.key}>{t.label}</option>)}</optgroup>)}
          </select>
          <div className="settings-search">
            <input
              value={tabSearch}
              onChange={e => setTabSearch(e.target.value)}
              placeholder="Search settings"
              aria-label="Search settings"
            />
          </div>

          {TAB_GROUPS.map(group => {
            const groupTabs = filteredTabs.filter(t => t.group === group.key);
            if (!groupTabs.length) return null;
            return (
              <div key={group.key} className="settings-nav-group">
                {/* Overview stands alone; a heading would only repeat it. */}
                {group.key !== 'overview' && <div className="settings-nav-heading">{group.label}</div>}
                {groupTabs.map(({ key, label, Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => selectTab(key, q ? TABS.find(t => t.key === key).sections.find(s => SECTIONS[s].label.toLowerCase().includes(q)) : null)}
                    aria-current={tab===key ? 'page' : undefined}
                    className={'settings-nav-item' + (tab === key ? ' active' : '')}
                  >
                    <Icon size={16} />
                    <span>{label}</span>
                    <SettingsStatusPill status={sectionStatus[key]} />
                  </button>
                ))}
              </div>
            );
          })}

          {filteredTabs.length === 0 && (
            <p className="text-sm text-muted u-cfa1ecf">No settings matched.</p>
          )}
        </aside>

        <section className="settings-content">
          <div className="settings-content-header">
            <div>
              <h2>{activeTab.label}</h2>
              <p>{activeTab.desc}</p>
            </div>
            <SettingsStatusPill status={sectionStatus[activeTab.key]} />
          </div>

          {/* A page with several sections shows them as tabs, one on screen at a time. */}
          {activeTab.sections.length > 1 && <Tabs variant="line" className="settings-section-tabs" label={`${activeTab.label} sections`}
            items={activeTab.sections.map(key => ({ key, label: SECTIONS[key].label }))} value={activeSection} onChange={key => selectTab(activeTab.key, key)} />}
          <Suspense fallback={<p className="text-muted" role="status">Loading…</p>}>
          {activeTab.sections.length > 1
            ? <TabPanel label={`${activeTab.label} sections`} value={activeSection} className="settings-section">
                <p className="text-sm text-muted settings-section-desc">{SECTIONS[activeSection].desc}</p>
                <ErrorBoundary compact what={SECTIONS[activeSection].label} resetKey={`${tab}:${activeSection}`}>{renderSection(activeSection)}</ErrorBoundary>
              </TabPanel>
            : <ErrorBoundary compact what={SECTIONS[activeSection].label} resetKey={tab}>{renderSection(activeSection)}</ErrorBoundary>}
          </Suspense>
        </section>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .settings-section + .settings-section { margin-top: 28px; padding-top: 20px; border-top: 1px solid var(--gray-200); }
        .settings-section-tabs { margin-bottom: 4px; }
        .settings-section-desc { margin: 10px 0 16px; }
        .settings-shell {
          display: grid;
          grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
          gap: 20px;
          align-items: start;
          margin-top: 18px;
        }
        .settings-nav {
          position: sticky;
          top: 18px;
          align-self: start;
          border: 1px solid var(--gray-200);
          border-radius: 8px;
          background: var(--surface);
          padding: 12px;
          max-height: calc(100vh - 36px);
          overflow-y: auto;
        }
        .settings-search input {
          width: 100%;
          font-size: 13px;
          margin-bottom: 12px;
        }
        .settings-nav-group + .settings-nav-group { margin-top: 14px; }
        .settings-subheading { font-size: 15px; font-weight: 700; margin: 28px 0 12px; }
        .sso-settings { padding: 18px 20px; margin-bottom: 20px; display: grid; gap: 10px; }
        .sso-settings header { display: flex; justify-content: space-between; align-items: center; }
        .sso-settings h3 { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 15px; }
        .sso-settings h4 { margin: 8px 0 0; font-size: 13px; }
        .sso-copy { display: grid; grid-template-columns: minmax(180px, 260px) 1fr auto; align-items: center; gap: 8px; font-size: 13px; }
        .sso-copy code { overflow-wrap: anywhere; background: var(--gray-50); padding: 4px 8px; border-radius: 6px; }
        .sso-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; color: var(--gray-600); }
        .sso-actions { display: flex; gap: 8px; }
        .sso-status { border-top: 1px solid var(--gray-200); padding-top: 8px; }
        .sso-status p { margin: 2px 0; }
        @media (max-width: 720px) { .sso-copy { grid-template-columns: 1fr auto; } .sso-copy span { grid-column: 1 / -1; } }
        .settings-nav-heading {
          padding: 0 6px 6px;
          color: var(--gray-500);
          font-size: 10px;
          font-weight: 800;
          letter-spacing: .04em;
          text-transform: uppercase;
        }
        .settings-nav-item {
          width: 100%;
          min-height: 38px;
          display: grid;
          grid-template-columns: 18px minmax(0, 1fr) auto;
          align-items: center;
          gap: 8px;
          border: 1px solid transparent;
          border-radius: 6px;
          background: transparent;
          color: var(--gray-600);
          cursor: pointer;
          font-size: 13px;
          font-weight: 650;
          padding: 8px 9px;
          text-align: left;
        }
        .settings-nav-item span {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .settings-nav-item:hover {
          background: var(--gray-50);
          color: var(--gray-800);
        }
        .settings-nav-item.active {
          background: var(--primary-light);
          border-color: var(--primary-ring);
          color: var(--primary);
        }
        .settings-content { min-width: 0; }
        .settings-content-header {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 12px;
          align-items: center;
          margin-bottom: 16px;
          padding-bottom: 14px;
          border-bottom: 1px solid var(--gray-100);
        }
        .settings-content-header h2 {
          margin: 0;
          font-size: 20px;
          line-height: 1.2;
        }
        .settings-content-header p {
          margin: 3px 0 0;
          color: var(--gray-500);
          font-size: 13px;
        }
        @media (max-width: 900px) {
          .settings-shell { grid-template-columns: 1fr; }
          .settings-nav {
            position: static;
            max-height: none;
            overflow: visible;
          }
          /* Phones: one dropdown instead of the full list above the content. */
          .settings-nav > :not(.settings-nav-select) { display: none; }
          .settings-nav-select { display: block !important; }
        }
        .settings-nav-select { display: none; width: 100%; }
      `}</style>
    </div>
  );
}
