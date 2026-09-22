const db=require('./db');

const DEFINITIONS=Object.freeze([
  { key:'managed_customers.view',group:'Managed Services',label:'View managed customers',description:'Open managed customer dashboards and report history.' },
  { key:'managed_reports.generate',group:'Managed Services',label:'Generate managed reports',description:'Create and archive Word, Excel, and PDF customer reports.' },
  { key:'managed_reports.review',group:'Managed Services',label:'Review managed reports',description:'Submit, approve, reject, finalize, and publish customer reports.' },
  { key:'notifications.manage',group:'Administration',label:'Manage notification rules',description:'Configure organization-wide notification delivery and escalation rules.' },
]);
const KEYS=new Set(DEFINITIONS.map(item => item.key));
const ROLES=Object.freeze(['manager','planner','pm','engineer']);
const DEFAULTS=Object.freeze({
  manager:Object.freeze(Object.fromEntries(DEFINITIONS.map(item => [item.key,true]))),
  planner:Object.freeze(Object.fromEntries(DEFINITIONS.map(item => [item.key,false]))),
  pm:Object.freeze(Object.fromEntries(DEFINITIONS.map(item => [item.key,false]))),
  engineer:Object.freeze(Object.fromEntries(DEFINITIONS.map(item => [item.key,false]))),
});

function validPermission(key) { return typeof key==='string' && KEYS.has(key); }
function validRole(role) { return ROLES.includes(role); }

async function effectivePermissions(user,store=db) {
  const result={ ...DEFAULTS[user.role] };
  const [roleRules,userRules]=await Promise.all([
    store.prepare('SELECT permission_key,allowed FROM role_permission_overrides WHERE role=?').all(user.role),
    store.prepare('SELECT permission_key,allowed FROM user_permission_overrides WHERE user_id=?').all(user.id),
  ]);
  for (const row of roleRules) if (KEYS.has(row.permission_key)) result[row.permission_key]=!!row.allowed;
  for (const row of userRules) if (KEYS.has(row.permission_key)) result[row.permission_key]=!!row.allowed;
  return result;
}

async function hasPermission(user,key,store=db) {
  if (!validPermission(key)) return false;
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
  return users.filter(user => byUser.has(Number(user.id)) ? byUser.get(Number(user.id)) : byRole.has(user.role) ? byRole.get(user.role) : !!DEFAULTS[user.role]?.[key]);
}

module.exports={ DEFINITIONS,KEYS,ROLES,DEFAULTS,validPermission,validRole,effectivePermissions,hasPermission,usersWithPermission };
