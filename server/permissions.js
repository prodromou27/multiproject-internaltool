const db=require('./db');

const DEFINITIONS=Object.freeze([
  { key:'managed_customers.view',group:'Managed Services',label:'View managed customers',description:'Open managed customer dashboards and report history.' },
  { key:'managed_reports.generate',group:'Managed Services',label:'Generate managed reports',description:'Create and archive Word, Excel, and PDF customer reports.' },
  { key:'managed_reports.review',group:'Managed Services',label:'Review managed reports',description:'Submit, approve, reject, finalize, and publish customer reports.' },
  { key:'kpis.view',group:'KPI Management',label:'View management KPIs',description:'View KPI dashboards, current values, and history.',eligible_roles:['manager','planner','pm'] },
  { key:'kpis.manage',group:'KPI Management',label:'Manage KPI definitions',description:'Create, edit, test, activate, and calculate management KPIs.',eligible_roles:['manager','planner','pm'] },
  { key:'notifications.manage',group:'Administration',label:'Manage notification rules',description:'Configure organization-wide notification delivery and escalation rules.' },
  { key:'reports.access',group:'Core Modules',label:'Access management reporting',description:'Open operational reports, service activity analytics, and custom report tools.',eligible_roles:['manager','planner','pm'],default_roles:['manager'] },
  { key:'service_activities.access',group:'Core Modules',label:'Access service activity tracking',description:'Open and use Service Activity Tracking within existing team and customer scope.',eligible_roles:['manager','pm','engineer'],default_roles:['manager','pm','engineer'] },
  { key:'projects.access',group:'Core Modules',label:'Access projects',description:'Open project lists and assigned project records.',default_roles:['manager','planner','pm','engineer'] },
  { key:'tasks.access',group:'Core Modules',label:'Access tasks',description:'Open task lists and assigned task records.',default_roles:['manager','planner','pm','engineer'] },
  { key:'visits.access',group:'Core Modules',label:'Access maintenance visits',description:'Open maintenance visit schedules and permitted visit records.',default_roles:['manager','planner','pm','engineer'] },
  { key:'customers.access',group:'Core Modules',label:'Access customers',description:'Open the customer directory and permitted customer profiles.',default_roles:['manager','planner','pm','engineer'] },
  { key:'assets.access',group:'Core Modules',label:'Manage customer assets',description:'View and maintain encrypted customer asset inventories.',eligible_roles:['manager','planner','pm'],default_roles:['manager'] },
]);
const KEYS=new Set(DEFINITIONS.map(item => item.key));
const ROLES=Object.freeze(['manager','planner','pm','engineer']);
const DEFAULTS=Object.freeze({
  manager:Object.freeze(Object.fromEntries(DEFINITIONS.map(item => [item.key,(item.default_roles || ['manager']).includes('manager')]))),
  planner:Object.freeze(Object.fromEntries(DEFINITIONS.map(item => [item.key,(item.default_roles || ['manager']).includes('planner')]))),
  pm:Object.freeze(Object.fromEntries(DEFINITIONS.map(item => [item.key,(item.default_roles || ['manager']).includes('pm')]))),
  engineer:Object.freeze(Object.fromEntries(DEFINITIONS.map(item => [item.key,(item.default_roles || ['manager']).includes('engineer')]))),
});

function validPermission(key) { return typeof key==='string' && KEYS.has(key); }
function validRole(role) { return ROLES.includes(role); }
function eligibleRole(key,role) {
  const definition=DEFINITIONS.find(item => item.key===key);
  return !!definition && (!definition.eligible_roles || definition.eligible_roles.includes(role));
}

async function effectivePermissions(user,store=db) {
  const result={ ...DEFAULTS[user.role] };
  const [roleRules,userRules]=await Promise.all([
    store.prepare('SELECT permission_key,allowed FROM role_permission_overrides WHERE role=?').all(user.role),
    store.prepare('SELECT permission_key,allowed FROM user_permission_overrides WHERE user_id=?').all(user.id),
  ]);
  for (const row of roleRules) if (KEYS.has(row.permission_key) && eligibleRole(row.permission_key,user.role)) result[row.permission_key]=!!row.allowed;
  for (const row of userRules) if (KEYS.has(row.permission_key) && eligibleRole(row.permission_key,user.role)) result[row.permission_key]=!!row.allowed;
  for (const key of KEYS) if (!eligibleRole(key,user.role)) result[key]=false;
  return result;
}

async function hasPermission(user,key,store=db) {
  if (!validPermission(key) || !eligibleRole(key,user.role)) return false;
  return !!(await effectivePermissions(user,store))[key];
}

async function usersWithPermission(key,store=db) {
  if (!validPermission(key)) return [];
  const [users,roleRules,userRules]=await Promise.all([
    store.prepare('SELECT id,role FROM users WHERE active=1').all(),
    store.prepare('SELECT role,allowed FROM role_permission_overrides WHERE permission_key=?').all(key),
    store.prepare('SELECT user_id,allowed FROM user_permission_overrides WHERE permission_key=?').all(key),
  ]);
  const byRole=new Map(roleRules.map(row => [row.role,!!row.allowed]));
  const byUser=new Map(userRules.map(row => [Number(row.user_id),!!row.allowed]));
  return users.filter(user => eligibleRole(key,user.role) && (byUser.has(Number(user.id)) ? byUser.get(Number(user.id)) : byRole.has(user.role) ? byRole.get(user.role) : !!DEFAULTS[user.role]?.[key]));
}

module.exports={ DEFINITIONS,KEYS,ROLES,DEFAULTS,validPermission,validRole,eligibleRole,effectivePermissions,hasPermission,usersWithPermission };
