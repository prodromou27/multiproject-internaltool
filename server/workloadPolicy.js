const defaults = () => ({ status_weights: { task: { open: 1,in_progress: 1,waiting_customer: 0.25,waiting_vendor: 0.25,pending_approval: 0.1,completed: 0,closed: 0,cancelled: 0 },visit: { scheduled: 1,in_progress: 1,completed: 0,cancelled: 0 } },pressure: { priority: { low: 1,medium: 2,high: 3,critical: 5 },overdue: 2,due_soon: 1,pending_report: 2,follow_up: 1 } });
const object = value => value && typeof value==='object' && !Array.isArray(value);
const fail = message => { throw Object.assign(new Error(message),{ status: 400 }); };
function validatePolicy(body) {
  if (!object(body) || Object.keys(body).some(key => !['version','status_weights','pressure'].includes(key)) || !Number.isSafeInteger(body.version) || body.version<0) fail('Expected workload policy version is required');
  const weights = body.status_weights,pressure = body.pressure;
  if (!object(weights) || Object.keys(weights).some(key => !['task','visit'].includes(key))) fail('Invalid status weight groups');
  for (const kind of ['task','visit']) {
    if (!object(weights[kind]) || Object.keys(weights[kind]).length>100) fail('Provide up to 100 status weights per work type');
    for (const [key,value] of Object.entries(weights[kind])) if (!key || key.length>80 || ['__proto__','constructor','prototype'].includes(key) || typeof value!=='number' || !Number.isFinite(value) || value<0 || value>1) fail('Status weights must be numeric values between 0 and 1');
  }
  if (!object(pressure) || Object.keys(pressure).some(key => !['priority','overdue','due_soon','pending_report','follow_up'].includes(key)) || !object(pressure.priority) || Object.keys(pressure.priority).some(key => !['low','medium','high','critical'].includes(key))) fail('Invalid pressure weights');
  for (const value of [...['low','medium','high','critical'].map(key => pressure.priority[key]),...['overdue','due_soon','pending_report','follow_up'].map(key => pressure[key])]) if (typeof value!=='number' || !Number.isFinite(value) || value<0 || value>100) fail('Pressure weights must be numeric values between 0 and 100');
  const fallback = defaults();
  return { status_weights: { task: { ...fallback.status_weights.task,...weights.task },visit: { ...fallback.status_weights.visit,...weights.visit } },pressure };
}
function statusWeight(policy,kind,status) {
  const weights = policy?.status_weights?.[kind];
  return weights && Object.hasOwn(weights,status) ? weights[status] : 1;
}
function pressureForEngineer(engineer,items,asOf,policy) {
  const end = new Date(`${asOf}T00:00:00Z`); end.setUTCDate(end.getUTCDate()+6);
  const soon = end.toISOString().slice(0,10),weights = policy.pressure;
  const rows = items.map(item => {
    const base = item.kind==='task' ? weights.priority[item.priority] ?? weights.priority.medium : item.kind==='report' ? weights.pending_report : item.kind==='follow_up' ? weights.follow_up : 1;
    const status = ['task','visit'].includes(item.kind) ? statusWeight(policy,item.kind,item.status) : 1;
    const overdue = !!item.date && item.date<asOf;
    const dueSoon = !!item.date && item.date>=asOf && item.date<=soon;
    return { ...item,base_points: Math.round(base*status*100)/100,overdue,due_soon: dueSoon,points: Math.round((base*status+(overdue ? weights.overdue : dueSoon ? weights.due_soon : 0))*100)/100 };
  }).sort((a,b) => b.points-a.points || (a.date || '9999').localeCompare(b.date || '9999') || a.kind.localeCompare(b.kind) || a.id-b.id);
  const breakdown = Object.fromEntries(['task','visit','report','follow_up'].map(kind => {
    const own = rows.filter(row => row.kind===kind);
    return [kind,{ count: own.length,points: Math.round(own.reduce((sum,row) => sum+row.points,0)*100)/100 }];
  }));
  return { ...engineer,pressure_points: Math.round(rows.reduce((sum,row) => sum+row.points,0)*100)/100,overdue_count: rows.filter(row => row.overdue).length,undated_count: rows.filter(row => !row.date).length,breakdown,items: rows.slice(0,50),items_total: rows.length };
}
module.exports = { defaults,validatePolicy,statusWeight,pressureForEngineer };
