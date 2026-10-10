import { useEffect, useState } from 'react';
import { Users as UsersIcon, Shield, ShieldCheck, ClipboardList, HardDrive, ScrollText, Settings, Globe, FileSpreadsheet, LayoutDashboard, Tag, Building2, UsersRound, Bell, Bot, DatabaseBackup, Timer } from 'lucide-react';
import { api } from '../api';
import { visiblePages } from '../navigation';
import { useAuth } from '../App';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { UsersTab } from './admin/UsersTab';
import { OverviewTab } from './admin/OverviewTab';
import { IntegrationsTab } from './admin/IntegrationsTab';
import { WeeklyReportTab } from './admin/WeeklyReportTab';
import { StatusManagementTab } from './admin/StatusManagementTab';
import { LocalizationTab } from './admin/LocalizationTab';
import { AdminAlertsTab } from './admin/AlertsLoggingTab';
import { SystemHealthTab, AuditLogTab, SecurityTab } from './admin/SystemTabs';
import { ServiceActivityAdminTab, TeamsAdminSection } from './admin/ServiceActivityAdmin';
import { ActivityBotSettings } from './admin/ActivityBotSettings';
import { SsoSettings } from './admin/SsoSettings';
import { ManagedReportTemplatesTab } from './admin/ManagedReportTemplatesTab';
import { PermissionsTab } from './admin/PermissionsTab';
import TicketingSettings from './admin/TicketingSettings';
import { BackupsTab } from './admin/BackupsTab';
import { SlaSettingsTab } from './admin/SlaSettingsTab';

/* ── MAIN PAGE ───────────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */
const TABS = [
  { key: 'overview',       label: 'Overview',           Icon: LayoutDashboard, group: 'overview', desc: 'Health, activity, and items that need a manager' },
  { key: 'users',          label: 'Users',              Icon: UsersIcon,       group: 'people',   desc: 'Accounts, roles, activation, passwords, and 2FA exceptions' },
  { key: 'teams',          label: 'Teams',              Icon: UsersRound,      group: 'people',   desc: 'Teams, their members and activity tracking' },
  { key: 'permissions',    label: 'Permissions',        Icon: ShieldCheck,     group: 'people',   desc: 'What each role may do, and exceptions for individual people' },
  { key: 'security',       label: 'Sign-in & passwords', Icon: Shield,         group: 'people',   desc: 'Microsoft 365 sign-in, password expiry and reset policy' },
  { key: 'service_activity_tracking', label: 'Activity categories', Icon: ClipboardList, group: 'work', desc: 'Categories, subcategories and technologies engineers choose when logging activities' },
  { key: 'statuses',       label: 'Project statuses',   Icon: Tag,             group: 'work',     desc: 'Project status names, colours and workflow rules' },
  { key: 'sla',            label: 'SLAs',               Icon: Timer,           group: 'work',     desc: 'Which SLAs apply and their time limits' },
  { key: 'managed_report_templates', label: 'Customer report templates', Icon: FileSpreadsheet, group: 'work', desc: 'Word templates, sections and default text for customer reports' },
  { key: 'weekly_report',  label: 'Weekly report',      Icon: ScrollText,      group: 'work',     desc: 'When the weekly report is sent, to whom, and a preview' },
  { key: 'notifications',  label: 'Notifications',      Icon: Bell,            group: 'connections', desc: 'The shared Teams channel and Webex space, which events they receive, and alerts about the system' },
  { key: 'ticketing',      label: 'Ticketing',          Icon: Building2,       group: 'connections', desc: 'Request Tracker connection, customer queues, status mapping and sync health' },
  { key: 'activity_bot',   label: 'Activity bot',       Icon: Bot,             group: 'connections', desc: 'Engineers log service activities by chatting with a Webex or Teams bot' },
  { key: 'localization',   label: 'Time & region',      Icon: Globe,           group: 'system',   desc: 'Time zone, server clock, language and date formats' },
  { key: 'backups',        label: 'Backups',            Icon: DatabaseBackup,  group: 'system',   desc: 'Automatic database backups, checks, download and restore' },
  { key: 'audit_log',      label: 'Audit log',          Icon: ClipboardList,   group: 'system',   desc: 'Who changed what, and when' },
  { key: 'system_health',  label: 'System health',      Icon: HardDrive,       group: 'system',   desc: 'Status, deployment, logging, updates and data export' },
];

