import { useEffect, useState } from 'react';
import { Users as UsersIcon, Shield, ShieldCheck, FolderOpen, Wrench, ClipboardList, HardDrive, ScrollText, Activity, Settings, Download, BarChart3, ShieldAlert, Globe, Database, FileSpreadsheet, LayoutDashboard, Tag } from 'lucide-react';
import { api } from '../api';
import { visiblePages } from '../navigation';
import { useAuth } from '../App';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { UsersTab } from './admin/UsersTab';
import { OverviewTab, StatsTab, ActivityTab } from './admin/OverviewTab';
import { ProjectsAdminTab, MaintenanceAdminTab, DataExportTab } from './admin/DataTabs';
import { IntegrationsTab } from './admin/IntegrationsTab';
import { WeeklyReportTab } from './admin/WeeklyReportTab';
import { StatusManagementTab } from './admin/StatusManagementTab';
import { LocalizationTab } from './admin/LocalizationTab';
import { AdminAlertsTab, LoggingTab } from './admin/AlertsLoggingTab';
import { DeploymentHealthTab, SystemUpdateTab, AuditLogTab, SecurityTab } from './admin/SystemTabs';
import { ServiceActivityAdminTab } from './admin/ServiceActivityAdmin';
import { ManagedReportTemplatesTab } from './admin/ManagedReportTemplatesTab';
import { PermissionsTab } from './admin/PermissionsTab';

/* ── MAIN PAGE ───────────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════ */
const TABS = [
  { key: 'overview',       label: 'Overview',           Icon: LayoutDashboard, group: 'overview',      desc: 'Health, activity, and manager attention items' },
  { key: 'users',          label: 'Users & Access',     Icon: UsersIcon,       group: 'business_people',        desc: 'Accounts, roles, activation, passwords, and 2FA exceptions' },
  { key: 'permissions',    label: 'Permissions',        Icon: ShieldCheck,     group: 'business_people',        desc: 'Role capabilities and explicit user access exceptions' },
  { key: 'projects',       label: 'Projects',           Icon: FolderOpen,      group: 'business_people',        desc: 'Project administration and status visibility' },
  { key: 'maintenance',    label: 'Maintenance Visits', Icon: Wrench,          group: 'business_people',        desc: 'Visit administration and report status' },
  { key: 'statuses',       label: 'Status Workflow',    Icon: Tag,             group: 'business_rules', desc: 'Project status labels, colors, and workflow rules' },
  { key: 'service_activity_tracking', label: 'Service Activity Tracking', Icon: ClipboardList, group: 'business_rules', desc: 'Teams, activity categories, technologies, and MSP operations log settings' },
  { key: 'managed_report_templates', label: 'Managed Report Templates', Icon: FileSpreadsheet, group: 'business_rules', desc: 'Reusable sections and default narrative for customer reports' },
  { key: 'integrations',   label: 'Integrations',       Icon: Globe,           group: 'technical_configuration', desc: 'External service and SMTP configuration' },
  { key: 'weekly_report',  label: 'Weekly Report',      Icon: ScrollText,      group: 'technical_configuration', desc: 'Report schedule, recipients, and preview' },
  { key: 'localization',   label: 'Localization',       Icon: Globe,           group: 'technical_configuration', desc: 'Language and regional settings' },
  { key: 'security',       label: 'Security Policy',    Icon: Shield,          group: 'technical_security',      desc: 'Password expiry and reset policy' },
  { key: 'audit_log',      label: 'Audit Log',          Icon: ClipboardList,   group: 'technical_security',      desc: 'Traceable record of system changes' },
  { key: 'logging',        label: 'Logging',            Icon: Database,        group: 'technical_security',      desc: 'Application logging and retention settings' },
  { key: 'admin_alerts',   label: 'System Alerts',      Icon: ShieldAlert,     group: 'technical_security',      desc: 'Manager alert preferences for operational issues' },
  { key: 'stats',          label: 'System Stats',       Icon: BarChart3,       group: 'technical_operations',    desc: 'Database, storage, and usage metrics' },
  { key: 'activity',       label: 'Activity Feed',      Icon: Activity,        group: 'technical_operations',    desc: 'Recent application activity' },
  { key: 'deployment',     label: 'Deployment Health',  Icon: HardDrive,       group: 'technical_operations',    desc: 'Runtime configuration and deploy status checks' },
  { key: 'export',         label: 'Data Export',        Icon: FileSpreadsheet, group: 'technical_operations',    desc: 'Download operational data' },
  { key: 'system_update',  label: 'System Update',      Icon: Download,        group: 'technical_operations',    desc: 'Controlled application update workflow' },
];

