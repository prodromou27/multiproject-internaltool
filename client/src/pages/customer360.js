export const CUSTOMER_360_SECTIONS=Object.freeze([
  { id:'overview',label:'Overview',roles:['manager','engineer'] },
  { id:'activities',label:'Service Activities',roles:['manager','engineer','planner'] },
  { id:'tickets',label:'Tickets',roles:['manager'],tickets:true },
  { id:'projects',label:'Projects',roles:['manager','engineer','planner'] },
  { id:'tasks',label:'Tasks',roles:['manager','engineer'] },
  { id:'maintenance-visits',label:'Maintenance Visits',roles:['manager','engineer','planner'] },
  { id:'recommendations',label:'Recommendations',roles:['manager','engineer','planner'] },
  { id:'assets',label:'Assets',roles:['manager'] },
  { id:'contracts',label:'Contracts',roles:['manager','engineer','planner'] },
  { id:'reports',label:'Reports',roles:['manager'],managed:true },
  { id:'timeline',label:'Timeline',roles:['manager','engineer','planner'] },
  { id:'service-configuration',label:'Service Configuration',roles:['manager'] },
]);

const permitted=(user,permission) => Object.prototype.hasOwnProperty.call(user?.permissions || {},permission) ? user.permissions[permission]===true : user?.role==='manager';

/* `assetsGrant`: the server says this engineer works with this customer, which
   earns the Assets tab (view, add, review) without the assets.access permission. `managedCustomer`: the customer receives managed
   services, which adds the Reports tab. `hasTickets`: it has a Request Tracker
   queue (managed or not), which adds the Tickets tab. */
export function customer360Sections(user,capabilities={},assetsGrant=false,managedCustomer=false,hasTickets=false,noVisits=false) {
  const assetAllowed=assetsGrant===true || permitted(user,'assets.access');
  const managedAllowed=managedCustomer===true && permitted(user,'managed_customers.view');
  const ticketsAllowed=(managedCustomer===true || hasTickets===true) && permitted(user,'managed_customers.view');
  const available=CUSTOMER_360_SECTIONS.filter(section => !section.pending && (section.tickets ? ticketsAllowed && section.roles.includes(user?.role) : section.managed ? managedAllowed && section.roles.includes(user?.role) : section.id==='assets' ? assetAllowed : section.roles.includes(user?.role)));
  // Managed customers do not have maintenance visits.
  if (managedCustomer===true || noVisits===true) available.splice(0,available.length,...available.filter(section => section.id!=='maintenance-visits'));
  if (user?.role!=='engineer' || (capabilities.managedServiceOperations===undefined && capabilities.projectDelivery===undefined)) return available;
  const managed=capabilities.managedServiceOperations===true;
  const delivery=capabilities.projectDelivery===true;
  if (!managed && !delivery) return available;
  const order=managed
    ? delivery ? ['overview','activities','projects','tasks','maintenance-visits','recommendations','assets','contracts','timeline'] : ['overview','tasks','assets','maintenance-visits','recommendations','contracts','activities','timeline','projects']
    : ['overview','projects','tasks','maintenance-visits','recommendations','assets','activities','contracts','timeline'];
  return order.map(id => available.find(section => section.id===id)).filter(Boolean);
}

/* The tabs kept in view, and the ones under More: the record-keeping sections
   (and Projects, for a managed customer). The open section always stays in view.
   Fewer than two under More is not worth a menu, so then everything shows. */
const SECONDARY_SECTIONS=['contracts','reports','timeline','service-configuration'];
export function customer360TabGroups(sections,current,managedCustomer=false) {
  const secondary=id => SECONDARY_SECTIONS.includes(id) || (managedCustomer===true && id==='projects');
  const more=sections.filter(section => secondary(section.id));
  if (more.length<2) return { shown:sections,more:[] };
  return { shown:sections.filter(section => !secondary(section.id) || section.id===current),more:more.filter(section => section.id!==current) };
}

export function customer360Section(user,requested,capabilities={},assetsGrant=false,managedCustomer=false,hasTickets=false,noVisits=false) {
  const available=customer360Sections(user,capabilities,assetsGrant,managedCustomer,hasTickets,noVisits);
  const aliases={ 'managed-services':'service-configuration' };
  const normalized=aliases[requested] || requested;
  return available.some(section => section.id===normalized) ? normalized : available[0]?.id || 'overview';
}

/* A transparent 0-100 health score from the operations summary. Every point
   lost is listed as a factor, so the number is never a black box. Capped per
   factor so one bad area can't zero the whole score on its own. */
export function customerHealth(summary) {
  if (!summary) return null;
  const factors=[];
  const lose=(points,cap,label) => { if (points>0) factors.push({ points:Math.min(points,cap),label }); };
  const plural=(n,one,many) => `${n} ${n===1 ? one : many}`;
  const delayed=Number(summary.projects?.delayed || 0),overdue=Number(summary.tasks?.overdue || 0);
  const highRisk=Number(summary.recommendations?.high_risk || 0),reports=Number(summary.visits?.reports_pending || 0);
  lose(delayed*10,30,`${plural(delayed,'delayed project','delayed projects')}`);
  lose(overdue*5,25,`${plural(overdue,'overdue task','overdue tasks')}`);
  lose(highRisk*5,15,`${plural(highRisk,'high-risk recommendation','high-risk recommendations')}`);
  lose(reports*5,10,`${plural(reports,'visit report pending','visit reports pending')}`);
  if (summary.managed?.state==='sync_attention') lose(10,10,'ticket sync failing');
  if (summary.managed?.state==='setup_required') lose(5,5,'managed setup incomplete');
  const score=Math.max(0,100-factors.reduce((sum,factor) => sum+factor.points,0));
  const tone=score>=80 ? 'good' : score>=50 ? 'warn' : 'bad';
  return { score,tone,label:tone==='good' ? 'Healthy' : tone==='warn' ? 'Needs attention' : 'At risk',factors };
}

/* A stable hue per customer so each header has its own accent instead of one
   identical blue for everyone. Same name, same colour, every time. */
export function customerHue(name) {
  let hash=0;
  for (const char of String(name || '')) hash=(hash*31+char.charCodeAt(0))>>>0;
  return hash%360;
}