// Four plain groups. Pages that only listed data shown elsewhere (projects,
// visits, the activity feed) are gone; their old links still lead somewhere useful.
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
  integrations: ['notifications'],
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
  ok:      { label: 'OK',     color: 'var(--success)', bg: '#ecfdf5' },
  warning: { label: 'Review', color: 'var(--warning)', bg: '#fffbeb' },
  error:   { label: 'Issue',  color: 'var(--danger)',  bg: '#fef2f2' },
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
  const initialTab = TAB_KEYS.has(section) ? section : 'overview';
  const [tab, setTab] = useState(initialTab);
  const [tabSearch, setTabSearch] = useState('');
  const [sectionStatus, setSectionStatus] = useState({});

  useEffect(() => {
    if (!section) { setTab('overview'); return; }
    const moved = MOVED[section];
    if (typeof moved === 'string') { navigate(moved, { replace: true }); return; }
    if (moved) { navigate(`/settings/${moved[0]}${moved[1] ? `?part=${moved[1]}` : ''}`, { replace: true }); return; }
    if (TAB_KEYS.has(section)) setTab(section);
    else navigate('/settings', { replace: true });
  }, [section, navigate]);

  useEffect(() => {
    let mounted = true;
    Promise.allSettled([api.deploymentHealth(), api.getSecuritySettings()])
      .then(([deployment, security]) => {
        if (!mounted) return;
        const next = {};
        if (deployment.status === 'fulfilled') {
          next.system_health = deployment.value?.status || 'warning';
        } else {
          next.system_health = 'warning';
        }
        if (security.status === 'fulfilled') {
          next.security = Number(security.value?.password_expiry_days ?? 0) > 0 ? 'ok' : 'warning';
        } else {
          next.security = 'warning';
        }
        setSectionStatus(next);
      });
    return () => { mounted = false; };
  }, []);

  function selectTab(key) {
    setTab(key);
    navigate(key === 'overview' ? '/settings' : `/settings/${key}`);
  }

  const activeTab = TABS.find(t => t.key === tab) || TABS[0];
  const activeGroup = TAB_GROUPS.find(g => g.key === activeTab.group);
  const businessLinks = visiblePages(user).filter(page => ['customers','templates','workload','approvals','reports','kpiManagement'].includes(page.id));
  const q = tabSearch.trim().toLowerCase();
  const filteredTabs = TABS.filter(t => !q || t.label.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q));
  const ActiveIcon = activeTab.Icon;

  return (
    <div className="page">
      <div className="page-header u-ef0b7a1">
        <div>
          <h1 className="page-title flex-center gap-8">
            <Settings size={22} /> Settings
          </h1>
          <p className="text-sm text-muted mt-4">System configuration, access control, security, and operations</p>
        </div>
        <div className="u-f8bc0db">
          Signed in as<br /><strong className="u-3a065eb">{user.name}</strong>
        </div>
      </div>

      <div className="settings-shell">
        <aside className="settings-nav" aria-label="Settings sections">
          <div className="settings-search">
            <input
              value={tabSearch}
              onChange={e => setTabSearch(e.target.value)}
              placeholder="Search settings"
              aria-label="Search settings"
              autoFocus
            />
          </div>

          {TAB_GROUPS.map(group => {
            const groupTabs = filteredTabs.filter(t => t.group === group.key);
            if (!groupTabs.length) return null;
            return (
              <div key={group.key} className="settings-nav-group">
                <div className="settings-nav-heading">{group.label}</div>
                {groupTabs.map(({ key, label, Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => selectTab(key)}
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

          {!q && businessLinks.length > 0 && <div className="settings-nav-group"><div className="settings-nav-heading">Related pages</div>{businessLinks.map(page => <Link className="settings-nav-item" key={page.id} to={page.path} style={{ display: 'block' }}>{page.label}</Link>)}</div>}
          {filteredTabs.length === 0 && (
            <p className="text-sm text-muted u-cfa1ecf">No settings matched.</p>
          )}
        </aside>

        <section className="settings-content">
          <div className="settings-content-header">
            <div className="settings-content-icon"><ActiveIcon size={18} /></div>
            <div>
              <div className="settings-content-kicker">{activeGroup?.label || 'Settings'}</div>
              <h2>{activeTab.label}</h2>
              <p>{activeTab.desc}</p>
            </div>
            <SettingsStatusPill status={sectionStatus[activeTab.key]} />
          </div>

          {tab === 'overview'     && <OverviewTab />}
          {tab === 'users'        && <UsersTab currentUser={user} />}
          {tab === 'teams'        && <TeamsAdminSection />}
          {tab === 'permissions'  && <PermissionsTab />}
          {tab === 'statuses'     && <StatusManagementTab />}
          {tab === 'service_activity_tracking' && <ServiceActivityAdminTab />}
          {tab === 'managed_report_templates' && <ManagedReportTemplatesTab />}
          {tab === 'ticketing' && <TicketingSettings />}
          {tab === 'system_health' && <SystemHealthTab key={part || 'stats'} initial={part} />}
          {tab === 'backups' && <BackupsTab />}
          {tab === 'sla' && <SlaSettingsTab />}
          {tab === 'notifications' && <><IntegrationsTab /><h3 className="settings-subheading">Alerts about the system</h3><AdminAlertsTab /></>}
          {tab === 'activity_bot'  && <ActivityBotSettings sectionStyle={{ background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 10, padding: '20px 24px', marginBottom: 20 }} />}
          {tab === 'weekly_report' && <WeeklyReportTab />}
          {tab === 'localization'  && <LocalizationTab />}
          {tab === 'audit_log'     && <AuditLogTab />}
          {tab === 'security'      && <><SsoSettings /><SecurityTab /></>}
        </section>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
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
          background: #fff;
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
          font-size: 12px;
          font-weight: 600;
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
          background: var(--gray-100);
          border-color: transparent;
          color: var(--ink-strong);
          font-weight: 700;
        }
        .settings-content { min-width: 0; }
        .settings-content-header {
          display: grid;
          grid-template-columns: 42px minmax(0, 1fr) auto;
          gap: 12px;
          align-items: center;
          margin-bottom: 16px;
          padding-bottom: 14px;
          border-bottom: 1px solid var(--gray-100);
        }
        .settings-content-icon {
          width: 42px;
          height: 42px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--gray-100);
          color: var(--ink-strong);
        }
        .settings-content-kicker {
          color: var(--gray-500);
          font-size: 12px;
          font-weight: 600;
          margin-bottom: 2px;
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
        }
      `}</style>
    </div>
  );
}
