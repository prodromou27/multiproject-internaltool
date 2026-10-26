const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/UsersTab-Bg4GWq6S.js","assets/rolldown-runtime-XKyaHtl9.js","assets/vendor-react-BoJnQ0SH.js","assets/vendor-charts-DIqo_6-P.js","assets/api-BPmMYdp3.js","assets/vendor-lucide-CKjQQtJA.js","assets/index-C_yk7Cxv.js","assets/dates-d7RNqBmb.js","assets/useStatuses-B-R-ncdN.js","assets/index-Dcfj0UiO.css","assets/shared-BUqlVqvH.js","assets/OverviewTab-fPibQQQ_.js","assets/EnterpriseUI-BnUHf0Ip.js","assets/EnterpriseUI-BS22Rhqs.css","assets/IntegrationsTab-Bhs6-ZNg.js","assets/WeeklyReportTab-j20aBUW1.js","assets/LoadError-Bhj1JC0-.js","assets/EmailSettingsTab-BrYc3SoJ.js","assets/StatusManagementTab-BTF4Bs4r.js","assets/LocalizationTab-BDe3LUWa.js","assets/AlertsLoggingTab-DOaP4Kk8.js","assets/SystemTabs-BZY1qrDC.js","assets/ServiceActivityAdmin-BZruz-ZY.js","assets/CheckList-DLRjG_0Q.js","assets/ActivityBotSettings-B7CnHZ8e.js","assets/SsoSettings-jdEAWmv2.js","assets/ManagedReportTemplatesTab-Ty3QK75A.js","assets/ManagedReportTemplatesTab-JY-UYSeM.css","assets/PermissionsTab-DdoKJALt.js","assets/TicketingSettings-C8a1yTsg.js","assets/useSavedFilter-DcmS6R76.js","assets/BackupsTab-B5u6y9fX.js","assets/BackupsTab-BPFU5vEt.css","assets/SlaSettingsTab-BOyoIbhn.js","assets/ContractTypesTab--jrsXXFG.js","assets/GrafanaTab-Dp3leusH.js","assets/StorageTab-DSodt9tM.js","assets/VisitChecklistsTab-CQds6cyc.js","assets/Templates-B7Uq2t20.js"])))=>i.map(i=>d[i]);
import{n as e,r as t}from"./rolldown-runtime-XKyaHtl9.js";import{u as n}from"./vendor-react-BoJnQ0SH.js";import{v as r}from"./vendor-charts-DIqo_6-P.js";import{t as i}from"./api-BPmMYdp3.js";import{Ct as a,M as o,Ot as s,T as c,Tn as l,_ as u,_n as d,i as f,pt as p,yt as m}from"./vendor-lucide-CKjQQtJA.js";import{A as ee,M as te,P as h,S as g,j as ne,n as re,w as ie,x as _}from"./index-C_yk7Cxv.js";import{o as ae,s as v}from"./EnterpriseUI-BnUHf0Ip.js";import{n as y}from"./shared-BUqlVqvH.js";var b=t(r(),1),x=n();function oe(){let e=_(),[t,n]=(0,b.useState)(null),[r,a]=(0,b.useState)(!1);(0,b.useEffect)(()=>{i.customerEmailSetting().then(e=>n(!!e?.enabled)).catch(()=>n(null))},[]);async function o(t){a(!0);try{n((await i.saveCustomerEmailSetting(t)).enabled),e.success(t?`Emails to customers are on`:`Emails to customers are off`)}catch(t){e.error(t.message)}finally{a(!1)}}return t===null?null:(0,x.jsxs)(`section`,{className:`card`,"aria-label":`Emails to customers`,style:{padding:`16px 20px`,marginTop:20},children:[(0,x.jsx)(`h3`,{className:`settings-subheading`,style:{marginTop:0},children:`Emails to customers`}),(0,x.jsx)(y,{checked:t,onChange:o,disabled:r,label:t?`On: responses can be emailed to a customer’s contact`:`Off: nothing is emailed to customers`}),(0,x.jsx)(`p`,{className:`text-sm text-muted`,style:{marginBottom:0},children:`No report is ever sent to a customer automatically. While this is off, responses can only be copied, not emailed, and customer reports are shared by hand.`})]})}var S=e({default:()=>$}),se=(0,b.lazy)(()=>h(()=>import(`./UsersTab-Bg4GWq6S.js`).then(e=>({default:e.UsersTab})),__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10]))),C=(0,b.lazy)(()=>h(()=>import(`./OverviewTab-fPibQQQ_.js`).then(e=>({default:e.OverviewTab})),__vite__mapDeps([11,1,2,3,4,5,6,7,8,9,12,13,10]))),w=(0,b.lazy)(()=>h(()=>import(`./IntegrationsTab-Bhs6-ZNg.js`).then(e=>({default:e.IntegrationsTab})),__vite__mapDeps([14,1,2,3,4,5,6,7,8,9,10]))),T=(0,b.lazy)(()=>h(()=>import(`./WeeklyReportTab-j20aBUW1.js`).then(e=>({default:e.WeeklyReportTab})),__vite__mapDeps([15,1,2,3,4,5,6,7,8,9,16]))),E=(0,b.lazy)(()=>h(()=>import(`./EmailSettingsTab-BrYc3SoJ.js`).then(e=>({default:e.EmailSettingsTab})),__vite__mapDeps([17,1,2,3,4,5,6,7,8,9,16]))),D=(0,b.lazy)(()=>h(()=>import(`./StatusManagementTab-BTF4Bs4r.js`).then(e=>({default:e.StatusManagementTab})),__vite__mapDeps([18,1,2,3,4,5,8]))),O=(0,b.lazy)(()=>h(()=>import(`./LocalizationTab-BDe3LUWa.js`).then(e=>({default:e.LocalizationTab})),__vite__mapDeps([19,1,2,3,4,5,7,6,8,9,16]))),k=(0,b.lazy)(()=>h(()=>import(`./AlertsLoggingTab-DOaP4Kk8.js`).then(e=>({default:e.AdminAlertsTab})),__vite__mapDeps([20,1,2,3,4,5,6,7,8,9,10,16]))),A=(0,b.lazy)(()=>h(()=>import(`./SystemTabs-BZY1qrDC.js`).then(e=>({default:e.SystemHealthTab})),__vite__mapDeps([21,1,2,3,4,5,7,6,8,9,12,13,16,20,10,11]))),j=(0,b.lazy)(()=>h(()=>import(`./SystemTabs-BZY1qrDC.js`).then(e=>({default:e.AuditLogTab})),__vite__mapDeps([21,1,2,3,4,5,7,6,8,9,12,13,16,20,10,11]))),M=(0,b.lazy)(()=>h(()=>import(`./SystemTabs-BZY1qrDC.js`).then(e=>({default:e.SecurityTab})),__vite__mapDeps([21,1,2,3,4,5,7,6,8,9,12,13,16,20,10,11]))),N=(0,b.lazy)(()=>h(()=>import(`./ServiceActivityAdmin-BZruz-ZY.js`).then(e=>({default:e.ServiceActivityAdminTab})),__vite__mapDeps([22,1,2,3,4,5,6,7,8,9,23]))),P=(0,b.lazy)(()=>h(()=>import(`./ServiceActivityAdmin-BZruz-ZY.js`).then(e=>({default:e.TeamsAdminSection})),__vite__mapDeps([22,1,2,3,4,5,6,7,8,9,23]))),F=(0,b.lazy)(()=>h(()=>import(`./ActivityBotSettings-B7CnHZ8e.js`).then(e=>({default:e.ActivityBotSettings})),__vite__mapDeps([24,1,2,3,4,5,6,7,8,9,10]))),I=(0,b.lazy)(()=>h(()=>import(`./SsoSettings-jdEAWmv2.js`).then(e=>({default:e.SsoSettings})),__vite__mapDeps([25,1,2,3,4,5,6,7,8,9,10]))),L=(0,b.lazy)(()=>h(()=>import(`./ManagedReportTemplatesTab-Ty3QK75A.js`).then(e=>({default:e.ManagedReportTemplatesTab})),__vite__mapDeps([26,1,2,3,4,5,27]))),R=(0,b.lazy)(()=>h(()=>import(`./PermissionsTab-DdoKJALt.js`).then(e=>({default:e.PermissionsTab})),__vite__mapDeps([28,1,2,3,4,5,6,7,8,9]))),ce=(0,b.lazy)(()=>h(()=>import(`./TicketingSettings-C8a1yTsg.js`),__vite__mapDeps([29,1,2,3,4,5,6,7,8,9,30,12,13,10]))),z=(0,b.lazy)(()=>h(()=>import(`./BackupsTab-B5u6y9fX.js`).then(e=>({default:e.BackupsTab})),__vite__mapDeps([31,1,2,3,4,5,6,7,8,9,10,32]))),B=(0,b.lazy)(()=>h(()=>import(`./SlaSettingsTab-BOyoIbhn.js`).then(e=>({default:e.SlaSettingsTab})),__vite__mapDeps([33,1,2,3,4,5,6,7,8,9,10]))),V=(0,b.lazy)(()=>h(()=>import(`./ContractTypesTab--jrsXXFG.js`).then(e=>({default:e.ContractTypesTab})),__vite__mapDeps([34,1,2,3,4,5,6,7,8,9]))),H=(0,b.lazy)(()=>h(()=>import(`./GrafanaTab-Dp3leusH.js`).then(e=>({default:e.GrafanaTab})),__vite__mapDeps([35,1,2,3,4,6,5,7,8,9,16]))),U=(0,b.lazy)(()=>h(()=>import(`./StorageTab-DSodt9tM.js`).then(e=>({default:e.StorageTab})),__vite__mapDeps([36,1,2,3,4,6,5,7,8,9,16]))),W=(0,b.lazy)(()=>h(()=>import(`./VisitChecklistsTab-CQds6cyc.js`).then(e=>({default:e.VisitChecklistsTab})),__vite__mapDeps([37,1,2,3,4,6,5,7,8,9,16]))),G=(0,b.lazy)(()=>h(()=>import(`./Templates-B7Uq2t20.js`),__vite__mapDeps([38,1,2,3,4,5,6,7,8,9]))),K={overview:{label:`Overview`,desc:`Health, activity, and items that need a manager`},users:{label:`Users`,desc:`Accounts, roles, activation, passwords, and 2FA exceptions`},teams:{label:`Teams`,desc:`Teams, their members and activity tracking`},permissions:{label:`Permissions`,desc:`What each role may do, and exceptions for individual people`},security:{label:`Sign-in & passwords`,desc:`Microsoft 365 sign-in, password expiry and reset policy`},service_activity_tracking:{label:`Activity categories`,desc:`Categories, subcategories and technologies engineers choose when logging activities`},statuses:{label:`Project statuses`,desc:`Project status names, colours and workflow rules`},contract_types:{label:`Contract types`,desc:`The contract types offered for managed customers, such as 24x7 or 8x5`},sla:{label:`SLAs`,desc:`Which SLAs apply and their time limits`},project_templates:{label:`Project templates`,desc:`Reusable project structures with their default tasks`},visit_checklists:{label:`Visit checklists`,desc:`What engineers check on a maintenance visit, step by step`},managed_report_templates:{label:`Customer report template`,desc:`The company template for the reports we send to customers: wording, colour, default sections and Word layout`},weekly_report:{label:`Weekly report`,desc:`When the weekly report is sent, to whom, and a preview`},email:{label:`Email (SMTP)`,desc:`The mail server for every email the app sends: reports, reminders, password resets`},notifications:{label:`Notifications`,desc:`The shared Teams channel and Webex space, which events they receive, and alerts about the system`},ticketing:{label:`Request Tracker`,desc:`The connection, customer queues, engineers, status mapping and sync health`},grafana:{label:`Grafana devices`,desc:`Device versions and models from Grafana, matched to customer assets`},activity_bot:{label:`Activity bot`,desc:`Engineers log service activities by chatting with a Webex or Teams bot`},localization:{label:`Time & region`,desc:`Time zone, server clock, language and date formats`},backups:{label:`Backups`,desc:`Automatic database backups, checks, download and restore`},storage:{label:`Storage`,desc:`How long customer report files are kept, and what is stored`},system_health:{label:`System health`,desc:`Status, deployment, logging, updates and data export`},audit_log:{label:`Audit log`,desc:`Who changed what, and when`}},q=[{key:`overview`,label:`Overview`,Icon:p,group:`overview`,desc:K.overview.desc,sections:[`overview`]},{key:`users`,label:`Users & teams`,Icon:f,group:`people`,desc:`Accounts and roles, and the teams they work in`,sections:[`users`,`teams`]},{key:`access`,label:`Access & sign-in`,Icon:c,group:`people`,desc:`What each role may do, Microsoft 365 sign-in and password rules`,sections:[`permissions`,`security`]},{key:`lists`,label:`Lists`,Icon:u,group:`work`,desc:`Activity categories, project statuses, contract types and SLAs`,sections:[`service_activity_tracking`,`statuses`,`contract_types`,`sla`]},{key:`templates`,label:`Templates`,Icon:s,group:`work`,desc:`Project templates, visit checklists and the customer report template`,sections:[`project_templates`,`visit_checklists`,`managed_report_templates`]},{key:`weekly_report`,label:`Weekly report`,Icon:o,group:`work`,desc:K.weekly_report.desc,sections:[`weekly_report`]},{key:`messages`,label:`Email & notifications`,Icon:l,group:`connections`,desc:`The mail server, the shared Teams and Webex channels, and alerts about the system`,sections:[`email`,`notifications`]},{key:`integrations`,label:`Integrations`,Icon:d,group:`connections`,desc:`Request Tracker, Grafana devices and the activity bot`,sections:[`ticketing`,`grafana`,`activity_bot`]},{key:`localization`,label:`Time & region`,Icon:a,group:`system`,desc:K.localization.desc,sections:[`localization`]},{key:`system`,label:`Backups & health`,Icon:m,group:`system`,desc:`Backups, storage, system health and the audit log`,sections:[`backups`,`storage`,`system_health`,`audit_log`]}],J=Object.fromEntries(q.flatMap(e=>e.sections.map(t=>[t,e.key]))),Y=[{key:`overview`,label:`Overview`},{key:`people`,label:`People`},{key:`work`,label:`How we work`},{key:`connections`,label:`Connections`},{key:`system`,label:`Organisation & system`}],le={managed_services:[`ticketing`],admin_alerts:[`notifications`],activity:[`audit_log`],logging:[`system_health`,`logging`],stats:[`system_health`,`stats`],deployment:[`system_health`,`deployment`],system_update:[`system_health`,`updates`],export:[`system_health`,`export`],projects:`/projects`,maintenance:`/maintenance-visits`},X=new Set(q.map(e=>e.key)),Z={ok:{label:`OK`,color:`var(--tone-success-text)`,bg:`var(--success-light)`},warning:{label:`Review`,color:`var(--tone-warning-text)`,bg:`var(--warning-light)`},error:{label:`Issue`,color:`var(--tone-danger-text)`,bg:`var(--danger-light)`}};function Q({status:e}){if(!e)return null;let t=Z[e]||Z.warning;return(0,x.jsx)(`span`,{className:`u-f29654b`,style:{background:t.bg,color:t.color},children:t.label})}function $(){let{user:e}=re(),t=ne(),{section:n}=te(),r=ee(),a=new URLSearchParams(r.search).get(`part`),o=X.has(n)?n:J[n]||`overview`,[s,c]=(0,b.useState)(o),[l,u]=(0,b.useState)(X.has(n)?null:n||null),[d,f]=(0,b.useState)(``),[p,m]=(0,b.useState)({});(0,b.useEffect)(()=>{if(!n){c(`overview`);return}let e=le[n];typeof e==`string`?t(e,{replace:!0}):e?t(`/settings/${e[0]}${e[1]?`?part=${e[1]}`:``}`,{replace:!0}):X.has(n)?(c(n),u(null)):J[n]?(c(J[n]),u(n)):t(`/settings`,{replace:!0})},[n,t]),(0,b.useEffect)(()=>{let e=!0;return Promise.allSettled([i.deploymentHealth(),i.getSecuritySettings()]).then(([t,n])=>{if(!e)return;let r={};r.system=t.status===`fulfilled`&&t.value?.status||`warning`,r.access=n.status===`fulfilled`&&Number(n.value?.password_expiry_days??0)>0?`ok`:`warning`,m(r)}),()=>{e=!1}},[]);function h(e,n=null){let r=q.find(t=>t.key===e),i=!n||n===r?.sections[0];c(e),u(i?null:n),t(e===`overview`?`/settings`:`/settings/${i?e:n}`)}let _=q.find(e=>e.key===s)||q[0],y=l&&_.sections.includes(l)?l:_.sections[0];function S(t){switch(t){case`overview`:return(0,x.jsx)(C,{});case`users`:return(0,x.jsx)(se,{currentUser:e});case`teams`:return(0,x.jsx)(P,{});case`permissions`:return(0,x.jsx)(R,{});case`security`:return(0,x.jsxs)(x.Fragment,{children:[(0,x.jsx)(I,{}),(0,x.jsx)(M,{})]});case`service_activity_tracking`:return(0,x.jsx)(N,{});case`statuses`:return(0,x.jsx)(D,{});case`contract_types`:return(0,x.jsx)(V,{});case`sla`:return(0,x.jsx)(B,{});case`project_templates`:return(0,x.jsx)(G,{embedded:!0});case`visit_checklists`:return(0,x.jsx)(W,{});case`managed_report_templates`:return(0,x.jsx)(L,{});case`weekly_report`:return(0,x.jsx)(T,{});case`email`:return(0,x.jsxs)(x.Fragment,{children:[(0,x.jsx)(E,{}),(0,x.jsx)(oe,{})]});case`notifications`:return(0,x.jsxs)(x.Fragment,{children:[(0,x.jsx)(w,{}),(0,x.jsx)(`h4`,{className:`settings-subheading`,children:`Alerts about the system`}),(0,x.jsx)(k,{})]});case`ticketing`:return(0,x.jsx)(ce,{});case`grafana`:return(0,x.jsx)(H,{});case`activity_bot`:return(0,x.jsx)(F,{sectionStyle:{background:`var(--gray-50)`,border:`1px solid var(--gray-200)`,borderRadius:10,padding:`20px 24px`,marginBottom:20}});case`localization`:return(0,x.jsx)(O,{});case`backups`:return(0,x.jsx)(z,{});case`storage`:return(0,x.jsx)(U,{});case`system_health`:return(0,x.jsx)(A,{initial:a},a||`stats`);case`audit_log`:return(0,x.jsx)(j,{});default:return null}}let Z=d.trim().toLowerCase(),$=q.filter(e=>!Z||[e.label,e.desc,...e.sections.map(e=>K[e].label)].some(e=>e.toLowerCase().includes(Z)));return(0,x.jsxs)(`div`,{className:`page`,children:[(0,x.jsx)(ie,{title:`Settings`}),(0,x.jsxs)(`div`,{className:`settings-shell`,children:[(0,x.jsxs)(`aside`,{className:`settings-nav`,"aria-label":`Settings sections`,children:[(0,x.jsx)(`select`,{className:`settings-nav-select`,"aria-label":`Settings section`,value:s,onChange:e=>h(e.target.value),children:Y.map(e=>(0,x.jsx)(`optgroup`,{label:e.label,children:q.filter(t=>t.group===e.key).map(e=>(0,x.jsx)(`option`,{value:e.key,children:e.label},e.key))},e.key))}),(0,x.jsx)(`div`,{className:`settings-search`,children:(0,x.jsx)(`input`,{value:d,onChange:e=>f(e.target.value),placeholder:`Search settings`,"aria-label":`Search settings`})}),Y.map(e=>{let t=$.filter(t=>t.group===e.key);return t.length?(0,x.jsxs)(`div`,{className:`settings-nav-group`,children:[e.key!==`overview`&&(0,x.jsx)(`div`,{className:`settings-nav-heading`,children:e.label}),t.map(({key:e,label:t,Icon:n})=>(0,x.jsxs)(`button`,{type:`button`,onClick:()=>h(e,Z?q.find(t=>t.key===e).sections.find(e=>K[e].label.toLowerCase().includes(Z)):null),"aria-current":s===e?`page`:void 0,className:`settings-nav-item`+(s===e?` active`:``),children:[(0,x.jsx)(n,{size:16}),(0,x.jsx)(`span`,{children:t}),(0,x.jsx)(Q,{status:p[e]})]},e))]},e.key):null}),$.length===0&&(0,x.jsx)(`p`,{className:`text-sm text-muted u-cfa1ecf`,children:`No settings matched.`})]}),(0,x.jsxs)(`section`,{className:`settings-content`,children:[(0,x.jsxs)(`div`,{className:`settings-content-header`,children:[(0,x.jsxs)(`div`,{children:[(0,x.jsx)(`h2`,{children:_.label}),(0,x.jsx)(`p`,{children:_.desc})]}),(0,x.jsx)(Q,{status:p[_.key]})]}),_.sections.length>1&&(0,x.jsx)(v,{variant:`line`,className:`settings-section-tabs`,label:`${_.label} sections`,items:_.sections.map(e=>({key:e,label:K[e].label})),value:y,onChange:e=>h(_.key,e)}),(0,x.jsx)(b.Suspense,{fallback:(0,x.jsx)(`p`,{className:`text-muted`,role:`status`,children:`Loading…`}),children:_.sections.length>1?(0,x.jsxs)(ae,{label:`${_.label} sections`,value:y,className:`settings-section`,children:[(0,x.jsx)(`p`,{className:`text-sm text-muted settings-section-desc`,children:K[y].desc}),(0,x.jsx)(g,{compact:!0,what:K[y].label,resetKey:`${s}:${y}`,children:S(y)})]}):(0,x.jsx)(g,{compact:!0,what:K[y].label,resetKey:s,children:S(y)})})]})]}),(0,x.jsx)(`style`,{children:`
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
          max-height: calc(100vh / var(--zoom, 1) - 36px);
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
      `})]})}export{$ as default,S as t};