const TAB_GROUPS = [
  { key: 'overview',label: 'Overview',area: 'overview' },
  { key: 'business_people',label: 'Business / People & Work',area: 'business' },
  { key: 'business_rules',label: 'Business / Workflow & Service Rules',area: 'business' },
  { key: 'technical_configuration',label: 'Technical / Application & Delivery',area: 'technical' },
  { key: 'technical_security',label: 'Technical / Security & Audit',area: 'technical' },
  { key: 'technical_operations',label: 'Technical / System Operations',area: 'technical' },
];

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
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      padding: '1px 6px', borderRadius: 999, background: s.bg, color: s.color,
      fontSize: 10, fontWeight: 800, lineHeight: 1.5, whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  );
}

export default function AdminPanel() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { section } = useParams();
  const initialTab = TAB_KEYS.has(section) ? section : 'overview';
  const [tab, setTab] = useState(initialTab);
  const [tabSearch, setTabSearch] = useState('');
  const [sectionStatus, setSectionStatus] = useState({});

  useEffect(() => {
    if (!section) { setTab('overview'); return; }
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
          next.deployment = deployment.value?.status || 'warning';
        } else {
          next.deployment = 'warning';
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
  const activeArea = activeGroup?.area || 'overview';
  const businessLinks = visiblePages(user.role).filter(page => ['customers','templates','workload','approvals','reports'].includes(page.id));
  const q = tabSearch.trim().toLowerCase();
  const filteredTabs = TABS.filter(t => !q || t.label.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q));
  const ActiveIcon = activeTab.Icon;

  return (
    <div className="page">
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Settings size={22} /> Settings
          </h1>
          <p className="text-sm text-muted mt-4">System configuration, access control, security, and operations</p>
        </div>
        <div style={{ fontSize: 12, color: 'var(--gray-400)', textAlign: 'right' }}>
          Signed in as<br /><strong style={{ color: 'var(--gray-700)' }}>{user.name}</strong>
        </div>
      </div>

      <div className="settings-shell">
        <aside className="settings-nav" aria-label="Settings sections">
          <div aria-label="Administration areas" style={{ display: 'flex',flexWrap: 'wrap',gap: 6,marginBottom: 12 }}>
            {[['overview','Overview','overview'],['business','Business','users'],['technical','Technical','integrations']].map(([area,label,first]) => <button key={area} type="button" className={'btn btn-sm '+(area===activeArea ? 'btn-primary' : 'btn-ghost')} aria-pressed={area===activeArea} onClick={() => { setTabSearch(''); selectTab(first); }}>{label}</button>)}
          </div>
          <div className="settings-search">
            <input
              value={tabSearch}
              onChange={e => setTabSearch(e.target.value)}
              placeholder="Search settings"
              aria-label="Search settings"
            />
          </div>

          {TAB_GROUPS.map(group => {
            if (!q && group.area!==activeArea) return null;
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

          {activeArea==='business' && !q && <div className="settings-nav-group"><div className="settings-nav-heading">Business modules</div>{businessLinks.map(page => <Link className="settings-nav-item" key={page.id} to={page.path} style={{ display: 'block' }}>{page.label}</Link>)}</div>}
          {filteredTabs.length === 0 && (
            <p className="text-sm text-muted" style={{ padding: '8px 10px' }}>No settings matched.</p>
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
          {tab === 'permissions'  && <PermissionsTab />}
          {tab === 'projects'     && <ProjectsAdminTab />}
          {tab === 'maintenance'  && <MaintenanceAdminTab />}
          {tab === 'statuses'     && <StatusManagementTab />}
          {tab === 'service_activity_tracking' && <ServiceActivityAdminTab />}
          {tab === 'managed_report_templates' && <ManagedReportTemplatesTab />}
          {tab === 'stats'        && <StatsTab />}
          {tab === 'activity'     && <ActivityTab />}
          {tab === 'export'       && <DataExportTab />}
          {tab === 'integrations'  && <IntegrationsTab />}
          {tab === 'weekly_report' && <WeeklyReportTab />}
          {tab === 'logging'       && <LoggingTab />}
          {tab === 'localization'  && <LocalizationTab />}
          {tab === 'admin_alerts'  && <AdminAlertsTab />}
          {tab === 'deployment'    && <DeploymentHealthTab />}
          {tab === 'system_update' && <SystemUpdateTab />}
          {tab === 'audit_log'     && <AuditLogTab />}
          {tab === 'security'      && <SecurityTab />}
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
        .settings-nav-heading {
          padding: 0 6px 6px;
          color: var(--gray-400);
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
          background: #eff6ff;
          border-color: #bfdbfe;
          color: var(--primary);
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
          background: #eff6ff;
          color: var(--primary);
        }
        .settings-content-kicker {
          color: var(--gray-400);
          font-size: 11px;
          font-weight: 800;
          letter-spacing: .04em;
          text-transform: uppercase;
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
